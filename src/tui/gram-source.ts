import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api, utils, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { Raw } from "telegram/events/Raw";
import { UpdateConnectionState } from "telegram/network";
import type { Dialog } from "telegram/tl/custom/dialog";
import { activeAccount, fetchDialogs, getClient, resolveIn, sessionOverride, setKeepAlive, setSessionPath, shutdown, type Entity } from "../client/telegram";
import { accountSessionPath, listAccounts } from "../config/accounts";
import { chatType, displayName, mediaLabel, peerId, username } from "../cli/format";
import { CliError } from "../cli/errors";
import type { ChatSummary, DataSource, Msg, SearchHit, SendOpts, SourceEvent } from "./types";

type TgMessage = Api.Message | Api.MessageService;

function isEntity(e: unknown): e is Entity {
  return e instanceof Api.User || e instanceof Api.Chat || e instanceof Api.Channel;
}

// telegram leaves `out` false on your own messages in saved messages, so compare the sender with me too
export function toMsg(m: TgMessage, sender: Entity | undefined, me?: string): Msg {
  const service = m instanceof Api.MessageService;
  return {
    id: m.id,
    date: m.date,
    out: Boolean(m.out) || (me !== undefined && m.senderId?.toString() === me),
    senderId: m.senderId?.toString(),
    sender: sender ? displayName(sender) : undefined,
    senderUsername: sender ? username(sender) : undefined,
    text: service ? "" : m.message,
    media: service ? undefined : mediaLabel(m),
    action: service ? m.action.className.replace(/^MessageAction/, "") : undefined,
    replyTo: m.replyTo?.replyToMsgId,
  };
}

function toSummary(d: Dialog, me: string): ChatSummary | undefined {
  if (!isEntity(d.entity) || !d.id) return undefined;
  const m = d.message as TgMessage | undefined;
  const muteUntil = d.dialog.notifySettings?.muteUntil ?? 0;
  const from = m?.sender && isEntity(m.sender) ? displayName(m.sender) : undefined;
  const self = d.entity instanceof Api.User && Boolean(d.entity.self);
  return {
    id: d.id.toString(),
    title: self ? "Saved Messages" : (d.title ?? displayName(d.entity)),
    self,
    kind: chatType(d.entity),
    username: username(d.entity),
    unread: d.unreadCount,
    mentions: d.unreadMentionsCount,
    muted: muteUntil > Date.now() / 1000,
    pinned: d.pinned,
    last: m
      ? {
          text: m instanceof Api.MessageService ? `[${m.action.className.replace(/^MessageAction/, "")}]` : m.message,
          from,
          out: Boolean(m.out) || m.senderId?.toString() === me,
          date: m.date,
          media: m instanceof Api.Message ? mediaLabel(m) : undefined,
        }
      : undefined,
  };
}

export class GramSource implements DataSource {
  private client!: TelegramClient;
  private me = "";
  private entities = new Map<string, Entity>();
  private listeners = new Set<(e: SourceEvent) => void>();
  private detach: (() => void) | undefined;

  static async open(account?: string): Promise<GramSource> {
    setKeepAlive(true);
    const s = new GramSource();
    await s.connect(account);
    return s;
  }

  private async connect(account: string | undefined) {
    // build and check the new connection first; only then drop the old one, so a failed switch changes nothing
    const prev = sessionOverride();
    if (account) setSessionPath(accountSessionPath(account), account);
    let client: TelegramClient;
    try {
      client = await getClient();
      if (!(await client.checkAuthorization())) {
        throw new CliError(`account "${activeAccount()}" is not logged in. run: telegram login ${activeAccount()}`);
      }
    } catch (err) {
      if (account && this.client) setSessionPath(prev.path, prev.account);
      throw err;
    }
    const me = (await client.getMe()).id.toString();
    this.detach?.();
    this.client = client;
    this.me = me;
    this.entities.clear();
    this.attach();
  }

  account(): string {
    return activeAccount();
  }

  accounts(): string[] {
    return listAccounts().map((a) => a.name);
  }

  async switchAccount(name: string) {
    await this.connect(name);
  }

  private async entity(chatId: string): Promise<Entity> {
    const known = this.entities.get(chatId);
    if (known) return known;
    const e = await resolveIn(this.client, chatId, this.account());
    this.entities.set(chatId, e);
    return e;
  }

  async listChats(limit: number): Promise<ChatSummary[]> {
    const dialogs = await fetchDialogs(this.client, limit, true);
    const out: ChatSummary[] = [];
    for (const d of dialogs) {
      const s = toSummary(d, this.me);
      if (!s) continue;
      this.entities.set(s.id, d.entity as Entity);
      out.push(s);
    }
    return out;
  }

