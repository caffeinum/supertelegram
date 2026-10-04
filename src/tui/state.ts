import type { ChatSummary, Folder, Msg, Reaction, SearchHit, SourceEvent, Topic } from "./types";
import { ALL_CHATS, folderChats } from "./folders";

export type View = "list" | "topics" | "chat" | "results";
export type ImageProtocol = "auto" | "kitty" | "sixel" | "blocks";
export const IMAGE_PROTOCOLS: ImageProtocol[] = ["kitty", "sixel", "blocks", "auto"];
export type Mode = "normal" | "insert" | "filter";
export type PaletteKind = "all" | "chats" | "accounts" | "search" | "search-chat" | "file" | "links" | "folders" | "react";

export interface Draft {
  text: string;
  cursor: number;
  replyTo?: number;
  files: string[];
}

export interface OpenChat {
  chatId: string;
  topicId?: number; // inside a forum topic
  topicTitle?: string;
  markOnLoad?: boolean; // a topic with unread messages: mark read up to the newest once loaded
  messages: Msg[];
  sel?: number; // message id; undefined = the cursor rests on your input, below the last message
  loading: boolean;
  atStart: boolean; // no older messages left
  latest: boolean; // the newest message is loaded (false after jumping to a search hit)
  newBelow: number;
}

export interface State {
  account: string;
  accountLabel: string;
  accounts: string[];
  view: View;
  mode: Mode;
  chats: ChatSummary[];
  chatsLoaded: boolean;
  folders: Folder[]; // telegram order; the first is the default folder
  folderId?: number; // set only when the user picks a folder; otherwise the default (first) one
  filter: string;
  listSel?: string; // chat id — follows the chat, never the row
  open?: OpenChat;
  topics?: { chatId: string; items: Topic[]; sel?: number; loading: boolean }; // a forum's topic list
  results?: { query: string; scope?: string; hits: SearchHit[]; sel: number; loading: boolean };
  drafts: Record<string, Draft>; // `${account}:${chatId}`
  history: Record<string, Msg[]>; // preloaded messages per `${account}:${chatId}`, newest page
  outbox: Record<string, Draft>; // drafts in flight; restored if the send fails
  palette?: { kind: PaletteKind; query: string; index: number };
  help: boolean;
  pending: string; // first key of a sequence: "g" or "Z"
  scrollReq?: { seq: number; dir: 1 | -1 }; // half-page scroll, carried out by the visible view
  forward?: { fromChatId: string; msgIds: number[] }; // picking where to forward: the list shows every chat by recency
  viewer?: { chatId: string; msgId: number; path?: string; error?: string; video?: boolean }; // inline image (or video preview) view
  imageProtocol: ImageProtocol;
  transcripts: Record<string, { text?: string; error?: string }>; // `${account}:${chatId}:${msgId}`; absent text+error = working
  inline: Record<string, { path?: string; error?: string }>; // images shown inside the chat, same keys
  accountCache: Record<string, { label: string; chats: ChatSummary[]; folders: Folder[] }>; // other accounts, warmed in the background
  warmed: boolean;
  extrasFor?: string; // the account whose folder-only chats have been requested
  toast?: { text: string; error: boolean };
  online: boolean;
  quitArmed: boolean;
  quitPending: boolean; // quit asked while a send was in flight: quit once it lands
  swallowMeta?: boolean; // the bogus alt+key opentui emits after a garbled esc+utf-8 (option+letter as alt)
}

export type Effect =
  | { type: "loadChats" }
  | { type: "prefetch"; chatIds: string[] }
  | { type: "loadExtras" }
  | { type: "warmAccounts"; accounts: string[] }
  | { type: "openChat"; chatId: string; topicId?: number; markRead: boolean }
  | { type: "loadTopics"; chatId: string }
  | { type: "loadOlder"; chatId: string; topicId?: number; before: number }
  | { type: "jumpTo"; chatId: string; topicId?: number; msgId: number }
  | { type: "send"; key: string; chatId: string; topicId?: number; draft: Draft }
  | { type: "markRead"; chatId: string; topic?: { id: number; maxId: number } }
  | { type: "forward"; fromChatId: string; msgIds: number[]; toChatId: string; toTitle: string }
  | { type: "react"; chatId: string; msgId: number; emojis: string[]; topicId?: number }
  | { type: "markUnread"; chatId: string }
  | { type: "switchAccount"; name: string }
  | { type: "search"; query: string; chatId?: string }
  | { type: "openMedia"; chatId: string; msgId: number }
  | { type: "viewImage"; chatId: string; msgId: number; video: boolean }
  | { type: "transcribe"; key: string; chatId: string; msgId: number }
  | { type: "loadInline"; key: string; chatId: string; msgId: number; video: boolean }
  | { type: "openUrl"; url: string }
  | { type: "copy"; text: string; what: string }
  | { type: "pasteImage"; key: string; chatId: string }
  | { type: "attachPath"; path: string; key: string; chatId: string }
  | { type: "saveDrafts" }
  | { type: "saveCache" }
  | { type: "saveImageProtocol"; protocol: ImageProtocol }
  | { type: "quit" };

