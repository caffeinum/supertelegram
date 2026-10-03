import { TelegramClient, Api, utils } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions/Logger";
import type { LogLevel } from "telegram/extensions/Logger";
import type { Dialog } from "telegram/tl/custom/dialog";
import { loadSession, saveSession } from "../session/storage";
import { getApiCredentials, getSessionPath } from "../config/manager";
import { getCurrentAccount } from "../config/accounts";
import { wssEnabled, wssClientParams, applyWss, restoreTcpDc, explainConnectionError } from "./wss";
import { CliError, EXIT } from "../cli/errors";

let verbose = false;

export function setVerbose(v: boolean) {
  verbose = v;
}

class SilentLogger extends Logger {
  override log(_level: LogLevel, _message: string, _color: string): void {
    if (verbose) {
      super.log(_level, _message, _color);
    }
  }
}

export type Entity = Api.User | Api.Chat | Api.Channel;

// one client per session file, so a long-lived process (the repl) keeps each account warm
const clients = new Map<string, TelegramClient>();
let customSessionPath: string | undefined;
let pinnedAccount: string | undefined;
let tearingDown = false;
let keepAlive = false;

export function setSessionPath(path: string | undefined, accountName?: string) {
  customSessionPath = path;
  pinnedAccount = accountName;
}

// in keep-alive mode disconnect() is a no-op; shutdown() closes everything
export function setKeepAlive(on: boolean) {
  keepAlive = on;
}

export function sessionOverride(): { path: string | undefined; account: string | undefined } {
  return { path: customSessionPath, account: pinnedAccount };
}

export function isKeepAlive(): boolean {
  return keepAlive;
}

// the account name this invocation runs as, for messages and hints
export function activeAccount(): string {
  return pinnedAccount ?? getCurrentAccount() ?? "default";
}

// true once disconnect() has begun. gramjs's background update loop can reject
// with a TIMEOUT while the connection is torn down — that happens AFTER the
// command's real work has committed, so callers use this to tell benign
// teardown noise apart from a genuine failure.
export function isTearingDown(): boolean {
  return tearingDown;
}

export async function createClient(sessionPath?: string): Promise<TelegramClient> {
  const creds = getApiCredentials();
  if (!creds) {
    throw new CliError(
      "telegram API credentials not found.\n" +
      "get them from: https://my.telegram.org/apps\n" +
      "then run: telegram config set appId <id>\n" +
      "         telegram config set appHash <hash>\n" +
      "or set env vars: TELEGRAM_APP_ID, TELEGRAM_APP_HASH"
    );
  }

  const c = new TelegramClient(new StringSession(loadSession(sessionPath)), creds.appId, creds.appHash, {
    connectionRetries: 5,
    baseLogger: new SilentLogger(),
    ...(wssEnabled() ? wssClientParams : {}),
  });

  if (wssEnabled()) applyWss(c);
  else restoreTcpDc(c);

  try {
    await c.connect();
  } catch (err) {
    throw explainConnectionError(err);
  }
  return c;
}

export async function getClientFor(sessionPath: string): Promise<TelegramClient> {
  const existing = clients.get(sessionPath);
  if (existing) return existing;
  const c = await createClient(sessionPath);
  clients.set(sessionPath, c);
  return c;
}

export async function getClient(): Promise<TelegramClient> {
  return getClientFor(getSessionPath(customSessionPath));
}

export async function isLoggedIn(): Promise<boolean> {
  const c = await getClient();
  return c.checkAuthorization();
}

export async function requireLogin(): Promise<TelegramClient> {
  const c = await getClient();
  if (!(await c.checkAuthorization())) {
    throw new CliError(`account "${activeAccount()}" is not logged in. run: telegram login ${activeAccount()}`);
  }
  return c;
}

export async function login(callbacks: {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
}): Promise<void> {
  const c = await getClient();

  await c.start({
    phoneNumber: callbacks.phoneNumber,
    phoneCode: callbacks.phoneCode,
    password: callbacks.password,
    onError: (err) => console.error("login error:", err),
  });

  const sessionStr = c.session.save() as unknown as string;
  saveSession(sessionStr, customSessionPath);
  console.log("session saved!");
}

// dialogs are fetched at most once per client per 30s, at the widest limit asked.
// order and unread counts drift as messages arrive, so a long-lived process refetches.
const DIALOG_TTL_MS = 30_000;
const dialogCache = new WeakMap<TelegramClient, { limit: number; dialogs: Dialog[]; at: number }>();

export async function fetchDialogs(c: TelegramClient, limit: number, fresh = false): Promise<Dialog[]> {
  const cached = dialogCache.get(c);
  if (!fresh && cached && cached.limit >= limit && Date.now() - cached.at < DIALOG_TTL_MS) {
    return cached.dialogs.slice(0, limit);
  }
  const dialogs = await c.getDialogs({ limit });
  dialogCache.set(c, { limit, dialogs, at: Date.now() });
  return dialogs;
}

export async function getDialogs(limit = 10) {
  return fetchDialogs(await getClient(), limit);
}

