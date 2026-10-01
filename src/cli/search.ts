import { Api, utils } from "telegram";
import { returnBigInt } from "telegram/Helpers";
import { requireLogin, fetchDialogs, activeAccount, disconnect, type Entity } from "../client/telegram";
import { cmdline, emit, messageLine, messageRow, quote, resolveOrHint, type MessageRow, type Out } from "./chat";
import { chatType, displayName, peerId, username } from "./format";
import { usageError } from "./errors";

// telegram caps one page of messages.search / searchGlobal at 100
const MAX_PAGE = 100;
const CHAT_HITS = 10;

export interface SearchOpts extends Out {
  limit: number;
  in?: string;
  from?: string;
  before?: number;
  cursor?: string;
}

export async function search(query: string, opts: SearchOpts) {
  if (opts.limit > MAX_PAGE) throw usageError(`-n is at most ${MAX_PAGE} per page for search. page with the more: line`);
  if (opts.from && !opts.in) {
    throw usageError(`--from needs --in <chat>: telegram only filters by sender inside one chat.\ne.g. telegram search ${quote(query)} --in <chat> --from ${quote(opts.from)}`);
  }
  if (opts.in) return searchIn(query, opts.in, opts);
  if (opts.before !== undefined) throw usageError("--before pages a search --in <chat>. across all chats, use the --cursor from the more: line");
  return searchGlobal(query, opts);
}

async function searchIn(query: string, chat: string, opts: SearchOpts) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "search", opts);
  const from = opts.from ? await resolveOrHint(opts.from, "search", opts) : undefined;
  const msgs = (await c.getMessages(entity, {
    search: query,
    limit: opts.limit,
    offsetId: opts.before ?? 0,
    ...(from ? { fromUser: from } : {}),
  })) as (Api.Message | Api.MessageService)[];
  const chrono = [...msgs].reverse();
  const rows = chrono.map((m) => messageRow(m, m.sender as Entity | undefined));

  const oldest = chrono[0];
  const next =
    msgs.length === opts.limit && oldest
      ? cmdline("search", [quote(query), `--in ${peerId(entity)}`, ...(from ? [`--from ${peerId(from)}`] : []), `--before ${oldest.id}`, `-n ${opts.limit}`], opts)
      : null;

  const where = `${displayName(entity)} [${peerId(entity)}]${from ? ` from ${displayName(from)}` : ""}`;
  emit(
    opts,
    { query, chat: { id: peerId(entity), title: displayName(entity), type: chatType(entity) }, account: activeAccount(), messages: rows, next },
    rows.length
      ? [...rows.map((r) => messageLine(r, displayName(entity))), ...(next ? ["", `more: ${next}`] : [])]
      : [`no messages matching "${query}" in ${where}.`]
  );
  await disconnect();
}

type CursorPeer = ["u", string, string] | ["c", string] | ["ch", string, string];
interface Cursor {
  r: number;
  i: number;
  p: CursorPeer;
}

function encodeCursor(rate: number, id: number, peer: Api.TypeInputPeer): string {
  let p: CursorPeer;
  if (peer instanceof Api.InputPeerUser) p = ["u", peer.userId.toString(), peer.accessHash.toString()];
  else if (peer instanceof Api.InputPeerChat) p = ["c", peer.chatId.toString()];
  else if (peer instanceof Api.InputPeerChannel) p = ["ch", peer.channelId.toString(), peer.accessHash.toString()];
  else throw new Error(`can't page past a message in a ${peer.className}`);
  return Buffer.from(JSON.stringify({ r: rate, i: id, p } satisfies Cursor)).toString("base64url");
}

function decodeCursor(token: string): { rate: number; id: number; peer: Api.TypeInputPeer } {
  const bad = usageError("invalid --cursor. copy it from the more: line of the previous page, or start over: telegram search <query>");
  let c: Cursor;
  try {
    c = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"));
  } catch {
    throw bad;
  }
  if (typeof c?.r !== "number" || typeof c?.i !== "number" || !Array.isArray(c?.p)) throw bad;
  const [kind, id, hash] = c.p;
  const peer =
    kind === "u" && hash
      ? new Api.InputPeerUser({ userId: returnBigInt(id), accessHash: returnBigInt(hash) })
      : kind === "c"
        ? new Api.InputPeerChat({ chatId: returnBigInt(id) })
        : kind === "ch" && hash
          ? new Api.InputPeerChannel({ channelId: returnBigInt(id), accessHash: returnBigInt(hash) })
          : undefined;
  if (!peer) throw bad;
  return { rate: c.r, id: c.i, peer };
}