export function initialState(account: string, accounts: string[], drafts: Record<string, Draft>, accountLabel = ""): State {
  return {
    account,
    accountLabel,
    accounts,
    view: "list",
    mode: "normal",
    chats: [],
    chatsLoaded: false,
    folders: [ALL_CHATS],
    filter: "",
    drafts,
    history: {},
    imageProtocol: "blocks", // the one that draws everywhere (kitty drew blank in cmux); p in the viewer changes it
    transcripts: {},
    inline: {},
    accountCache: {},
    warmed: false,
    outbox: {},
    help: false,
    pending: "",
    online: true,
    quitArmed: false,
    quitPending: false,
  };
}

// media the viewer can draw: photos, stickers, and image files (not locations, voice, video…)
export function isImage(m: Msg | undefined): boolean {
  if (!m?.media) return false;
  return m.media === "photo" || m.media === "sticker" || /^file: .*\.(png|jpe?g|gif|webp|heic|bmp|tiff?)$/i.test(m.media);
}

// media with a file behind it (as opposed to a link preview, location, poll, contact…)
export function hasFile(m: Msg | undefined): boolean {
  return Boolean(m?.media && !/^(link|location|poll|contact|dice|media$)/.test(m.media));
}

export function isVideo(m: Msg | undefined): boolean {
  return Boolean(m?.media && /^video\b/.test(m.media) && !/^video note\b/.test(m.media));
}

// voice messages and round video notes: what telegram can transcribe
export function isSpeech(m: Msg | undefined): boolean {
  return Boolean(m?.media && /^(voice|video note)\b/.test(m.media));
}

export const draftKey = (s: State, conv: string) => `${s.account}:${conv}`;

// a conversation: a chat, or one topic of a forum. drafts, cached history and sends are per conversation
export const convId = (chatId: string, topicId?: number) => (topicId === undefined ? chatId : `${chatId}#${topicId}`);
export const openConv = (s: State) => (s.open ? convId(s.open.chatId, s.open.topicId) : "");

// in a forum, a message without a topic header is in General (1)
export function msgConv(s: State, chatId: string, m: Msg): string {
  return chatById(s, chatId)?.forum ? convId(chatId, m.topicId ?? 1) : chatId;
}
export const emptyDraft = (): Draft => ({ text: "", cursor: 0, files: [] });

export function currentDraft(s: State): Draft | undefined {
  return s.open ? s.drafts[draftKey(s, openConv(s))] : undefined;
}

export function hasDraft(d: Draft | undefined): boolean {
  return Boolean(d && (d.text.trim() || d.files.length || d.replyTo));
}

export function chatById(s: State, id: string | undefined): ChatSummary | undefined {
  return id === undefined ? undefined : s.chats.find((c) => c.id === id);
}

export function currentFolder(s: State): Folder {
  return s.folders.find((f) => f.id === s.folderId) ?? s.folders[0] ?? ALL_CHATS;
}

// the list on screen: the current folder, narrowed by a / filter (which searches every chat, like telegram).
// while picking a forward target: every chat, most recent first
export function visibleChats(s: State): ChatSummary[] {
  const q = s.filter.toLowerCase();
  if (s.forward) {
    const recent = s.chats.filter((c) => !c.archived).sort((a, b) => (b.last?.date ?? 0) - (a.last?.date ?? 0));
    return q ? recent.filter((c) => c.title.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q)) : recent;
  }
  if (!q) return folderChats(s.chats, currentFolder(s));
  return s.chats.filter((c) => c.title.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q));
}