// recent chats first; only walk further back on a miss
const RESOLVE_DIALOG_SCANS = [100, 500];

export class ChatNotFound extends CliError {
  constructor(readonly query: string, account: string) {
    super(`no chat matching "${query}" in account "${account}".`, EXIT.notFound);
  }
}

export class AmbiguousChat extends CliError {
  constructor(query: string, account: string, readonly matches: Dialog[]) {
    const lines = matches.slice(0, 10).map((d) => `  ${d.id?.toString()}  ${d.title}`);
    super(
      `"${query}" matches ${matches.length} chats in account "${account}":\n${lines.join("\n")}\n` +
        `rerun with the id, e.g. telegram <command> ${matches[0]?.id?.toString()} ...`,
      EXIT.ambiguous
    );
  }
}

function isEntity(e: unknown): e is Entity {
  return e instanceof Api.User || e instanceof Api.Chat || e instanceof Api.Channel;
}

function titleMatches(dialogs: Dialog[], id: string, account: string): Entity | undefined {
  const q = id.toLowerCase();
  const exact = dialogs.filter((d) => d.title?.toLowerCase() === q);
  const matches = exact.length ? exact : dialogs.filter((d) => d.title?.toLowerCase().includes(q));
  if (matches.length > 1) throw new AmbiguousChat(id, account, matches);
  const only = matches[0]?.entity;
  return isEntity(only) ? only : undefined;
}

// a chat can be addressed by @username, "me", phone (+123), t.me link, a numeric
// id copied from `telegram list` (negative for groups/channels), or a title.
// titles must match exactly or uniquely — a write never lands on a guess.
export async function resolveIn(c: TelegramClient, identifier: string, account: string): Promise<Entity> {
  const id = identifier.trim();

  if (id === "me" || id.startsWith("@") || id.startsWith("+") || id.startsWith("http")) {
    try {
      const e = await c.getEntity(id);
      if (isEntity(e)) return e;
    } catch {
      // fall through to not-found
    }
    throw new ChatNotFound(id, account);
  }

  if (/^-?\d+$/.test(id)) {
    for (const scan of RESOLVE_DIALOG_SCANS) {
      const match = (await fetchDialogs(c, scan)).find((d) => d.id?.toString() === id);
      if (match && isEntity(match.entity)) return match.entity;
    }
    try {
      const e = await c.getEntity(Number(id));
      if (isEntity(e)) return e;
    } catch {
      // not cached and not in recent dialogs
    }
    throw new ChatNotFound(id, account);
  }

  // titles: uniqueness is judged over the whole scan window, never the first page
  const hit = titleMatches(await fetchDialogs(c, RESOLVE_DIALOG_SCANS.at(-1)!), id, account);
  if (hit) return hit;

  // older chats: telegram's search, restricted to chats you're in (my_results) and exact titles
  const found = await c.invoke(new Api.contacts.Search({ q: id, limit: 20 }));
  const mine = new Set(found.myResults.map((p) => utils.getPeerId(p)));
  const q = id.toLowerCase();
  const exact = [...found.chats, ...found.users]
    .filter(isEntity)
    .filter((e) => mine.has(utils.getPeerId(e)))
    .filter((e) => (e instanceof Api.User ? [e.firstName, e.lastName].filter(Boolean).join(" ") : e.title).toLowerCase() === q);
  if (exact.length === 1) return exact[0]!;
  throw new ChatNotFound(id, account);
}

export async function resolveEntity(identifier: string): Promise<Entity> {
  return resolveIn(await getClient(), identifier, activeAccount());
}

export async function sendMessage(chat: string, message: string): Promise<{ msg: Api.Message; entity: Entity }> {
  const c = await getClient();
  const entity = await resolveEntity(chat);
  return { msg: await c.sendMessage(entity, { message }), entity };
}

export async function sendFile(chat: string, filePath: string, caption?: string): Promise<{ msg: Api.Message; entity: Entity }> {
  const c = await getClient();
  const entity = await resolveEntity(chat);
  return { msg: await c.sendFile(entity, { file: filePath, caption }), entity };
}

export async function downloadMedia(message: Api.Message, outputPath?: string): Promise<string | undefined> {
  const c = await getClient();
  if (!message.media) return undefined;
  const result = await c.downloadMedia(message, { outputFile: outputPath });
  return result as string | undefined;
}

export async function getMessages(chat: string, limit = 10): Promise<Api.Message[]> {
  const c = await getClient();
  const entity = await resolveEntity(chat);
  return (await c.getMessages(entity, { limit })) as Api.Message[];
}

async function closeClients(): Promise<void> {
  for (const c of clients.values()) {
    try {
      await c.disconnect();
      // destroy() also tears down the update loop; ignore if the build lacks it
      await (c as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      // teardown errors are never actionable — the work already committed
    }
  }
  clients.clear();
}

// drop cached connections (after login/logout/switch changed which session a path means)
export async function resetClients(): Promise<void> {
  await closeClients();
}

export async function shutdown(): Promise<void> {
  tearingDown = true;
  await closeClients();
}

export async function disconnect(): Promise<void> {
  if (keepAlive) return;
  await shutdown();
}
