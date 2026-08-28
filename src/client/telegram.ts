import { TelegramClient, type Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions/Logger";
import type { LogLevel } from "telegram/extensions/Logger";
import { loadSession, saveSession } from "../session/storage";
import { getApiCredentials } from "../config/manager";
import { wssEnabled, wssClientParams, applyWss, restoreTcpDc, explainConnectionError } from "./wss";

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

let client: TelegramClient | null = null;
let customSessionPath: string | undefined;

export function setSessionPath(path: string) {
  customSessionPath = path;
}

export async function getClient(): Promise<TelegramClient> {
  if (client) return client;

  const creds = getApiCredentials();
  if (!creds) {
    throw new Error(
      "telegram API credentials not found.\n" +
      "get them from: https://my.telegram.org/apps\n" +
      "then run: telegram config set appId <id>\n" +
      "         telegram config set appHash <hash>\n" +
      "or set env vars: TELEGRAM_APP_ID, TELEGRAM_APP_HASH"
    );
  }

  const sessionStr = loadSession(customSessionPath);
  const session = new StringSession(sessionStr);

  client = new TelegramClient(session, creds.appId, creds.appHash, {
    connectionRetries: 5,
    baseLogger: new SilentLogger(),
    ...(wssEnabled() ? wssClientParams : {}),
  });

  if (wssEnabled()) applyWss(client);
  else restoreTcpDc(client);

  try {
    await client.connect();
  } catch (err) {
    throw explainConnectionError(err);
  }
  return client;
}

export async function isLoggedIn(): Promise<boolean> {
  const c = await getClient();
  return c.checkAuthorization();
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

// a chat can be addressed by @username, "me", phone (+123), t.me link,
// or a numeric id copied from `telegram dialogs`. usernames/links resolve
// natively; numeric ids and bare names need the dialog entity cache, so we
// look them up here.
export async function resolveEntity(
  identifier: string
): Promise<string | Api.TypeEntityLike> {
  const c = await getClient();
  const id = identifier.trim();

  // things gramjs resolves on its own
  if (
    id === "me" ||
    id.startsWith("@") ||
    id.startsWith("+") ||
    id.startsWith("http")
  ) {
    return id;
  }

  // numeric id (users positive, chats/channels may be negative)
  if (/^-?\d+$/.test(id)) {
    try {
      // fast path: entity already in the session cache
      return await c.getInputEntity(id);
    } catch {
      // slow path: fetch dialogs to populate + match the entity
      const match = (await c.getDialogs({ limit: 200 })).find(
        (d) => d.id?.toString() === id || d.entity?.id?.toString() === id
      );
      if (match?.entity) return match.entity;
      throw new Error(
        `chat with id ${id} not found in your dialogs. run: telegram dialogs 200`
      );
    }
  }

  // bare name: partial, case-insensitive match against dialog titles
  const match = (await c.getDialogs({ limit: 200 })).find((d) =>
    d.title?.toLowerCase().includes(id.toLowerCase())
  );
  if (match?.entity) return match.entity;

  // let gramjs take a final shot (e.g. a username without the @)
  return id;
}

export async function sendMessage(
  username: string,
  message: string
): Promise<Api.Message> {
  const c = await getClient();
  const entity = await resolveEntity(username);
  return c.sendMessage(entity, { message });
}

export async function sendFile(
  username: string,
  filePath: string,
  caption?: string
): Promise<Api.Message> {
  const c = await getClient();
  const entity = await resolveEntity(username);
  return c.sendFile(entity, {
    file: filePath,
    caption: caption,
  });
}

export async function downloadMedia(
  message: Api.Message,
  outputPath?: string
): Promise<string | undefined> {
  const c = await getClient();
  if (!message.media) {
    return undefined;
  }
  
  const buffer = await c.downloadMedia(message, {
    outputFile: outputPath,
  });
  
  return buffer as string | undefined;
}

export async function getMessages(
  username: string,
  limit = 10
): Promise<Api.Message[]> {
  const c = await getClient();
  const entity = await resolveEntity(username);
  const messages = await c.getMessages(entity, { limit });
  return messages as Api.Message[];
}

export async function getDialogs(limit = 10) {
  const c = await getClient();
  return c.getDialogs({ limit });
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