// actions arriving from effects and telegram, as opposed to keys
export type Action =
  | { type: "chatsLoaded"; chats: ChatSummary[]; folders: Folder[] }
  | { type: "chatsExtended"; account: string; chats: ChatSummary[] }
  | { type: "historyLoaded"; chatId: string; topicId?: number; msgs: Msg[]; mode: "replace" | "prepend"; select?: number; latest: boolean; limit: number }
  | { type: "topicsLoaded"; chatId: string; items: Topic[] }
  | { type: "prefetched"; key: string; msgs: Msg[] }
  | { type: "accountWarmed"; account: string; label: string; chats: ChatSummary[]; folders: Folder[]; history: Record<string, Msg[]> }
  | { type: "historyFailed"; chatId: string; error: string }
  | { type: "sent"; key: string; chatId: string; msg: Msg }
  | { type: "sendFailed"; key: string; error: string; unsent: Draft }
  | { type: "searchResults"; hits: SearchHit[] }
  | { type: "attach"; path: string; key: string; chatId: string }
  | { type: "insertText"; text: string }
  | { type: "accountSwitched"; account: string; label: string }
  | { type: "toast"; text: string; error?: boolean }
  | { type: "pick"; id: string } // the view picked the row under the cursor after scrolling
  | { type: "resync" } // backstop for missed live updates (gramjs has no catch-up): refresh list + open chat
  | { type: "viewerReady"; chatId: string; msgId: number; path?: string; error?: string }
  | { type: "transcribed"; key: string; text?: string; error?: string }
  | { type: "inlineReady"; key: string; path?: string; error?: string }
  | { type: "event"; event: SourceEvent };

export const PREFETCH_TOP = 10;

// telegram's order: pinned topics first, then by latest message
export function sortTopics(items: Topic[]): Topic[] {
  return [...items].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (b.last?.date ?? 0) - (a.last?.date ?? 0));
}

export function visibleTopics(s: State): Topic[] {
  const items = s.topics?.items ?? [];
  const q = s.filter.toLowerCase();
  return q ? items.filter((t) => t.title.toLowerCase().includes(q)) : items;
}

// messages we already know for a chat: shown instantly on open, refreshed in the background
export function remember(s: State, conv: string, msgs: Msg[]): Record<string, Msg[]> {
  const key = draftKey(s, conv);
  return { ...s.history, [key]: mergeMessages(s.history[key] ?? [], msgs).slice(-200) };
}

// chats worth preloading: not yet cached, and not forums (their history is per topic)
export function uncached(s: State, ids: (string | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined && !s.history[draftKey(s, id)] && !chatById(s, id)?.forum))];
}

function finishQuit(s: State, outbox: Record<string, Draft>): Effect[] {
  return s.quitPending && Object.keys(outbox).length === 0 ? [{ type: "saveDrafts" }, { type: "quit" }] : [];
}

function withChat(s: State, id: string, f: (c: ChatSummary) => ChatSummary): ChatSummary[] {
  return s.chats.map((c) => (c.id === id ? f(c) : c));
}

function bumpToTop(chats: ChatSummary[], id: string): ChatSummary[] {
  const i = chats.findIndex((c) => c.id === id);
  if (i <= 0) return chats;
  const chat = chats[i]!;
  if (chat.pinned) return chats;
  const firstUnpinned = chats.findIndex((c) => !c.pinned);
  const rest = chats.filter((_, j) => j !== i);
  rest.splice(Math.max(0, firstUnpinned), 0, chat);
  return rest;
}

function mergeMessages(a: Msg[], b: Msg[]): Msg[] {
  const byId = new Map<number, Msg>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.id - y.id);
}

