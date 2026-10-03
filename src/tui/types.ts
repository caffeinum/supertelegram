export type ChatKind = "user" | "bot" | "group" | "supergroup" | "channel";

export interface ChatSummary {
  id: string; // marked peer id, e.g. -5078309102
  title: string;
  kind: ChatKind;
  username?: string;
  unread: number;
  mentions: number;
  muted: boolean;
  pinned: boolean;
  self?: boolean; // saved messages
  last?: { text: string; from?: string; out: boolean; date: number; media?: string };
}

export interface Msg {
  id: number;
  date: number; // unix seconds
  out: boolean;
  senderId?: string;
  sender?: string;
  senderUsername?: string;
  text: string;
  media?: string;
  action?: string;
  replyTo?: number;
  urls?: string[]; // links in the text, including hidden ones behind link text
}

export interface SearchHit {
  chat: { id: string; title: string };
  msg: Msg;
}

export type SourceEvent =
  | { type: "message"; chatId: string; msg: Msg }
  | { type: "read"; chatId: string }
  | { type: "online"; online: boolean };

export interface SendOpts {
  replyTo?: number;
  file?: string;
}

// everything the tui needs from telegram; GramSource talks to telegram, FakeSource backs the tests
export interface DataSource {
  account(): string;
  accountLabel(): string; // who you are on this account, e.g. @alekshasbeen
  accounts(): string[];
  switchAccount(name: string): Promise<void>;
  // read another account without switching to it: its identity, chat list and the newest messages of its top chats
  peek(account: string, topChats: number): Promise<{ label: string; chats: ChatSummary[]; history: Record<string, Msg[]> }>;
  listChats(limit: number): Promise<ChatSummary[]>;
  // chronological (oldest first). `before` pages back; `around` returns a page ending at that id
  history(chatId: string, opts: { limit: number; before?: number }): Promise<Msg[]>;
  send(chatId: string, text: string, opts: SendOpts): Promise<Msg>;
  markRead(chatId: string): Promise<void>;
  markUnread(chatId: string): Promise<void>;
  search(query: string, chatId?: string): Promise<SearchHit[]>;
  download(chatId: string, msgId: number): Promise<string>;
  subscribe(cb: (e: SourceEvent) => void): () => void;
  close(): Promise<void>;
}
