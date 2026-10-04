import type { ChatSummary, DataSource, Folder, SendOpts, SourceEvent } from "./types";

// a DataSource that draws before gramjs is even loaded: the real GramSource is imported and connected
// behind the first frame, and every call waits for it
export class LazySource implements DataSource {
  ready: Promise<void>;
  private inner: DataSource | undefined;
  private listeners = new Set<(e: SourceEvent) => void>();

  constructor(
    private name: string,
    private label: string,
    private names: string[]
  ) {
    this.ready = import("./gram-source").then(async ({ GramSource }) => {
      const src = GramSource.start(name);
      src.subscribe((e) => {
        for (const l of this.listeners) l(e);
      });
      this.inner = src;
      await src.ready;
    });
  }

  private async src(): Promise<DataSource> {
    await this.ready;
    return this.inner!;
  }

  account() {
    return this.inner?.account() ?? this.name;
  }
  accountLabel() {
    return this.inner?.accountLabel() || this.label;
  }
  accounts() {
    return this.inner?.accounts() ?? this.names;
  }
  subscribe(cb: (e: SourceEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  switchAccount = async (name: string) => (await this.src()).switchAccount(name);
  peek = async (account: string, top: number) => (await this.src()).peek(account, top);
  listChats = async (limit: number) => (await this.src()).listChats(limit);
  folderExtras = async (folders: Folder[], have: string[]): Promise<ChatSummary[]> => (await this.src()).folderExtras(folders, have);
  history = async (chatId: string, opts: { limit: number; before?: number; topicId?: number }) => (await this.src()).history(chatId, opts);
  topics = async (chatId: string) => (await this.src()).topics(chatId);
  send = async (chatId: string, text: string, opts: SendOpts) => (await this.src()).send(chatId, text, opts);
  markRead = async (chatId: string, topic?: { id: number; maxId: number }) => (await this.src()).markRead(chatId, topic);
  forward = async (from: string, ids: number[], to: string) => (await this.src()).forward(from, ids, to);
  react = async (chatId: string, msgId: number, emoji: string | undefined) => (await this.src()).react(chatId, msgId, emoji);
  markUnread = async (chatId: string) => (await this.src()).markUnread(chatId);
  search = async (query: string, chatId?: string) => (await this.src()).search(query, chatId);
  download = async (chatId: string, msgId: number) => (await this.src()).download(chatId, msgId);
  thumbnail = async (chatId: string, msgId: number) => (await this.src()).thumbnail(chatId, msgId);
  transcribe = async (chatId: string, msgId: number) => (await this.src()).transcribe(chatId, msgId);
  async close() {
    await this.ready.catch(() => undefined);
    await this.inner?.close();
  }
}
