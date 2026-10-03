import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api, utils, type TelegramClient } from "telegram";
import { NewMessage, type NewMessageEvent } from "telegram/events";
import { Raw } from "telegram/events/Raw";
import { UpdateConnectionState } from "telegram/network";
import type { Dialog } from "telegram/tl/custom/dialog";
import { activeAccount, fetchDialogs, getClient, getClientFor, resolveIn, sessionOverride, setKeepAlive, setSessionPath, shutdown, type Entity } from "../client/telegram";
import { accountSessionPath, listAccounts } from "../config/accounts";
import { chatType, displayName, mediaLabel, peerId, username } from "../cli/format";
import { CliError } from "../cli/errors";
import { defaultFileName } from "../cli/chat";
import type { ChatPool, ChatSummary, DataSource, Folder, Msg, SearchHit, SendOpts, SourceEvent } from "./types";
import { Dialog as TgDialog } from "telegram/tl/custom/dialog";
import { ALL_CHATS } from "./folders";

type TgMessage = Api.Message | Api.MessageService;

function isEntity(e: unknown): e is Entity {
  return e instanceof Api.User || e instanceof Api.Chat || e instanceof Api.Channel;
}

// telegram leaves `out` false on your own messages in saved messages, so compare the sender with me too
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

function linksOf(m: TgMessage): string[] | undefined {
  if (m instanceof Api.MessageService) return undefined;
  const found = new Set<string>(m.message.match(URL_RE) ?? []);
  for (const e of m.entities ?? []) {
    if (e instanceof Api.MessageEntityTextUrl) found.add(e.url);
    if (e instanceof Api.MessageEntityUrl) {
      const raw = m.message.slice(e.offset, e.offset + e.length);
      found.add(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    }
  }
  return found.size ? [...found] : undefined;
}

export function toMsg(m: TgMessage, sender: Entity | undefined, me?: string): Msg {
  const service = m instanceof Api.MessageService;
  return {
    urls: linksOf(m),
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
    contact: d.entity instanceof Api.User ? Boolean(d.entity.contact) : undefined,
    archived: d.archived || d.folderId === 1,
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

// who an account is, from the registry, before the connection confirms it
function cachedLabel(account: string): string {
  const meta = listAccounts().find((a) => a.name === account)?.meta;
  return meta?.username ? `@${meta.username}` : (meta?.name ?? "");
}

function titleOf(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object" && "text" in t) return String((t as { text: string }).text);
  throw new Error("folder without a title");
}

// marked chat id of an input peer (gramjs's getPeerId can't take InputPeerChat)
function inputPeerId(p: Api.TypeInputPeer, me: string): string | undefined {
  if (p instanceof Api.InputPeerUser || p instanceof Api.InputPeerUserFromMessage) return p.userId.toString();
  if (p instanceof Api.InputPeerChat) return `-${p.chatId.toString()}`;
  if (p instanceof Api.InputPeerChannel || p instanceof Api.InputPeerChannelFromMessage) return `-100${p.channelId.toString()}`;
  if (p instanceof Api.InputPeerSelf) return me;
  return undefined;
}

function toFolder(f: Api.TypeDialogFilter, me: string): Folder {
  if (f instanceof Api.DialogFilterDefault) return ALL_CHATS;
  const ids = (peers: Api.TypeInputPeer[] | undefined) => (peers ?? []).map((p) => inputPeerId(p, me)).filter((x): x is string => x !== undefined);
  const base = { id: f.id, title: titleOf(f.title), include: ids(f.includePeers), pinned: ids(f.pinnedPeers) };
  if (f instanceof Api.DialogFilterChatlist) return { ...base, exclude: [] };
  return {
    ...base,
    exclude: ids(f.excludePeers),
    contacts: f.contacts,
    nonContacts: f.nonContacts,
    groups: f.groups,
    broadcasts: f.broadcasts,
    bots: f.bots,
    excludeMuted: f.excludeMuted,
    excludeRead: f.excludeRead,
    excludeArchived: f.excludeArchived,
  };
}

const rawFilters = new WeakMap<TelegramClient, Api.TypeDialogFilter[]>();

// the recent chats and the folder definitions: what the first screen needs
async function loadPool(client: TelegramClient, me: string, entities: Map<string, Entity>): Promise<ChatPool> {
  const dialogs = await fetchDialogs(client, 200, true);
  const chats: ChatSummary[] = [];
  for (const d of dialogs) {
    const s = toSummary(d, me);
    if (!s) continue;
    entities.set(s.id, d.entity as Entity);
    chats.push(s);
  }
  const res = await client.invoke(new Api.messages.GetDialogFilters());
  const raw = "filters" in res ? res.filters : (res as unknown as Api.TypeDialogFilter[]);
  rawFilters.set(client, raw);
  const folders = raw.length ? raw.map((f) => toFolder(f, me)) : [ALL_CHATS];
  if (!folders.some((f) => f.all)) folders.push(ALL_CHATS);

  return { chats, folders };
}


// chats a folder names that aren't among the recent ones. telegram rate-limits getPeerDialogs
// (a second batch of 100 back-to-back drew a ~10s flood wait), so batches are spaced out
async function loadExtras(client: TelegramClient, me: string, entities: Map<string, Entity>, have0: string[]): Promise<ChatSummary[]> {
  const raw = rawFilters.get(client) ?? [];
  const chats: ChatSummary[] = [];
  const have = new Set(have0);
  const wanted = new Map<string, Api.TypeInputPeer>();
  for (const f of raw) {
    if (f instanceof Api.DialogFilterDefault) continue;
    for (const p of [...f.pinnedPeers, ...f.includePeers]) {
      const id = inputPeerId(p, me);
      if (id !== undefined && !have.has(id)) wanted.set(id, p);
    }
  }
  const peers = [...wanted.values()];
  for (let i = 0; i < peers.length; i += 100) {
    if (i > 0) await Bun.sleep(EXTRAS_GAP_MS);
    const r = await client.invoke(new Api.messages.GetPeerDialogs({ peers: peers.slice(i, i + 100).map((peer) => new Api.InputDialogPeer({ peer })) }));
    const byId = new Map<string, Entity>();
    for (const e of [...r.users, ...r.chats]) if (isEntity(e)) byId.set(utils.getPeerId(e).toString(), e);
    const msgs = new Map<string, Api.Message>();
    for (const m of r.messages) {
      if (!(m instanceof Api.Message || m instanceof Api.MessageService)) continue;
      (m as unknown as { _finishInit?: (c: TelegramClient, e: Map<string, Entity>, i?: undefined) => void })._finishInit?.(client, byId, undefined);
      msgs.set(`${utils.getPeerId(m.peerId)}:${m.id}`, m as Api.Message);
    }
    for (const d of r.dialogs) {
      if (!(d instanceof Api.Dialog)) continue;
      const id = utils.getPeerId(d.peer).toString();
      if (!byId.has(id) || have.has(id)) continue;
      const entity = byId.get(id)!;
      const top = msgs.get(`${id}:${d.topMessage}`);
      // gramjs's Dialog needs a message; an empty chat still belongs in its folder, just without a preview
      const s = top
        ? toSummary(new TgDialog(client, d, byId as never, top), me)
        : {
            id,
            title: displayName(entity),
            kind: chatType(entity),
            username: username(entity),
            unread: d.unreadCount,
            mentions: d.unreadMentionsCount,
            muted: (d.notifySettings?.muteUntil ?? 0) > Date.now() / 1000,
            pinned: Boolean(d.pinned),
            contact: entity instanceof Api.User ? Boolean(entity.contact) : undefined,
            archived: d.folderId === 1,
          };
      if (!s) continue;
      entities.set(s.id, entity);
      have.add(id);
      chats.push(s);
    }
  }
  return chats;
}

const EXTRAS_GAP_MS = 2000;

export class GramSource implements DataSource {
  private client!: TelegramClient;
  private me = "";
  private label = "";
  private entities = new Map<string, Entity>();
  private listeners = new Set<(e: SourceEvent) => void>();
  private detach: (() => void) | undefined;

  ready: Promise<void> = Promise.resolve();

  static async open(account?: string): Promise<GramSource> {
    const s = GramSource.start(account);
    await s.ready;
    return s;
  }

  // returns at once; the connection lands on `ready`, and every telegram call waits for it
  static start(account?: string): GramSource {
    setKeepAlive(true);
    const s = new GramSource();
    if (account) setSessionPath(accountSessionPath(account), account);
    s.label = cachedLabel(activeAccount());
    s.ready = s.connect(account);
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
    const self = await client.getMe();
    this.detach?.();
    this.client = client;
    this.me = self.id.toString();
    this.label = self.username ? `@${self.username}` : [self.firstName, self.lastName].filter(Boolean).join(" ") || `id ${this.me}`;
    this.entities.clear();
    this.attach();
  }

  account(): string {
    return activeAccount();
  }

  accountLabel(): string {
    return this.label;
  }

  accounts(): string[] {
    return listAccounts().map((a) => a.name);
  }

  async switchAccount(name: string) {
    await this.ready.catch(() => undefined);
    this.ready = this.connect(name);
    await this.ready;
  }

  private async entity(chatId: string): Promise<Entity> {
    const known = this.entities.get(chatId);
    if (known) return known;
    const e = await resolveIn(this.client, chatId, this.account());
    this.entities.set(chatId, e);
    return e;
  }

  async peek(account: string, topChats: number) {
    await this.ready;
    const client = await getClientFor(accountSessionPath(account));
    if (!(await client.checkAuthorization())) throw new CliError(`account "${account}" is not logged in`);
    const self = await client.getMe();
    const me = self.id.toString();
    const label = self.username ? `@${self.username}` : [self.firstName, self.lastName].filter(Boolean).join(" ") || `id ${me}`;
    const peekEntities = new Map<string, Entity>();
    const pool = await loadPool(client, me, peekEntities);
    pool.chats.push(...(await loadExtras(client, me, peekEntities, pool.chats.map((c) => c.id))));
    const history: Record<string, Msg[]> = {};
    for (const c of pool.chats.slice(0, topChats)) {
      const e = peekEntities.get(c.id);
      if (!e) continue;
      const msgs = (await client.getMessages(e, { limit: 60 })) as TgMessage[];
      history[c.id] = msgs.map((m) => toMsg(m, m.sender as Entity | undefined, me)).reverse();
    }
    return { label, pool, history };
  }

  async listChats(_limit: number): Promise<ChatPool> {
    await this.ready;
    return loadPool(this.client, this.me, this.entities);
  }

  async folderExtras(_folders: Folder[], have: string[]): Promise<ChatSummary[]> {
    await this.ready;
    return loadExtras(this.client, this.me, this.entities, have);
  }

  async history(chatId: string, opts: { limit: number; before?: number }): Promise<Msg[]> {
    await this.ready;
    const e = await this.entity(chatId);
    const msgs = (await this.client.getMessages(e, { limit: opts.limit, offsetId: opts.before ?? 0 })) as TgMessage[];
    return msgs.map((m) => toMsg(m, m.sender as Entity | undefined, this.me)).reverse();
  }

  async send(chatId: string, text: string, opts: SendOpts): Promise<Msg> {
    await this.ready;
    const e = await this.entity(chatId);
    const sent = opts.file
      ? await this.client.sendFile(e, { file: opts.file, caption: text, replyTo: opts.replyTo })
      : await this.client.sendMessage(e, { message: text, replyTo: opts.replyTo });
    return toMsg(sent, undefined, this.me);
  }

  async markRead(chatId: string) {
    await this.ready;
    await this.client.markAsRead(await this.entity(chatId));
  }

  async markUnread(chatId: string) {
    await this.ready;
    const peer = utils.getInputPeer(await this.entity(chatId));
    await this.client.invoke(new Api.messages.MarkDialogUnread({ peer: new Api.InputDialogPeer({ peer }), unread: true }));
  }

  async search(query: string, chatId?: string): Promise<SearchHit[]> {
    await this.ready;
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
    await this.ready;
    const e = await this.entity(chatId);
    const [m] = (await this.client.getMessages(e, { ids: msgId })) as (Api.Message | undefined)[];
    if (!m?.media) throw new Error(`message #${msgId} has no media`);
    const dir = join(tmpdir(), "supertelegram");
    mkdirSync(dir, { recursive: true });
    // keep the real extension, or the os opens a jpeg as text
    const target = join(dir, `${chatId}-${defaultFileName(m)}`);
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
    await this.ready.catch(() => undefined);
    this.detach?.();
    await shutdown();
  }
}
