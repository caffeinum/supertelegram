import type { ChatSummary, DataSource, Msg, SearchHit, SendOpts, SourceEvent } from "./types";

// in-memory telegram for tests: records every call so tests can assert on what was sent/read
export class FakeSource implements DataSource {
  calls: { method: string; args: unknown[] }[] = [];
  failNextSend: string | undefined;
  private listeners = new Set<(e: SourceEvent) => void>();
  private nextId = 1000;

  constructor(
    public chats: ChatSummary[],
    public messages: Record<string, Msg[]>,
    private accountName = "default",
    private accountNames = ["default", "work"]
  ) {}

  account() {
    return this.accountName;
  }
  accounts() {
    return this.accountNames;
  }
  async switchAccount(name: string) {
    this.calls.push({ method: "switchAccount", args: [name] });
    this.accountName = name;
  }
  async listChats(limit: number) {
    this.calls.push({ method: "listChats", args: [limit] });
    return this.chats.map((c) => ({ ...c }));
  }
  async history(chatId: string, opts: { limit: number; before?: number }) {
    this.calls.push({ method: "history", args: [chatId, opts] });
    const all = (this.messages[chatId] ?? []).filter((m) => opts.before === undefined || m.id < opts.before);
    return all.slice(-opts.limit);
  }
  async send(chatId: string, text: string, opts: SendOpts) {
    this.calls.push({ method: "send", args: [chatId, text, opts] });
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = undefined;
      throw new Error(err);
    }
    const msg: Msg = { id: this.nextId++, date: Math.floor(Date.now() / 1000), out: true, text, media: opts.file ? "photo" : undefined, replyTo: opts.replyTo };
    (this.messages[chatId] ??= []).push(msg);
    return msg;
  }
  async markRead(chatId: string) {
    this.calls.push({ method: "markRead", args: [chatId] });
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
    return `/tmp/${chatId}-${msgId}.jpg`;
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
    return this.calls.filter((c) => c.method === "send").map((c) => c.args);
  }
}
