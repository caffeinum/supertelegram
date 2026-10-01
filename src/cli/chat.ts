import { existsSync } from "node:fs";
import { Api } from "telegram";
import {
  requireLogin,
  resolveEntity,
  resolveIn,
  fetchDialogs,
  getClientFor,
  activeAccount,
  disconnect,
  downloadMedia as download,
  ChatNotFound,
  AmbiguousChat,
  type Entity,
} from "../client/telegram";
import { listAccounts, accountSessionPath } from "../config/accounts";
import { CliError, EXIT } from "./errors";
import { chatType, displayName, isoDate, label, mediaLabel, peerId, username } from "./format";

export interface Out {
  json: boolean;
  accountFlag?: string;
}

// shell-safe: plain when harmless, else single-quoted (no $, `, ! expansion)
export function quote(arg: string): string {
  if (/^-\d+$/.test(arg) || /^[\p{L}\p{N}_@:+./][\p{L}\p{N}_@:+./-]*$/u.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function cmdline(command: string, args: string[], out: Out): string {
  const account = out.accountFlag ? ` -a ${quote(out.accountFlag)}` : "";
  return `telegram ${command}${account} ${args.join(" ")}`.trimEnd();
}

export function emit(out: Out, json: unknown, text: string[]) {
  console.log(out.json ? JSON.stringify(json, null, 2) : text.join("\n"));
}

// on a miss, look in the other logged-in accounts and name the exact command to run
export async function resolveOrHint(chat: string, command: string, out: Out): Promise<Entity> {
  try {
    return await resolveEntity(chat);
  } catch (err) {
    if (err instanceof AmbiguousChat) throw new CliError(err.message.replace("telegram <command>", `telegram ${command}${out.accountFlag ? ` -a ${out.accountFlag}` : ""}`), err.code);
    if (!(err instanceof ChatNotFound)) throw err;
    const current = activeAccount();
    const hits: string[] = [];
    for (const { name } of listAccounts().filter((a) => a.name !== current)) {
      try {
        const c = await getClientFor(accountSessionPath(name));
        if (!(await c.checkAuthorization())) continue;
        const e = await resolveIn(c, chat, name);
        hits.push(`found in account "${name}": ${displayName(e)} [${peerId(e)}] → telegram ${command} -a ${name} ${peerId(e)}`);
      } catch {
        // not there either
      }
    }
    const byName = !/^(-?\d+|@.*|\+.*|http.*|me)$/.test(chat.trim());
    const next = hits.length
      ? hits.join("\n")
      : byName
        ? `search by name with: ${cmdline("list", [quote(chat)], out)}`
        : `see your chats and their ids with: ${cmdline("list", [], out)}`;
    throw new CliError(`${err.message}\n${next}`, EXIT.notFound);
  }
}

function sentLine(msg: Api.Message, entity: Entity, verb: string) {
  return {
    json: { id: msg.id, chat_id: peerId(entity), chat: displayName(entity), account: activeAccount() },
    text: [`${verb} id: ${msg.id} → ${displayName(entity)} [${peerId(entity)}] as ${activeAccount()}`],
  };
}

export async function send(chat: string, message: string, out: Out) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "send", out);
  const msg = await c.sendMessage(entity, { message });
  const line = sentLine(msg, entity, "sent message");
  emit(out, line.json, line.text);
  await disconnect();
}

export async function sendFile(chat: string, path: string, caption: string | undefined, out: Out) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "send-file", out);
  const msg = await c.sendFile(entity, { file: path, caption });
  const line = sentLine(msg, entity, "sent file");
  emit(out, line.json, line.text);
  await disconnect();
}

export async function reply(chat: string, message: string, out: Out) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "reply", out);
  const msg = await c.sendMessage(entity, { message });
  await c.markAsRead(entity);
  const line = sentLine(msg, entity, "sent message");
  emit(out, line.json, line.text);
  await disconnect();
}

export type MessageRow = ReturnType<typeof messageRow>;

export function messageRow(m: Api.Message | Api.MessageService, sender: Entity | undefined) {
  return {
    id: m.id,
    date: isoDate(m.date),
    sender_id: m.senderId?.toString() ?? null,
    sender: sender ? displayName(sender) : null,
    username: sender ? (username(sender) ?? null) : null,
    text: m instanceof Api.MessageService ? null : m.message,
    action: m instanceof Api.MessageService ? m.action.className.replace(/^MessageAction/, "") : null,
    media: m instanceof Api.MessageService ? null : (mediaLabel(m) ?? null),
    reply_to: m.replyTo?.replyToMsgId ?? null,
  };
}

// `fallbackWho` is the chat itself: a message with no sender is a post by the chat
export function messageLine(r: MessageRow, fallbackWho: string, chatPrefix = ""): string {
  const who = r.sender ? `${r.sender}${r.username ? ` (@${r.username})` : ""}` : (r.sender_id ?? fallbackWho);
  const body = r.action ? `[${r.action}]` : `${r.text}${r.media ? ` [${r.media}]` : ""}`;
  return `[${r.date}] ${chatPrefix}#${r.id} ${who}: ${body}`;
}

