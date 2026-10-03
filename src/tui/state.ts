import type { ChatSummary, Msg, SearchHit, SourceEvent } from "./types";

export type View = "list" | "chat" | "results";
export type Mode = "normal" | "insert" | "filter";
export type PaletteKind = "all" | "chats" | "accounts" | "search" | "search-chat" | "file" | "links";

export interface Draft {
  text: string;
  cursor: number;
  replyTo?: number;
  files: string[];
}

export interface OpenChat {
  chatId: string;
  messages: Msg[];
  sel?: number; // message id
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
  filter: string;
  listSel?: string; // chat id — follows the chat, never the row
  open?: OpenChat;
  results?: { query: string; scope?: string; hits: SearchHit[]; sel: number; loading: boolean };
  drafts: Record<string, Draft>; // `${account}:${chatId}`
  history: Record<string, Msg[]>; // preloaded messages per `${account}:${chatId}`, newest page
  outbox: Record<string, Draft>; // drafts in flight; restored if the send fails
  palette?: { kind: PaletteKind; query: string; index: number };
  help: boolean;
  pending: string; // first key of a sequence: "g" or "Z"
  scrollReq?: { seq: number; dir: 1 | -1 }; // half-page scroll, carried out by the visible view
  viewer?: { chatId: string; msgId: number; path?: string; error?: string }; // inline image view
  accountCache: Record<string, { label: string; chats: ChatSummary[] }>; // other accounts, warmed in the background
  warmed: boolean;
  toast?: { text: string; error: boolean };
  online: boolean;
  quitArmed: boolean;
  quitPending: boolean; // quit asked while a send was in flight: quit once it lands
}

export type Effect =
  | { type: "loadChats" }
  | { type: "prefetch"; chatIds: string[] }
  | { type: "warmAccounts"; accounts: string[] }
  | { type: "openChat"; chatId: string; markRead: boolean }
  | { type: "loadOlder"; chatId: string; before: number }
  | { type: "jumpTo"; chatId: string; msgId: number }
  | { type: "send"; key: string; chatId: string; draft: Draft }
  | { type: "markRead"; chatId: string }
  | { type: "markUnread"; chatId: string }
  | { type: "switchAccount"; name: string }
  | { type: "search"; query: string; chatId?: string }
  | { type: "openMedia"; chatId: string; msgId: number }
  | { type: "viewImage"; chatId: string; msgId: number }
  | { type: "openUrl"; url: string }
  | { type: "copy"; text: string; what: string }
  | { type: "pasteImage"; key: string; chatId: string }
  | { type: "attachPath"; path: string; key: string; chatId: string }
  | { type: "saveDrafts" }
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
    filter: "",
    drafts,
    history: {},
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

export const draftKey = (s: State, chatId: string) => `${s.account}:${chatId}`;
export const emptyDraft = (): Draft => ({ text: "", cursor: 0, files: [] });

export function currentDraft(s: State): Draft | undefined {
  return s.open ? s.drafts[draftKey(s, s.open.chatId)] : undefined;
}

export function hasDraft(d: Draft | undefined): boolean {
  return Boolean(d && (d.text.trim() || d.files.length || d.replyTo));
}

export function chatById(s: State, id: string | undefined): ChatSummary | undefined {
  return id === undefined ? undefined : s.chats.find((c) => c.id === id);
}

export function visibleChats(s: State): ChatSummary[] {
  const q = s.filter.toLowerCase();
  if (!q) return s.chats;
  return s.chats.filter((c) => c.title.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q));
}

// actions arriving from effects and telegram, as opposed to keys
export type Action =
  | { type: "chatsLoaded"; chats: ChatSummary[] }
  | { type: "historyLoaded"; chatId: string; msgs: Msg[]; mode: "replace" | "prepend"; select?: number; latest: boolean; limit: number }
  | { type: "prefetched"; key: string; msgs: Msg[] }
  | { type: "accountWarmed"; account: string; label: string; chats: ChatSummary[]; history: Record<string, Msg[]> }
  | { type: "historyFailed"; chatId: string; error: string }
  | { type: "sent"; key: string; chatId: string; msg: Msg }
  | { type: "sendFailed"; key: string; error: string; unsent: Draft }
  | { type: "searchResults"; hits: SearchHit[] }
  | { type: "attach"; path: string; key: string; chatId: string }
  | { type: "insertText"; text: string }
  | { type: "accountSwitched"; account: string; label: string }
  | { type: "toast"; text: string; error?: boolean }
  | { type: "pick"; id: string } // the view picked the row under the cursor after scrolling
  | { type: "viewerReady"; chatId: string; msgId: number; path?: string; error?: string }
  | { type: "event"; event: SourceEvent };

export const PREFETCH_TOP = 10;

// messages we already know for a chat: shown instantly on open, refreshed in the background
export function remember(s: State, chatId: string, msgs: Msg[]): Record<string, Msg[]> {
  const key = draftKey(s, chatId);
  return { ...s.history, [key]: mergeMessages(s.history[key] ?? [], msgs).slice(-200) };
}

