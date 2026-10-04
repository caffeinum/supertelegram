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
  contact?: boolean; // a user in your contacts (folders filter on it)
  archived?: boolean;
  last?: { text: string; from?: string; out: boolean; date: number; media?: string };
}

// a telegram chat folder (dialog filter). `all` is the built-in "All chats"
export interface Folder {
  id: number;
  title: string;
  all?: boolean;
  include: string[];
  exclude: string[];
  pinned: string[];
  contacts?: boolean;
  nonContacts?: boolean;
  groups?: boolean;
  broadcasts?: boolean;
  bots?: boolean;
  excludeMuted?: boolean;
  excludeRead?: boolean;
  excludeArchived?: boolean;
}

export interface ChatPool {
  chats: ChatSummary[]; // recent chats plus every chat a folder names
  folders: Folder[]; // in the user's telegram order; the first is the default
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
  ready?: Promise<void>; // the connection; every call waits for it, so the ui can draw before it lands
  account(): string;
  accountLabel(): string; // who you are on this account, e.g. @alekshasbeen
  accounts(): string[];
  switchAccount(name: string): Promise<void>;
  // read another account without switching to it: its identity, chat list and the newest messages of its top chats
  peek(account: string, topChats: number): Promise<{ label: string; pool: ChatPool; history: Record<string, Msg[]> }>;
  listChats(limit: number): Promise<ChatPool>;
  // chats folders name that aren't among the recent ones; slow (rate-limited), so loaded in the background
  folderExtras(folders: Folder[], have: string[]): Promise<ChatSummary[]>;
  // chronological (oldest first). `before` pages back; `around` returns a page ending at that id
  history(chatId: string, opts: { limit: number; before?: number }): Promise<Msg[]>;
  send(chatId: string, text: string, opts: SendOpts): Promise<Msg>;
  forward(fromChatId: string, msgIds: number[], toChatId: string): Promise<void>;
  markRead(chatId: string): Promise<void>;
  markUnread(chatId: string): Promise<void>;
  search(query: string, chatId?: string): Promise<SearchHit[]>;
  download(chatId: string, msgId: number): Promise<string>;
  thumbnail(chatId: string, msgId: number): Promise<string>; // a video's preview frame, as an image file
  // telegram's own speech-to-text for voice messages and video notes (premium, or a few free trials)
  transcribe(chatId: string, msgId: number): Promise<string>;
  subscribe(cb: (e: SourceEvent) => void): () => void;
  close(): Promise<void>;
}