function isEntity(e: unknown): e is Entity {
  return e instanceof Api.User || e instanceof Api.Chat || e instanceof Api.Channel;
}

async function searchGlobal(query: string, opts: SearchOpts) {
  const c = await requireLogin();
  const page = opts.cursor ? decodeCursor(opts.cursor) : undefined;

  // first page also lists chats whose title/@username match, like telegram's own search box
  const q = query.toLowerCase();
  const chatHits = page
    ? []
    : (await fetchDialogs(c, 500)).filter((d) => {
        const u = d.entity && !(d.entity instanceof Api.Chat) ? (d.entity as { username?: string }).username : undefined;
        return d.title?.toLowerCase().includes(q) || u?.toLowerCase().includes(q);
      });

  const res = await c.invoke(
    new Api.messages.SearchGlobal({
      q: query,
      filter: new Api.InputMessagesFilterEmpty(),
      minDate: 0,
      maxDate: 0,
      offsetRate: page?.rate ?? 0,
      offsetPeer: page?.peer ?? new Api.InputPeerEmpty(),
      offsetId: page?.id ?? 0,
      limit: opts.limit,
    })
  );
  if (res instanceof Api.messages.MessagesNotModified) throw new Error("telegram returned MessagesNotModified for a search");

  const entities = new Map<string, Entity>();
  for (const e of [...res.users, ...res.chats]) if (isEntity(e)) entities.set(utils.getPeerId(e).toString(), e);
  let me: Api.User | undefined;

  const found: { chat: Entity; row: MessageRow; msg: Api.Message | Api.MessageService }[] = [];
  for (const m of res.messages) {
    if (!(m instanceof Api.Message || m instanceof Api.MessageService)) continue;
    const chat = entities.get(utils.getPeerId(m.peerId).toString());
    if (!chat) throw new Error(`search result #${m.id} came without its chat (${utils.getPeerId(m.peerId)})`);
    let sender: Entity | undefined;
    if (m.fromId) sender = entities.get(utils.getPeerId(m.fromId).toString());
    else if (m.out) sender = me ??= (await c.getMe()) as Api.User;
    else sender = chat;
    found.push({ chat, msg: m, row: messageRow(m, sender) });
  }

  const last = found[found.length - 1];
  const more = res instanceof Api.messages.MessagesSlice && res.nextRate !== undefined && found.length === opts.limit && last;
  const next = more
    ? cmdline("search", [quote(query), `--cursor ${encodeCursor(res.nextRate!, last.msg.id, utils.getInputPeer(last.chat))}`, `-n ${opts.limit}`], opts)
    : null;
  const total = res instanceof Api.messages.MessagesSlice ? res.count : found.length;

  const chats = chatHits.slice(0, CHAT_HITS).map((d) => {
    const e = d.entity as Entity | undefined;
    return { id: d.id?.toString() ?? null, title: d.title, type: e ? chatType(e) : null, username: e ? (username(e) ?? null) : null };
  });
  const messages = [...found].reverse().map(({ chat, row }) => ({ ...row, chat: { id: peerId(chat), title: displayName(chat), type: chatType(chat) } }));

  const text: string[] = [];
  if (chats.length) {
    text.push(`chats (${chatHits.length}):`);
    text.push(...chats.map((ch) => `- ${ch.title}${ch.username ? ` @${ch.username}` : ""} [id: ${ch.id}] ${ch.type}`));
    if (chatHits.length > CHAT_HITS) text.push(`  … all of them: ${cmdline("list", [quote(query)], opts)}`);
    text.push("");
  }
  if (messages.length) {
    text.push(`messages (${total}${res instanceof Api.messages.MessagesSlice && res.inexact ? "+" : ""}):`);
    text.push(...messages.map((m) => messageLine(m, m.chat.title, `${m.chat.title} [${m.chat.id}] `)));
    if (next) text.push("", `more: ${next}`);
  } else {
    text.push(page ? "no more messages." : `no messages matching "${query}" in account "${activeAccount()}".`);
  }

  emit(opts, { query, account: activeAccount(), chats, messages, total, next }, text);
  await disconnect();
}