export function uncached(s: State, ids: (string | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== undefined && !s.history[draftKey(s, id)]))];
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
      const listSel = s.listSel && a.chats.some((c) => c.id === s.listSel) ? s.listSel : a.chats[0]?.id;
      const next = { ...s, chats: a.chats, chatsLoaded: true, listSel, warmed: true };
      const warm = uncached(next, a.chats.slice(0, PREFETCH_TOP).map((c) => c.id));
      const others = s.warmed ? [] : s.accounts.filter((x) => x !== s.account);
      return [
        next,
        [...(warm.length ? [{ type: "prefetch" as const, chatIds: warm }] : []), ...(others.length ? [{ type: "warmAccounts" as const, accounts: others }] : [])],
      ];
    }
    case "accountWarmed": {
      if (a.account === s.account) return [s, []];
      const history = { ...s.history };
      for (const [chatId, msgs] of Object.entries(a.history)) history[`${a.account}:${chatId}`] = msgs;
      return [{ ...s, history, accountCache: { ...s.accountCache, [a.account]: { label: a.label, chats: a.chats } } }, []];
    }
    case "prefetched": {
      if (!a.key.startsWith(`${s.account}:`)) return [s, []];
      const known = s.history[a.key] ?? [];
      return [{ ...s, history: { ...s.history, [a.key]: mergeMessages(known, a.msgs).slice(-200) } }, []];
    }
    case "historyLoaded": {
      if (!s.open || s.open.chatId !== a.chatId) return [{ ...s, history: a.latest ? remember(s, a.chatId, a.msgs) : s.history }, []];
      const o = s.open;
      const wasAtEnd = o.sel === undefined || o.sel === o.messages[o.messages.length - 1]?.id;
      // a refresh of a chat shown from cache merges in, so nothing jumps under the cursor
      const refreshing = a.mode === "replace" && a.latest && o.latest && o.messages.length > 0;
      const messages = a.mode === "replace" && !refreshing ? a.msgs : mergeMessages(a.msgs, o.messages);
      const sel =
        a.mode === "prepend"
          ? (a.msgs[a.msgs.length - 1]?.id ?? o.sel)
          : refreshing
            ? wasAtEnd
              ? messages[messages.length - 1]?.id
              : o.sel
            : (a.select ?? messages[messages.length - 1]?.id);
      return [
        {
          ...s,
          history: a.latest ? remember(s, a.chatId, a.msgs) : s.history,
          open: {
            ...o,
            messages,
            sel,
            loading: false,
            atStart: a.mode === "prepend" || !refreshing ? a.msgs.length < a.limit : o.atStart,
            latest: a.mode === "replace" ? a.latest : o.latest,
            newBelow: a.mode === "replace" ? 0 : o.newBelow,
          },
        },
        [],
      ];
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
      let open = s.open;
      if (open && open.chatId === a.chatId && open.latest) {
        const atEnd = open.sel === open.messages[open.messages.length - 1]?.id;
        open = { ...open, messages: mergeMessages(open.messages, [a.msg]), sel: atEnd ? a.msg.id : open.sel };
      }
      const chats = bumpToTop(
        withChat(s, a.chatId, (c) => ({ ...c, unread: 0, last: { text: a.msg.text, out: true, date: a.msg.date, media: a.msg.media } })),
        a.chatId
      );
      return [{ ...s, outbox, open, chats, history: remember(s, a.chatId, [a.msg]) }, done];
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
        { ...s, account: a.account, accountLabel: a.label, chats: [], chatsLoaded: false, open: undefined, results: undefined, view: "list", mode: "normal", listSel: undefined, filter: "" },
        [{ type: "loadChats" }],
      ];
    }
    case "toast":
      return [{ ...s, toast: { text: a.text, error: Boolean(a.error) } }, []];
    case "viewerReady":
      // only if the user is still looking at that image
      if (!s.viewer || s.viewer.chatId !== a.chatId || s.viewer.msgId !== a.msgId) return [s, []];
      return [{ ...s, viewer: { ...s.viewer, path: a.path, error: a.error } }, []];
    case "pick": {
      if (s.view === "list") {
        const next = { ...s, listSel: a.id };
        const i = s.chats.findIndex((c) => c.id === a.id);
        const around = uncached(next, [s.chats[i]?.id, s.chats[i + 1]?.id, s.chats[i - 1]?.id]);
        return [next, around.length ? [{ type: "prefetch", chatIds: around }] : []];
      }
      if (s.view === "results" && s.results) return [{ ...s, results: { ...s.results, sel: Number(a.id) } }, []];
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

function applyEvent(s: State, e: SourceEvent): [State, Effect[]] {
  if (e.type === "online") return [{ ...s, online: e.online }, e.online ? [{ type: "loadChats" }] : []];
  if (e.type === "read") return [{ ...s, chats: withChat(s, e.chatId, (c) => ({ ...c, unread: 0, mentions: 0 })) }, []];

  const viewing = s.view === "chat" && s.open?.chatId === e.chatId;
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
  if (open && open.chatId === e.chatId && open.latest && !open.messages.some((m) => m.id === e.msg.id)) {
    const atEnd = open.sel === open.messages[open.messages.length - 1]?.id;
    open = {
      ...open,
      messages: mergeMessages(open.messages, [e.msg]),
      sel: atEnd ? e.msg.id : open.sel,
      newBelow: atEnd ? open.newBelow : open.newBelow + 1,
    };
    if (viewing && !e.msg.out) effects.push({ type: "markRead", chatId: e.chatId });
  }
  const key = draftKey(s, e.chatId);
  const history = s.history[key] ? { ...s.history, [key]: mergeMessages(s.history[key]!, [e.msg]).slice(-200) } : s.history;
  return [{ ...s, chats, open, history }, effects];
}