export interface ReadOpts extends Out {
  limit: number;
  before?: number;
  after?: number;
}

export async function read(chat: string, opts: ReadOpts) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "read", opts);
  const forward = opts.after !== undefined;
  const msgs = (await c.getMessages(entity, {
    limit: opts.limit,
    ...(forward ? { offsetId: opts.after, reverse: true } : { offsetId: opts.before ?? 0 }),
  })) as (Api.Message | Api.MessageService)[];
  const chrono = forward ? msgs : [...msgs].reverse();

  const rows = chrono.map((m) => messageRow(m, m.sender as Entity | undefined));

  const edge = forward ? chrono[chrono.length - 1] : chrono[0];
  const next =
    msgs.length === opts.limit && edge
      ? cmdline("read", [peerId(entity), forward ? `--after ${edge.id}` : `--before ${edge.id}`, `-n ${opts.limit}`], opts)
      : null;

  emit(
    opts,
    { chat: { id: peerId(entity), title: displayName(entity), type: chatType(entity) }, account: activeAccount(), messages: rows, next },
    [
      ...rows.map((r) => messageLine(r, displayName(entity))),
      ...(next ? ["", `more: ${next}`] : []),
    ]
  );
  await disconnect();
}

export interface ListOpts extends Out {
  limit: number;
  offset: number;
}

export async function list(query: string | undefined, opts: ListOpts, command = "list") {
  const c = await requireLogin();
  const q = query?.toLowerCase();
  let dialogs = await fetchDialogs(c, q ? 500 : opts.offset + opts.limit + 1, !q);
  if (q) {
    dialogs = dialogs.filter((d) => {
      const u = d.entity && !(d.entity instanceof Api.Chat) ? (d.entity as { username?: string }).username : undefined;
      return d.title?.toLowerCase().includes(q) || u?.toLowerCase().includes(q);
    });
  }
  const page = dialogs.slice(opts.offset, opts.offset + opts.limit);

  const rows = page.map((d) => {
    const e = d.entity as Entity | undefined;
    return {
      id: d.id?.toString() ?? null,
      title: d.title,
      type: e ? chatType(e) : null,
      username: e ? (username(e) ?? null) : null,
      unread: d.unreadCount,
    };
  });

  const more = dialogs.length > opts.offset + opts.limit;
  const next = more
    ? cmdline(command, [...(query ? [quote(query)] : []), `-n ${opts.limit}`, `--offset ${opts.offset + opts.limit}`], opts)
    : null;

  if (!rows.length && q) {
    emit(opts, { account: activeAccount(), chats: [], next: null }, [
      `no chats matching "${query}" in account "${activeAccount()}" (checked the 500 most recent).`,
      `other accounts: telegram accounts, then telegram list ${quote(query!)} -a <name>`,
    ]);
    await disconnect();
    return;
  }

  emit(opts, { account: activeAccount(), chats: rows, next }, [
    ...rows.map(
      (r) => `- ${r.title}${r.username ? ` @${r.username}` : ""} [id: ${r.id}] ${r.type}${r.unread > 0 ? ` (${r.unread} unread)` : ""}`
    ),
    "",
    next ? `more: ${next}` : `read with: telegram read <id|@username> · members: telegram info <id>`,
  ]);
  await disconnect();
}

export interface InfoOpts extends Out {
  limit: number;
  offset: number;
  query?: string;
}

function role(member: Api.User): string | undefined {
  const p = (member as unknown as { participant?: object }).participant;
  if (p instanceof Api.ChannelParticipantCreator || p instanceof Api.ChatParticipantCreator) return "creator";
  if (p instanceof Api.ChannelParticipantAdmin || p instanceof Api.ChatParticipantAdmin) return "admin";
  if (p instanceof Api.ChannelParticipantBanned) return "banned";
  return undefined;
}