  async history(chatId: string, opts: { limit: number; before?: number }): Promise<Msg[]> {
    const e = await this.entity(chatId);
    const msgs = (await this.client.getMessages(e, { limit: opts.limit, offsetId: opts.before ?? 0 })) as TgMessage[];
    return msgs.map((m) => toMsg(m, m.sender as Entity | undefined, this.me)).reverse();
  }

  async send(chatId: string, text: string, opts: SendOpts): Promise<Msg> {
    const e = await this.entity(chatId);
    const sent = opts.file
      ? await this.client.sendFile(e, { file: opts.file, caption: text, replyTo: opts.replyTo })
      : await this.client.sendMessage(e, { message: text, replyTo: opts.replyTo });
    return toMsg(sent, undefined, this.me);
  }

  async markRead(chatId: string) {
    await this.client.markAsRead(await this.entity(chatId));
  }

  async markUnread(chatId: string) {
    const peer = utils.getInputPeer(await this.entity(chatId));
    await this.client.invoke(new Api.messages.MarkDialogUnread({ peer: new Api.InputDialogPeer({ peer }), unread: true }));
  }

  async search(query: string, chatId?: string): Promise<SearchHit[]> {
    if (chatId) {
      const e = await this.entity(chatId);
      const msgs = (await this.client.getMessages(e, { search: query, limit: 50 })) as TgMessage[];
      return msgs.map((m) => ({ chat: { id: chatId, title: displayName(e) }, msg: toMsg(m, m.sender as Entity | undefined, this.me) }));
    }
    const res = await this.client.invoke(
      new Api.messages.SearchGlobal({
        q: query,
        filter: new Api.InputMessagesFilterEmpty(),
        minDate: 0,
        maxDate: 0,
        offsetRate: 0,
        offsetPeer: new Api.InputPeerEmpty(),
        offsetId: 0,
        limit: 50,
      })
    );
    if (res instanceof Api.messages.MessagesNotModified) return [];
    const byId = new Map<string, Entity>();
    for (const e of [...res.users, ...res.chats]) if (isEntity(e)) byId.set(utils.getPeerId(e).toString(), e);
    const hits: SearchHit[] = [];
    for (const m of res.messages) {
      if (!(m instanceof Api.Message || m instanceof Api.MessageService)) continue;
      const chat = byId.get(utils.getPeerId(m.peerId).toString());
      if (!chat) continue;
      this.entities.set(peerId(chat), chat);
      const sender = m.fromId ? byId.get(utils.getPeerId(m.fromId).toString()) : m.out ? undefined : chat;
      hits.push({ chat: { id: peerId(chat), title: displayName(chat) }, msg: toMsg(m, sender, this.me) });
    }
    return hits;
  }

  async download(chatId: string, msgId: number): Promise<string> {
    const e = await this.entity(chatId);
    const [m] = (await this.client.getMessages(e, { ids: msgId })) as (Api.Message | undefined)[];
    if (!m?.media) throw new Error(`message #${msgId} has no media`);
    const dir = join(tmpdir(), "supertelegram");
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${chatId}-${msgId}`);
    const path = await this.client.downloadMedia(m, { outputFile: target });
    if (typeof path !== "string") throw new Error(`download of #${msgId} produced no file`);
    return path;
  }

  subscribe(cb: (e: SourceEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: SourceEvent) {
    for (const l of this.listeners) l(e);
  }

  private attach() {
    const client = this.client;
    const onMessage = async (event: NewMessageEvent) => {
      const m = event.message;
      const chatId = utils.getPeerId(m.peerId).toString();
      const mine = m.out || m.senderId?.toString() === this.me;
      const sender = mine ? undefined : ((await m.getSender()) as Entity | undefined);
      this.emit({ type: "message", chatId, msg: toMsg(m, sender, this.me) });
    };
    const onRaw = (update: unknown) => {
      if (update instanceof UpdateConnectionState) {
        this.emit({ type: "online", online: update.state === UpdateConnectionState.connected });
      } else if (update instanceof Api.UpdateReadHistoryInbox) {
        this.emit({ type: "read", chatId: utils.getPeerId(update.peer).toString() });
      } else if (update instanceof Api.UpdateReadChannelInbox) {
        this.emit({ type: "read", chatId: utils.getPeerId(new Api.PeerChannel({ channelId: update.channelId })).toString() });
      }
    };
    const newMessage = new NewMessage({});
    const raw = new Raw({});
    client.addEventHandler(onMessage, newMessage);
    client.addEventHandler(onRaw, raw);
    this.detach = () => {
      client.removeEventHandler(onMessage, newMessage);
      client.removeEventHandler(onRaw, raw);
    };
  }

  async close() {
    this.detach?.();
    await shutdown();
  }
}