export function apply(s: State, a: Action): [State, Effect[]] {
  switch (a.type) {
    case "chatsLoaded": {
      // open on the default folder (the first in the user's telegram order) unless one is already chosen
      const folders = a.folders.length ? a.folders : [ALL_CHATS];
      const folderId = folders.some((f) => f.id === s.folderId) ? s.folderId : undefined;
      const shaped = { ...s, chats: a.chats, folders, folderId };
      const shown = visibleChats(shaped);
      const listSel = s.listSel && shown.some((c) => c.id === s.listSel) ? s.listSel : shown[0]?.id;
      const done = s.toast?.text === "refreshing…" ? { toast: { text: `refreshed · ${a.chats.length} chats`, error: false } } : {};
      const next = { ...shaped, chatsLoaded: true, listSel, warmed: true, ...done };
      const warm = uncached(next, shown.slice(0, PREFETCH_TOP).map((c) => c.id));
      const others = s.warmed ? [] : s.accounts.filter((x) => x !== s.account);
      // chats only a folder names are kept across refreshes (they're not among the recent ones)
      const keep = s.chats.filter((c) => !a.chats.some((x) => x.id === c.id) && folders.some((f) => !f.all && (f.include.includes(c.id) || f.pinned.includes(c.id))));
      const needsExtras = folders.some((f) => !f.all && (f.include.length || f.pinned.length)) && s.extrasFor !== s.account;
      const merged = { ...next, chats: [...a.chats, ...keep], extrasFor: needsExtras ? s.account : s.extrasFor };
      return [
        merged,
        [
          { type: "saveCache" as const },
          ...(warm.length ? [{ type: "prefetch" as const, chatIds: warm }] : []),
          ...(needsExtras ? [{ type: "loadExtras" as const }] : []),
          ...(others.length ? [{ type: "warmAccounts" as const, accounts: others }] : []),
        ],
      ];
    }
    case "chatsExtended": {
      if (a.account !== s.account) return [s, []];
      const known = new Set(s.chats.map((c) => c.id));
      const added = a.chats.filter((c) => !known.has(c.id));
      return [{ ...s, chats: [...s.chats, ...added] }, added.length ? [{ type: "saveCache" }] : []];
    }
    case "accountWarmed": {
      if (a.account === s.account) return [s, []];
      const history = { ...s.history };
      for (const [chatId, msgs] of Object.entries(a.history)) history[`${a.account}:${chatId}`] = msgs;
      return [{ ...s, history, accountCache: { ...s.accountCache, [a.account]: { label: a.label, chats: a.chats, folders: a.folders } } }, []];
    }
    case "prefetched": {
      if (!a.key.startsWith(`${s.account}:`)) return [s, []];
      const known = s.history[a.key] ?? [];
      return [{ ...s, history: { ...s.history, [a.key]: mergeMessages(known, a.msgs).slice(-200) } }, []];
    }
    case "historyLoaded": {
      const conv = convId(a.chatId, a.topicId);
      if (!s.open || openConv(s) !== conv) return [{ ...s, history: a.latest ? remember(s, conv, a.msgs) : s.history }, []];
      const o = s.open;
      const onInput = o.sel === undefined;
      // a refresh of a chat shown from cache merges in, so nothing jumps under the cursor
      const refreshing = a.mode === "replace" && a.latest && o.latest && o.messages.length > 0;
      const messages = a.mode === "replace" && !refreshing ? a.msgs : mergeMessages(a.msgs, o.messages);
      const sel =
        a.mode === "prepend"
          ? (a.msgs[a.msgs.length - 1]?.id ?? o.sel)
          : refreshing
            ? onInput
              ? undefined
              : o.sel
            : a.select; // a fresh open rests on the input row; a search jump lands on its hit
      return [
        {
          ...s,
          history: a.latest ? remember(s, conv, a.msgs) : s.history,
          open: {
            ...o,
            messages,
            sel,
            loading: false,
            atStart: a.mode === "prepend" || !refreshing ? a.msgs.length < a.limit : o.atStart,
            latest: a.mode === "replace" ? a.latest : o.latest,
            newBelow: a.mode === "replace" ? 0 : o.newBelow,
            markOnLoad: false,
          },
          topics:
            o.markOnLoad && s.topics?.chatId === a.chatId
              ? { ...s.topics, items: s.topics.items.map((t) => (t.id === a.topicId ? { ...t, unread: 0 } : t)) }
              : s.topics,
        },
        o.markOnLoad && a.topicId !== undefined && messages.length
          ? [{ type: "markRead", chatId: a.chatId, topic: { id: a.topicId, maxId: messages[messages.length - 1]!.id } }]
          : [],
      ];
    }
    case "topicsLoaded": {
      if (s.topics?.chatId !== a.chatId) return [s, []];
      const items = sortTopics(a.items);
      const sel = s.topics.sel !== undefined && items.some((t) => t.id === s.topics!.sel) ? s.topics.sel : items[0]?.id;
      return [{ ...s, topics: { chatId: a.chatId, items, sel, loading: false } }, []];
    }
    case "historyFailed":
      return [
        { ...s, open: s.open && { ...s.open, loading: false }, toast: { text: `couldn't load messages: ${a.error}`, error: true } },
        [],
      ];
    case "sent": {
      const outbox = { ...s.outbox };
      delete outbox[a.key];
      const done = finishQuit(s, outbox);
      // a send that lands after an account switch belongs to the old account's chat: don't touch this list
      if (!a.key.startsWith(`${s.account}:`)) return [{ ...s, outbox }, done];
      const conv = msgConv(s, a.chatId, a.msg);
      let open = s.open;
      if (open && openConv(s) === conv && open.latest) {
        open = { ...open, messages: mergeMessages(open.messages, [a.msg]) };
      }
      const chats = bumpToTop(
        withChat(s, a.chatId, (c) => ({ ...c, unread: 0, last: { text: a.msg.text, out: true, date: a.msg.date, media: a.msg.media } })),
        a.chatId
      );
      return [{ ...s, outbox, open, chats, history: remember(s, conv, [a.msg]) }, done];
    }
    case "sendFailed": {
      // never retried: put back what didn't go out (files already sent stay sent), and say what happened
      const outbox = { ...s.outbox };
      delete outbox[a.key];
      const drafts = { ...s.drafts };
      const now = drafts[a.key];
      if (hasDraft(a.unsent)) {
        drafts[a.key] = hasDraft(now)
          ? (() => {
              const text = [a.unsent.text, now!.text].filter(Boolean).join("\n");
              return { text, cursor: text.length, files: [...a.unsent.files, ...now!.files], replyTo: now!.replyTo ?? a.unsent.replyTo };
            })()
          : { ...a.unsent, cursor: a.unsent.text.length };
      }
      return [
        { ...s, outbox, drafts, toast: { text: `not sent: ${a.error} — what didn't go out is back in the prompt`, error: true } },
        [{ type: "saveDrafts" }, ...finishQuit(s, outbox)],
      ];
    }
    case "searchResults":
      return [s.results ? { ...s, results: { ...s.results, hits: a.hits, sel: 0, loading: false } } : s, []];
    case "attach": {
      // the attachment belongs to the chat it was pasted in, even if the clipboard answered after you moved on
      const d = s.drafts[a.key] ?? emptyDraft();
      const here = s.view === "chat" && s.open?.chatId === a.chatId && a.key === draftKey(s, a.chatId);
      return [
        { ...s, mode: here ? "insert" : s.mode, drafts: { ...s.drafts, [a.key]: { ...d, files: [...d.files, a.path] } } },
        [{ type: "saveDrafts" }],
      ];
    }
    case "insertText": {
      if (!s.open) return [s, []];
      const key = draftKey(s, s.open.chatId);
      const d = s.drafts[key] ?? emptyDraft();
      const text = d.text.slice(0, d.cursor) + a.text + d.text.slice(d.cursor);
      return [{ ...s, drafts: { ...s.drafts, [key]: { ...d, text, cursor: d.cursor + a.text.length } } }, [{ type: "saveDrafts" }]];
    }
    case "accountSwitched": {
      // the warmed view (if any) is already on screen; this only confirms and refreshes it
      if (s.account === a.account) return [{ ...s, accountLabel: a.label }, [{ type: "loadChats" }]];
      return [
        { ...s, account: a.account, accountLabel: a.label, chats: [], chatsLoaded: false, folders: [ALL_CHATS], folderId: undefined, open: undefined, results: undefined, view: "list", mode: "normal", listSel: undefined, filter: "" },
        [{ type: "loadChats" }],
      ];
    }
    case "toast":
      return [{ ...s, toast: { text: a.text, error: Boolean(a.error) } }, []];
    case "inlineReady":
      // only if it wasn't collapsed while loading
      if (!s.inline[a.key]) return [s, []];
      return [{ ...s, inline: { ...s.inline, [a.key]: { path: a.path, error: a.error } } }, []];
    case "transcribed":
      return [{ ...s, transcripts: { ...s.transcripts, [a.key]: { text: a.text, error: a.error } } }, []];
    case "viewerReady":
      // only if the user is still looking at that image
      if (!s.viewer || s.viewer.chatId !== a.chatId || s.viewer.msgId !== a.msgId) return [s, []];
      return [{ ...s, viewer: { ...s.viewer, path: a.path, error: a.error } }, []];
    case "resync": {
      const effects: Effect[] = [{ type: "loadChats" }];
      if (s.view === "chat" && s.open?.latest && !s.open.loading) effects.push({ type: "openChat", chatId: s.open.chatId, markRead: false });
      return [s, effects];
    }
    case "pick": {
      if (s.view === "list") {
        const next = { ...s, listSel: a.id };
        const i = s.chats.findIndex((c) => c.id === a.id);
        const around = uncached(next, [s.chats[i]?.id, s.chats[i + 1]?.id, s.chats[i - 1]?.id]);
        return [next, around.length ? [{ type: "prefetch", chatIds: around }] : []];
      }
      if (s.view === "results" && s.results) return [{ ...s, results: { ...s.results, sel: Number(a.id) } }, []];
      if (s.view === "topics" && s.topics) return [{ ...s, topics: { ...s.topics, sel: Number(a.id) } }, []];
      if (s.view === "chat" && s.open) {
        const o = s.open;
        const id = Number(a.id);
        const first = o.messages[0]?.id === id && !o.atStart && !o.loading;
        return [{ ...s, open: { ...o, sel: id, loading: o.loading || first } }, first ? [{ type: "loadOlder", chatId: o.chatId, before: id }] : []];
      }
      return [s, []];
    }
    case "event":
      return applyEvent(s, a.event);
  }
}