export async function info(chat: string, opts: InfoOpts) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "info", opts);
  const base = { id: peerId(entity), title: displayName(entity), type: chatType(entity), username: username(entity) ?? null };

  if (entity instanceof Api.User) {
    const full = await c.invoke(new Api.users.GetFullUser({ id: entity }));
    const details = {
      ...base,
      phone: entity.phone ?? null,
      bio: full.fullUser.about ?? null,
      common_chats: full.fullUser.commonChatsCount,
    };
    emit(opts, details, [
      `${label(entity)}  [${base.id}]  ${base.type}`,
      ...(details.phone ? [`phone: +${details.phone}`] : []),
      ...(details.bio ? [`bio: ${details.bio}`] : []),
      `groups in common: ${details.common_chats}`,
    ]);
    await disconnect();
    return;
  }

  let members: Api.User[] = [];
  let total: number | undefined;
  let hidden = false;
  try {
    const ps = await c.getParticipants(entity, { limit: opts.limit, offset: opts.offset, search: opts.query ?? "" });
    members = [...ps];
    total = ps.total;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/CHAT_ADMIN_REQUIRED|CHANNEL_PRIVATE|CHAT_FORBIDDEN/.test(msg)) throw err;
    hidden = true;
    if (entity instanceof Api.Channel) {
      const full = await c.invoke(new Api.channels.GetFullChannel({ channel: entity }));
      total = (full.fullChat as Api.ChannelFull).participantsCount;
    }
  }

  const rows = members.map((m) => ({
    id: m.id.toString(),
    name: displayName(m),
    username: username(m) ?? null,
    role: role(m) ?? "member",
    bot: Boolean(m.bot),
  }));
  const more = !hidden && members.length === opts.limit && (total === undefined || opts.offset + opts.limit < total);
  const next = more
    ? cmdline("info", [peerId(entity), `-n ${opts.limit}`, `--offset ${opts.offset + opts.limit}`, ...(opts.query ? [`--query ${quote(opts.query)}`] : [])], opts)
    : null;

  emit(opts, { ...base, members_count: total ?? null, members_hidden: hidden, members: rows, next }, [
    `${base.title}${base.username ? ` @${base.username}` : ""}  [${base.id}]  ${base.type} · ${total ?? "?"} members`,
    ...(hidden ? ["members hidden (admin-only for this chat)"] : []),
    ...rows.map(
      (r) => `- ${r.name}${r.username ? ` @${r.username}` : ""} [id: ${r.id}]${r.role !== "member" ? ` ${r.role}` : ""}${r.bot ? " bot" : ""}`
    ),
    ...(next ? ["", `more: ${next}`] : []),
  ]);
  await disconnect();
}

export async function unread(limit: number) {
  const c = await requireLogin();
  const myId = (await c.getMe()).id.toString();
  const dialogs = (await fetchDialogs(c, limit)).filter((d) => d.unreadCount > 0 && d.entity);

  if (dialogs.length === 0) {
    console.log("no unread messages");
    await disconnect();
    return;
  }

  const output = [];
  for (const dialog of dialogs) {
    const messages = (await c.getMessages(dialog.entity!, { limit: Math.min(dialog.unreadCount, 5) })) as Api.Message[];
    output.push({
      chat: dialog.title,
      chat_id: dialog.id?.toString() ?? null,
      unreadCount: dialog.unreadCount,
      messages: messages
        .filter((m) => m.senderId?.toString() !== myId)
        .map((m) => ({ id: m.id, text: m.message, media: mediaLabel(m) ?? null, date: isoDate(m.date) })),
    });
  }

  console.log(JSON.stringify(output, null, 2));
  await disconnect();
}

const EXT: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
  "video/mp4": ".mp4", "video/quicktime": ".mov", "audio/ogg": ".ogg", "audio/mpeg": ".mp3",
  "application/pdf": ".pdf", "application/zip": ".zip", "text/plain": ".txt",
};

function defaultFileName(msg: Api.Message): string {
  const m = msg.media;
  if (m instanceof Api.MessageMediaPhoto) return `${msg.id}.jpg`;
  if (m instanceof Api.MessageMediaDocument && m.document instanceof Api.Document) {
    const named = m.document.attributes.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename);
    if (named) return named.fileName;
    const ext = EXT[m.document.mimeType];
    if (!ext) throw new CliError(`can't pick a file name for mime ${m.document.mimeType}. pass one: telegram download <chat> ${msg.id} <out-path>`, EXIT.usage);
    return `${msg.id}${ext}`;
  }
  throw new CliError(`message #${msg.id} has ${mediaLabel(msg)} media, which has no file to download`, EXIT.notFound);
}

export async function downloadMedia(chat: string, messageId: number, outputPath: string | undefined, out: Out) {
  const c = await requireLogin();
  const entity = await resolveOrHint(chat, "download", out);
  const [msg] = (await c.getMessages(entity, { ids: messageId })) as (Api.Message | undefined)[];
  if (!msg) throw new CliError(`message #${messageId} not found in ${displayName(entity)}. list ids with: telegram read ${peerId(entity)}`, EXIT.notFound);
  if (!msg.media) throw new CliError(`message #${messageId} has no media`, EXIT.notFound);

  const target = outputPath ?? defaultFileName(msg);
  if (!outputPath && existsSync(target)) {
    throw new CliError(`${target} already exists — not overwriting. pass a path: telegram download ${quote(chat)} ${messageId} <out-path>`, EXIT.usage);
  }
  console.log("downloading media...");
  const path = await download(msg, target);
  if (!path) throw new CliError(`download of #${messageId} produced no file`);
  console.log(`saved to: ${path}`);
  await disconnect();
}
