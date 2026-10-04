import type { ChatSummary, DataSource, Folder, Msg, SearchHit, SendOpts, SourceEvent, Topic } from "./types";
import { ALL_CHATS } from "./folders";

// in-memory telegram for tests: records every call so tests can assert on what was sent/read
export class FakeSource implements DataSource {
  calls: { method: string; args: unknown[] }[] = [];
  failNextSend: string | undefined;
  historyDelayMs = 0;
  switchDelayMs = 0;
  imagePath: string | undefined;
  private listeners = new Set<(e: SourceEvent) => void>();
  private nextId = 1000;

  folders: Folder[] = [ALL_CHATS];

  constructor(
    public chats: ChatSummary[],
    public messages: Record<string, Msg[]>,
    private accountName = "default",
    private accountNames = ["default", "work"]
  ) {}

  account() {
    return this.accountName;
  }
  accountLabel() {
    return `@${this.accountName}_user`;
  }
  accounts() {
    return this.accountNames;
  }
  async switchAccount(name: string) {
    this.calls.push({ method: "switchAccount", args: [name] });
    if (this.switchDelayMs) await Bun.sleep(this.switchDelayMs);
    this.accountName = name;
  }
  peeks: string[] = [];
  async peek(account: string, topChats: number) {
    this.peeks.push(account);
    const chats = [{ id: "555", title: `${account} team`, kind: "group" as const, unread: 2, mentions: 0, muted: false, pinned: false, last: { text: `hello from ${account}`, out: false, date: Math.floor(Date.now() / 1000) } }];
    const history = { "555": [{ id: 1, date: Math.floor(Date.now() / 1000), out: false, senderId: "9", sender: "Teammate", text: `hello from ${account}` }] };
    void topChats;
    return { label: `@${account}_user`, pool: { chats, folders: [ALL_CHATS] }, history };
  }
  extras: ChatSummary[] = [];
  async folderExtras(_folders: Folder[], have: string[]) {
    this.calls.push({ method: "folderExtras", args: [have.length] });
    return this.extras.filter((c) => !have.includes(c.id));
  }
  async listChats(limit: number) {
    this.calls.push({ method: "listChats", args: [limit] });
    if (this.accountName !== "default") return (await this.peek(this.accountName, 0)).pool;
    return { chats: this.chats.map((c) => ({ ...c })), folders: this.folders };
  }
  topicList: Record<string, Topic[]> = {};
  async topics(chatId: string) {
    this.calls.push({ method: "topics", args: [chatId] });
    return this.topicList[chatId] ?? [];
  }
  async history(chatId: string, opts: { limit: number; before?: number; topicId?: number }) {
    this.calls.push({ method: "history", args: [chatId, opts] });
    if (this.historyDelayMs) await Bun.sleep(this.historyDelayMs);
    const inTopic = (m: Msg) => opts.topicId === undefined || (m.topicId ?? 1) === opts.topicId;
    const all = (this.messages[chatId] ?? []).filter((m) => (opts.before === undefined || m.id < opts.before) && inTopic(m));
    return all.slice(-opts.limit);
  }
  async send(chatId: string, text: string, opts: SendOpts) {
    this.calls.push({ method: "send", args: [chatId, text, opts, this.accountName] });
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = undefined;
      throw new Error(err);
    }
    const msg: Msg = { id: this.nextId++, date: Math.floor(Date.now() / 1000), out: true, text, media: opts.file ? "photo" : undefined, replyTo: opts.replyTo, topicId: opts.topicId };
    (this.messages[chatId] ??= []).push(msg);
    return msg;
  }
  reactLimit = 3;
  async react(chatId: string, msgId: number, emojis: string[]) {
    this.calls.push({ method: "react", args: [chatId, msgId, emojis] });
    if (emojis.length > this.reactLimit) throw new Error("REACTIONS_TOO_MANY");
  }
  async forward(fromChatId: string, msgIds: number[], toChatId: string) {
    this.calls.push({ method: "forward", args: [fromChatId, msgIds, toChatId, this.accountName] });
  }
  async markRead(chatId: string, topic?: { id: number; maxId: number }) {
    this.calls.push({ method: "markRead", args: topic ? [chatId, topic] : [chatId] });
  }
  async markUnread(chatId: string) {
    this.calls.push({ method: "markUnread", args: [chatId] });
  }
  async search(query: string, chatId?: string): Promise<SearchHit[]> {
    this.calls.push({ method: "search", args: [query, chatId] });
    const hits: SearchHit[] = [];
    for (const [id, msgs] of Object.entries(this.messages)) {
      if (chatId && id !== chatId) continue;
      const title = this.chats.find((c) => c.id === id)?.title ?? id;
      for (const m of msgs) if (m.text.toLowerCase().includes(query.toLowerCase())) hits.push({ chat: { id, title }, msg: m });
    }
    return hits;
  }
  async download(chatId: string, msgId: number) {
    this.calls.push({ method: "download", args: [chatId, msgId] });
    if (this.imagePath) return this.imagePath;
    throw new Error("no such file in the fake");
  }
  transcripts: Record<string, string> = {};
  async thumbnail(chatId: string, msgId: number) {
    this.calls.push({ method: "thumbnail", args: [chatId, msgId] });
    if (this.imagePath) return this.imagePath;
    throw new Error("no preview in the fake");
  }
  async transcribe(chatId: string, msgId: number) {
    this.calls.push({ method: "transcribe", args: [chatId, msgId] });
    const t = this.transcripts[`${chatId}:${msgId}`];
    if (t === undefined) throw new Error("transcription needs telegram premium on @fake");
    return t;
  }
  subscribe(cb: (e: SourceEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  push(e: SourceEvent) {
    for (const l of this.listeners) l(e);
  }
  async close() {}
  sent() {
    return this.calls.filter((c) => c.method === "send").map((c) => c.args.slice(0, 3));
  }
}