// reactions changed on a message: the open chat and any cached history of it
export function setReactions(s: State, chatId: string, msgId: number, reactions: Reaction[]): State {
  const patch = (msgs: Msg[]) => msgs.map((m) => (m.id === msgId ? { ...m, reactions: reactions.length ? reactions : undefined } : m));
  const prefix = `${s.account}:${chatId}`;
  const history = Object.fromEntries(Object.entries(s.history).map(([k, v]) => [k, k === prefix || k.startsWith(`${prefix}#`) ? patch(v) : v]));
  const open = s.open?.chatId === chatId ? { ...s.open, messages: patch(s.open.messages) } : s.open;
  return { ...s, open, history };
}

function applyEvent(s: State, e: SourceEvent): [State, Effect[]] {
  if (e.type === "online") return [{ ...s, online: e.online }, e.online ? [{ type: "loadChats" }] : []];
  if (e.type === "read") return [{ ...s, chats: withChat(s, e.chatId, (c) => ({ ...c, unread: 0, mentions: 0 })) }, []];
  if (e.type === "reactions") return [setReactions(s, e.chatId, e.msgId, e.reactions), []];

  const conv = msgConv(s, e.chatId, e.msg);
  const viewing = s.view === "chat" && openConv(s) === conv;
  const effects: Effect[] = [];
  if (!s.chats.some((c) => c.id === e.chatId)) effects.push({ type: "loadChats" });
  const chats = bumpToTop(
    withChat(s, e.chatId, (c) => ({
      ...c,
      unread: e.msg.out || viewing ? c.unread : c.unread + 1,
      last: { text: e.msg.text, from: e.msg.sender, out: e.msg.out, date: e.msg.date, media: e.msg.media },
    })),
    e.chatId
  );

  let open = s.open;
  if (open && openConv(s) === conv && open.latest && !open.messages.some((m) => m.id === e.msg.id)) {
    // on the input row you're at the bottom and see it arrive; on a message, it's counted below you
    open = {
      ...open,
      messages: mergeMessages(open.messages, [e.msg]),
      newBelow: open.sel === undefined ? open.newBelow : open.newBelow + 1,
    };
    if (viewing && !e.msg.out) {
      effects.push(open.topicId !== undefined ? { type: "markRead", chatId: e.chatId, topic: { id: open.topicId, maxId: e.msg.id } } : { type: "markRead", chatId: e.chatId });
    }
  }
  const key = draftKey(s, conv);
  const history = s.history[key] ? { ...s.history, [key]: mergeMessages(s.history[key]!, [e.msg]).slice(-200) } : s.history;
  // the forum's topic list, if it's loaded: that topic gets the new last message
  let topics = s.topics;
  if (topics?.chatId === e.chatId) {
    const tid = e.msg.topicId ?? 1;
    topics = {
      ...topics,
      items: sortTopics(
        topics.items.map((t) =>
          t.id === tid
            ? { ...t, unread: e.msg.out || viewing ? t.unread : t.unread + 1, last: { text: e.msg.text || (e.msg.media ? `[${e.msg.media}]` : ""), from: e.msg.sender, date: e.msg.date, out: e.msg.out } }
            : t
        )
      ),
    };
  }
  return [{ ...s, chats, open, history, topics }, effects];
}
