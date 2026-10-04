import * as ed from "./editor";
import type { Reaction } from "./types";
import {
  setReactions,
  convId,
  openConv,
  visibleTopics,
  IMAGE_PROTOCOLS,
  hasFile,
  isImage,
  isSpeech,
  isVideo,
  uncached,
  currentFolder,
  chatById,
  currentDraft,
  draftKey,
  emptyDraft,
  hasDraft,
  visibleChats,
  type Draft,
  type Effect,
  type PaletteKind,
  type State,
  type View,
} from "./state";

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
}

type Result = [State, Effect[]];

export interface Command {
  id: string;
  title: string;
  keys: string[]; // first one is shown in the palette and help
  views: View[];
  hidden?: boolean; // navigation: in help, not in the palette
  when?: (s: State) => boolean;
  run: (s: State) => Result;
}

const ALL: View[] = ["list", "topics", "chat", "results"];

// keys that are never text, whatever byte the terminal used (backspace arrives as DEL 0x7f)
const NAMED = new Set(["backspace", "delete", "tab", "escape", "up", "down", "left", "right", "home", "end", "pageup", "pagedown", "insert", "return", "enter", "linefeed"]);

// typed text: no modifiers, not a named key, no control bytes (DEL included)
export function printable(k: Key): boolean {
  return !k.ctrl && !k.meta && !NAMED.has(k.name) && Boolean(k.sequence) && [...k.sequence].every((ch) => ch >= " " && ch !== "\x7f");
}

// key → token: printable chars as themselves, the rest named (ctrl-k, alt-1, enter, escape…)
export function token(k: Key): string {
  if (k.ctrl && k.name.length === 1) return `ctrl-${k.name}`;
  if (k.meta && k.name.length === 1) return `alt-${k.name}`;
  if (k.meta && k.name === "return") return "alt-enter";
  if (k.meta && k.name === "backspace") return "alt-backspace";
  if (k.shift && k.name === "tab") return "shift-tab";
  if (k.name === "return" || k.name === "enter") return "enter";
  if (NAMED.has(k.name)) return k.name;
  if (k.name === "space") return " ";
  if (printable(k) && k.sequence.length === 1) return k.sequence;
  return k.name;
}

function toast(s: State, text: string, error = false): Result {
  return [{ ...s, toast: { text, error } }, []];
}

export function openChat(s: State, chatId: string): Result {
  const chat = chatById(s, chatId);
  // a forum opens on its topics; you read and write inside one topic
  if (chat?.forum) {
    const same = s.topics?.chatId === chatId;
    return [
      { ...s, filter: "", view: "topics", mode: "normal", listSel: chatId, topics: same ? { ...s.topics!, loading: true } : { chatId, items: [], loading: true } },
      [{ type: "loadTopics", chatId }],
    ];
  }
  const markRead = Boolean(chat && chat.unread > 0);
  const chats = markRead ? s.chats.map((c) => (c.id === chatId ? { ...c, unread: 0, mentions: 0 } : c)) : s.chats;
  if (s.open?.chatId === chatId && s.open.topicId === undefined && s.open.messages.length) {
    return [{ ...s, chats, filter: "", view: "chat", mode: "normal", listSel: chatId, open: { ...s.open, newBelow: 0 } }, markRead ? [{ type: "markRead", chatId }] : []];
  }
  return openConversation({ ...s, chats, filter: "" /* a search got you here; going back shows the whole list */, listSel: chatId }, chatId, undefined, undefined, markRead);
}

export function openTopic(s: State, chatId: string, topicId: number): Result {
  const topic = s.topics?.items.find((t) => t.id === topicId);
  if (s.open?.chatId === chatId && s.open.topicId === topicId && s.open.messages.length) {
    return [{ ...s, filter: "", view: "chat", mode: "normal", open: { ...s.open, newBelow: 0 } }, []];
  }
  return openConversation({ ...s, filter: "" }, chatId, topicId, topic?.title, false, Boolean(topic && topic.unread > 0));
}

function openConversation(s: State, chatId: string, topicId: number | undefined, topicTitle: string | undefined, markRead: boolean, markOnLoad = false): Result {
  // preloaded? paint it now; the fetch below only refreshes
  const cached = s.history[draftKey(s, convId(chatId, topicId))] ?? [];
  return [
    {
      ...s,
      view: "chat",
      mode: "normal",
      open: { chatId, topicId, topicTitle, markOnLoad, messages: cached, sel: undefined, loading: cached.length === 0, atStart: false, latest: true, newBelow: 0 },
    },
    [{ type: "openChat", chatId, topicId, markRead }],
  ];
}

// the view scrolls and then picks the row under the cursor (vim ctrl-d / ctrl-u)
function halfPage(s: State, dir: 1 | -1): Result {
  return [{ ...s, scrollReq: { seq: (s.scrollReq?.seq ?? 0) + 1, dir } }, []];
}

export function goFolder(s: State, folderId: number): Result {
  const next = { ...s, view: "list" as const, mode: "normal" as const, filter: "", folderId, palette: undefined };
  const shown = visibleChats(next);
  const listSel = shown.some((c) => c.id === s.listSel) ? s.listSel : shown[0]?.id;
  const warm = uncached(next, shown.slice(0, 6).map((c) => c.id));
  return [{ ...next, listSel }, warm.length ? [{ type: "prefetch", chatIds: warm }] : []];
}

function cycleFolder(s: State, dir: 1 | -1): Result {
  if (s.folders.length < 2) return toast(s, "you have no telegram folders on this account");
  const i = Math.max(0, s.folders.findIndex((f) => f.id === currentFolder(s).id));
  return goFolder(s, s.folders[(i + dir + s.folders.length) % s.folders.length]!.id);
}

function moveList(s: State, delta: number | "top" | "bottom"): Result {
  const chats = visibleChats(s);
  if (!chats.length) return [s, []];
  const i = Math.max(0, chats.findIndex((c) => c.id === s.listSel));
  const j = delta === "top" ? 0 : delta === "bottom" ? chats.length - 1 : Math.min(chats.length - 1, Math.max(0, i + delta));
  const next = { ...s, listSel: chats[j]!.id };
  // warm the chat under the cursor and its neighbours, so enter is instant (never marks read)
  const around = uncached(next, [chats[j]?.id, chats[j + 1]?.id, chats[j - 1]?.id, chats[j + 2]?.id]);
  return [next, around.length ? [{ type: "prefetch", chatIds: around }] : []];
}

function moveChat(s: State, delta: number | "top" | "bottom"): Result {
  const o = s.open;
  if (!o) return [s, []];
  if (delta === "bottom") {
    if (!o.latest) return [{ ...s, open: { ...o, loading: true } }, [{ type: "openChat", chatId: o.chatId, topicId: o.topicId, markRead: false }]];
    return [{ ...s, open: { ...o, sel: undefined, newBelow: 0 } }, []];
  }
  if (!o.messages.length) return [s, []];
  // positions 0..n-1 are messages, n is your input row
  const n = o.messages.length;
  const i = o.sel === undefined ? n : Math.max(0, o.messages.findIndex((m) => m.id === o.sel));
  const j = delta === "top" ? 0 : Math.min(n, Math.max(0, i + delta));
  const effects: Effect[] = [];
  const reachedTop = (delta === "top" || i + (delta as number) < 0 || j === 0) && !o.atStart && !o.loading;
  if (reachedTop) effects.push({ type: "loadOlder", chatId: o.chatId, topicId: o.topicId, before: o.messages[0]!.id });
  const sel = j === n ? undefined : o.messages[j]!.id;
  return [{ ...s, open: { ...o, sel, loading: o.loading || reachedTop, newBelow: j >= n - 1 ? 0 : o.newBelow } }, effects];
}

function moveTopics(s: State, delta: number | "top" | "bottom"): Result {
  const items = visibleTopics(s);
  if (!s.topics || !items.length) return [s, []];
  const i = Math.max(0, items.findIndex((t) => t.id === s.topics!.sel));
  const j = delta === "top" ? 0 : delta === "bottom" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, i + delta));
  return [{ ...s, topics: { ...s.topics, sel: items[j]!.id } }, []];
}

function move(s: State, delta: number | "top" | "bottom"): Result {
  if (s.view === "chat") return moveChat(s, delta);
  if (s.view === "topics") return moveTopics(s, delta);
  if (s.view === "results" && s.results) {
    const n = s.results.hits.length;
    const sel = delta === "top" ? 0 : delta === "bottom" ? n - 1 : Math.min(n - 1, Math.max(0, s.results.sel + delta));
    return [{ ...s, results: { ...s.results, sel: Math.max(0, sel) } }, []];
  }
  return moveList(s, delta);
}

const palette = (kind: PaletteKind) => (s: State): Result => [{ ...s, palette: { kind, query: "", index: 0 } }, []];

function selectedMsg(s: State) {
  return s.open?.messages.find((m) => m.id === s.open?.sel);
}

function withDraft(s: State, f: (d: Draft) => Draft): Result {
  if (!s.open) return [s, []];
  const key = draftKey(s, openConv(s));
  return [{ ...s, drafts: { ...s.drafts, [key]: f(s.drafts[key] ?? emptyDraft()) } }, [{ type: "saveDrafts" }]];
}

function back(s: State): Result {
  if (s.view === "results") return [{ ...s, view: s.open && s.results?.scope ? "chat" : "list", results: undefined }, []];
  if (s.view === "chat" && s.open?.topicId !== undefined && s.topics?.chatId === s.open.chatId) return [{ ...s, view: "topics", mode: "normal" }, []];
  return [{ ...s, view: "list", mode: "normal" }, []];
}

function nextUnread(s: State): Result {
  const next = s.chats.find((c) => c.unread > 0 && !c.muted && c.id !== s.open?.chatId) ?? s.chats.find((c) => c.unread > 0 && c.id !== s.open?.chatId);
  return next ? openChat(s, next.id) : toast(s, "no unread chats");
}

function quit(s: State): Result {
  if (Object.keys(s.outbox).length) {
    return [{ ...s, quitPending: true, toast: { text: "a message is still sending — quitting as soon as it lands", error: false } }, []];
  }
  return [s, [{ type: "saveDrafts" }, { type: "quit" }]];
}

// switching accounts mid-send could split a multi-file send across two accounts
export function switchTo(s: State, name: string): Result {
  if (name === s.account) return [{ ...s, palette: undefined }, []];
  if (Object.keys(s.outbox).length) return [{ ...s, palette: undefined, toast: { text: "wait for the message to finish sending before switching accounts", error: true } }, []];
  // keep this account warm for switching back
  const accountCache = { ...s.accountCache, [s.account]: { label: s.accountLabel, chats: s.chats, folders: s.folders } };
  const warm = s.accountCache[name];
  if (!warm) return [{ ...s, palette: undefined, accountCache }, [{ type: "switchAccount", name }]];
  // warmed: show it now. telegram calls made before the switch lands wait for it, so nothing goes out as the old account
  return [
    {
      ...s,
      palette: undefined,
      accountCache,
      account: name,
      accountLabel: warm.label,
      chats: warm.chats,
      folders: warm.folders,
      folderId: undefined, // that account's default folder
      chatsLoaded: true,
      listSel: visibleChats({ ...s, chats: warm.chats, folders: warm.folders, folderId: undefined, filter: "" })[0]?.id,
      open: undefined,
      results: undefined,
      view: "list",
      mode: "normal",
      filter: "",
    },
    [{ type: "switchAccount", name }],
  ];
}

function viewImage(s: State, chatId: string, msgId: number): Result {
  const video = isVideo(s.open?.messages.find((m) => m.id === msgId));
  return [{ ...s, viewer: { chatId, msgId, video } }, [{ type: "viewImage", chatId, msgId, video }]];
}

// j/k in the viewer step through the chat's media
function stepImage(s: State, dir: 1 | -1): Result {
  const v = s.viewer!;
  const msgs = s.open?.chatId === v.chatId ? s.open.messages : [];
  const i = msgs.findIndex((m) => m.id === v.msgId);
  for (let j = i + dir; j >= 0 && j < msgs.length; j += dir) {
    if (isImage(msgs[j]) || isVideo(msgs[j])) {
      const [s2, fx] = viewImage(s, v.chatId, msgs[j]!.id);
      return [{ ...s2, open: s2.open && { ...s2.open, sel: msgs[j]!.id } }, fx];
    }
  }
  return toast(s, dir > 0 ? "no newer images in this chat" : "no older images loaded");
}

function viewerKey(s: State, t: string): Result {
  const v = s.viewer!;
  if (t === "escape" || t === "q" || t === "v" || t === "V" || t === "h") return [{ ...s, viewer: undefined }, []];
  if (t === "o") return [{ ...s, toast: { text: "opening…", error: false } }, [{ type: "openMedia", chatId: v.chatId, msgId: v.msgId }]];
  if (t === "p") {
    // terminals differ in what they draw: let the user pick, and remember it
    const next = IMAGE_PROTOCOLS[(IMAGE_PROTOCOLS.indexOf(s.imageProtocol) + 1) % IMAGE_PROTOCOLS.length]!;
    return [{ ...s, imageProtocol: next, toast: { text: `images: ${next} (saved — telegram config set images …)`, error: false } }, [{ type: "saveImageProtocol", protocol: next }]];
  }
  if (t === "j" || t === "right" || t === "l") return stepImage(s, 1);
  if (t === "k" || t === "left") return stepImage(s, -1);
  return [s, []];
}

function pasteImage(s: State): Result {
  if (!s.open) return [s, []];
  return [s, [{ type: "pasteImage", key: draftKey(s, openConv(s)), chatId: s.open.chatId }]];
}

export const COMMANDS: Command[] = [
  // navigation (help only)
  { id: "down", title: "down", keys: ["j", "down"], views: ALL, hidden: true, run: (s) => move(s, 1) },
  { id: "up", title: "up", keys: ["k", "up"], views: ALL, hidden: true, run: (s) => move(s, -1) },
  { id: "half-down", title: "scroll half a page down", keys: ["ctrl-d", "pagedown"], views: ALL, hidden: true, run: (s) => halfPage(s, 1) },
  { id: "half-up", title: "scroll half a page up", keys: ["ctrl-u", "pageup"], views: ALL, hidden: true, run: (s) => halfPage(s, -1) },
  { id: "top", title: "top (loads older)", keys: ["gg", "home"], views: ALL, hidden: true, run: (s) => move(s, "top") },
  { id: "bottom", title: "bottom / newest", keys: ["G", "end"], views: ALL, hidden: true, run: (s) => move(s, "bottom") },
  {
    id: "open",
    title: "open chat",
    keys: ["enter", "l", "o"],
    views: ["list"],
    hidden: true,
    run: (s) => (s.listSel ? openChat(s, s.listSel) : [s, []]),
  },
  {
    id: "jump",
    title: "open the hit in its chat",
    keys: ["enter", "l"],
    views: ["results"],
    hidden: true,
    run: (s) => {
      const hit = s.results?.hits[s.results.sel];
      if (!hit) return [s, []];
      const chatId = hit.chat.id;
      const topicId = chatById(s, chatId)?.forum ? (hit.msg.topicId ?? 1) : undefined;
      return [
        { ...s, view: "chat", mode: "normal", listSel: chatId, open: { chatId, topicId, messages: [], loading: true, atStart: false, latest: false, newBelow: 0, sel: hit.msg.id } },
        [{ type: "jumpTo", chatId, topicId, msgId: hit.msg.id }],
      ];
    },
  },
  { id: "filter", title: "filter chats", keys: ["/"], views: ["list", "topics"], hidden: true, run: (s) => [{ ...s, mode: "filter" }, []] },
  { id: "back", title: "back", keys: ["h", "escape", "backspace", "q"], views: ["chat", "results", "topics"], hidden: true, run: back },
  {
    id: "open-topic",
    title: "open topic",
    keys: ["enter", "l", "o"],
    views: ["topics"],
    hidden: true,
    run: (s) => (s.topics?.sel !== undefined ? openTopic(s, s.topics.chatId, s.topics.sel) : [s, []]),
  },
  { id: "clear-filter", title: "clear filter", keys: ["escape"], views: ["list"], hidden: true, run: (s) => [{ ...s, filter: "" }, []] },
  { id: "insert", title: "write a new message", keys: ["i", "a"], views: ["chat"], hidden: true, run: (s) => [{ ...s, mode: "insert" }, []] },

  // palette commands
  { id: "palette", title: "command palette", keys: ["ctrl-k", ":"], views: ALL, run: palette("all") },
  { id: "goto-chat", title: "open chat…", keys: ["gc", "ctrl-p"], views: ALL, run: palette("chats") },
  { id: "search", title: "search messages everywhere…", keys: ["gs"], views: ALL, run: palette("search") },
  { id: "search-chat", title: "search in this chat…", keys: ["/"], views: ["chat"], run: palette("search-chat") },
  { id: "inbox", title: "go to chat list", keys: ["gi"], views: ALL, run: (s) => [{ ...s, view: "list", mode: "normal", filter: "" }, []] },
  { id: "next-unread", title: "next unread chat", keys: ["gu"], views: ALL, run: nextUnread },
  {
    id: "saved",
    title: "saved messages",
    keys: ["gm"],
    views: ALL,
    run: (s) => {
      const me = s.chats.find((c) => c.self);
      return me ? openChat(s, me.id) : toast(s, "saved messages isn't in your recent chats", true);
    },
  },
  {
    id: "reply",
    title: "reply to the selected message (on your input: write)",
    keys: ["enter"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!m) return [{ ...s, mode: "insert" }, []];
      const [s2, fx] = withDraft(s, (d) => ({ ...d, replyTo: m.id }));
      return [{ ...s2, mode: "insert" }, fx];
    },
  },
  {
    id: "react",
    title: "react to the selected message…",
    keys: ["r"],
    views: ["chat"],
    run: (s) => (selectedMsg(s) ? palette("react")(s) : toast(s, "select a message to react to (k)", true)),
  },
  {
    id: "drop-chip",
    title: "drop the reply / last attachment from the prompt",
    keys: ["ctrl-x"],
    views: ["chat"],
    run: (s) => {
      const d = currentDraft(s);
      if (!d || (d.replyTo === undefined && !d.files.length)) return toast(s, "nothing to drop");
      return withDraft(s, (x) => (x.files.length ? { ...x, files: x.files.slice(0, -1) } : { ...x, replyTo: undefined }));
    },
  },
  { id: "paste-image", title: "paste image from clipboard", keys: ["ctrl-v"], views: ["chat"], run: (s) => pasteImage({ ...s, mode: "insert" }) },
  { id: "attach", title: "attach a file…", keys: [], views: ["chat"], run: palette("file") },
  {
    id: "open-media",
    title: "open attachment, link or location",
    keys: ["o"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!s.open || !m) return toast(s, "select a message first (j/k)", true);
      // a file opens in its app; a link preview or a location has no file — open its link (maps for a location)
      if (hasFile(m)) return [{ ...s, toast: { text: `downloading ${m.media}…`, error: false } }, [{ type: "openMedia", chatId: s.open.chatId, msgId: m.id }]];
      const urls = m.urls ?? [];
      if (urls.length === 1) return [{ ...s, toast: { text: `opening ${urls[0]}`, error: false } }, [{ type: "openUrl", url: urls[0]! }]];
      if (urls.length > 1) return palette("links")(s);
      return toast(s, "nothing to open in the selected message", true);
    },
  },
  {
    id: "open-link",
    title: "open link in the selected message",
    keys: ["gx"],
    views: ["chat"],
    run: (s) => {
      const urls = selectedMsg(s)?.urls ?? [];
      if (!urls.length) return toast(s, "no link in the selected message", true);
      if (urls.length === 1) return [{ ...s, toast: { text: `opening ${urls[0]}`, error: false } }, [{ type: "openUrl", url: urls[0]! }]];
      return palette("links")(s);
    },
  },
  {
    id: "show-image",
    title: "show image / video preview inline (again to hide)",
    keys: ["v"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!s.open || !m?.media) return toast(s, "the selected message has no image", true);
      if (!isImage(m) && !isVideo(m)) return toast(s, `that's ${m.media}, not an image — o opens it in another app`, true);
      const key = `${s.account}:${s.open.chatId}:${m.id}`;
      if (s.inline[key]) {
        const inline = { ...s.inline };
        delete inline[key];
        return [{ ...s, inline }, []];
      }
      return [{ ...s, inline: { ...s.inline, [key]: {} } }, [{ type: "loadInline", key, chatId: s.open.chatId, msgId: m.id, video: isVideo(m) }]];
    },
  },
  {
    id: "view-image",
    title: "view image full screen",
    keys: ["V"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!s.open || !m?.media) return toast(s, "the selected message has no image", true);
      if (!isImage(m) && !isVideo(m)) return toast(s, `that's ${m.media}, not an image — o opens it in another app`, true);
      return viewImage(s, s.open.chatId, m.id);
    },
  },
  {
    id: "forward",
    title: "forward the selected message…",
    keys: ["f"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!s.open || !m) return toast(s, "select a message to forward (j/k)", true);
      const next = { ...s, view: "list" as const, mode: "normal" as const, filter: "", forward: { fromChatId: s.open.chatId, msgIds: [m.id] } };
      return [{ ...next, listSel: visibleChats(next)[0]?.id }, []];
    },
  },
  {
    id: "transcribe",
    title: "transcribe voice message / video note",
    keys: ["t"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      if (!s.open || !isSpeech(m)) return toast(s, "select a voice message or video note to transcribe", true);
      const key = `${s.account}:${s.open.chatId}:${m!.id}`;
      if (s.transcripts[key]?.text) return [s, []];
      return [{ ...s, transcripts: { ...s.transcripts, [key]: {} } }, [{ type: "transcribe", key, chatId: s.open.chatId, msgId: m!.id }]];
    },
  },
  {
    id: "yank",
    title: "copy message text",
    keys: ["y"],
    views: ["chat"],
    run: (s) => {
      const m = selectedMsg(s);
      return m ? [s, [{ type: "copy", text: m.text, what: `#${m.id}` }]] : toast(s, "select a message first (j/k)", true);
    },
  },
  {
    id: "mark-read",
    title: "mark read",
    keys: ["x"],
    views: ["list", "chat"],
    run: (s) => {
      const id = s.view === "chat" ? s.open?.chatId : s.listSel;
      if (!id) return [s, []];
      return [{ ...s, chats: s.chats.map((c) => (c.id === id ? { ...c, unread: 0, mentions: 0 } : c)) }, [{ type: "markRead", chatId: id }]];
    },
  },
  {
    id: "mark-unread",
    title: "mark unread",
    keys: ["u"],
    views: ["list"],
    run: (s) => {
      const id = s.listSel;
      if (!id) return [s, []];
      return [{ ...s, chats: s.chats.map((c) => (c.id === id ? { ...c, unread: Math.max(1, c.unread) } : c)) }, [{ type: "markUnread", chatId: id }]];
    },
  },
  { id: "account", title: "switch account…", keys: ["ga"], views: ALL, run: palette("accounts") },
  { id: "folder", title: "go to folder…", keys: ["gf"], views: ALL, run: palette("folders") },
  { id: "next-folder", title: "next folder", keys: ["tab", "gt"], views: ["list"], run: (s) => cycleFolder(s, 1) },
  { id: "prev-folder", title: "previous folder", keys: ["shift-tab", "gT"], views: ["list"], run: (s) => cycleFolder(s, -1) },
  {
    id: "copy-id",
    title: "copy chat id",
    keys: [],
    views: ["list", "chat"],
    run: (s) => {
      const id = s.view === "chat" ? s.open?.chatId : s.listSel;
      return id ? [s, [{ type: "copy", text: id, what: "chat id" }]] : [s, []];
    },
  },
  {
    id: "copy-cli",
    title: "copy `telegram read` command for this chat",
    keys: [],
    views: ["list", "chat"],
    run: (s) => {
      const id = s.view === "chat" ? s.open?.chatId : s.listSel;
      return id ? [s, [{ type: "copy", text: `telegram read -a ${s.account} ${id}`, what: "command" }]] : [s, []];
    },
  },
  {
    id: "refresh",
    title: "refresh",
    keys: ["ctrl-r"],
    views: ALL,
    run: (s) => [
      { ...s, toast: { text: "refreshing…", error: false } },
      [
        { type: "loadChats" },
        ...(s.view === "chat" && s.open ? [{ type: "openChat" as const, chatId: s.open.chatId, topicId: s.open.topicId, markRead: false }] : []),
        ...(s.view === "topics" && s.topics ? [{ type: "loadTopics" as const, chatId: s.topics.chatId }] : []),
      ],
    ],
  },
  { id: "help", title: "keyboard shortcuts", keys: ["?"], views: ALL, run: (s) => [{ ...s, help: !s.help }, []] },
  { id: "quit", title: "quit (drafts are kept)", keys: ["ZZ"], views: ALL, run: quit },
];

function commandFor(s: State, seq: string): Command | undefined {
  return COMMANDS.find((c) => c.views.includes(s.view) && c.keys.includes(seq) && (!c.when || c.when(s)));
}

function isPrefix(s: State, seq: string): boolean {
  return COMMANDS.some((c) => c.views.includes(s.view) && c.keys.some((k) => k.length > seq.length && k.startsWith(seq) && k.length <= 2 && !k.includes("-")));
}

// returns the next state and effects for one key press
export function handleKey(s: State, k: Key): Result {
  const t = token(k);
  const s0 = t === "ctrl-c" ? { ...s } : { ...s, quitArmed: false, toast: t === "escape" ? undefined : s.toast };
  // typing only exists in a chat: whatever got us elsewhere, keys there are commands
  if (s0.mode === "insert" && s0.view !== "chat") s0.mode = "normal";

  // two fast escs arrive as one alt+esc: both count
  if (k.name === "escape" && k.meta) {
    const plain = { ...k, meta: false };
    const [once, fx1] = handleKey(s0, plain);
    const [twice, fx2] = handleKey(once, plain);
    return [twice, [...fx1, ...fx2]];
  }

  // esc followed quickly by a key arrives as alt+key: treat it as esc, then the key (as vim does).
  // alt-1..9 stay pinned chats; alt-enter / alt-backspace are real chords in the prompt
  const escThen = t.match(/^alt-(.)$/);
  if (escThen && !/[1-9]/.test(escThen[1]!)) {
    const [afterEsc, fx1] = handleKey(s0, { name: "escape", ctrl: false, meta: false, shift: false, sequence: "\x1b" });
    const [after, fx2] = handleKey(afterEsc, { name: escThen[1]!, ctrl: false, meta: false, shift: false, sequence: escThen[1]! });
    return [after, [...fx1, ...fx2]];
  }

  if (s0.help) return t === "escape" || t === "?" || t === "q" ? [{ ...s0, help: false }, []] : [s0, []];
  if (s0.viewer) return viewerKey(s0, t);
  if (s0.palette) return paletteKey(s0, k, t);

  if (s0.mode === "insert") return insertKey(s0, k, t);
  if (s0.mode === "filter") return filterKey(s0, k, t);

  if (t === "ctrl-c") {
    if (s.quitArmed) return quit(s);
    return [{ ...s, quitArmed: true, pending: "", toast: { text: "press ctrl-c again to quit (drafts are kept)", error: false } }, []];
  }

  // alt-1..9: pinned chats, arc-style
  const pin = t.match(/^alt-([1-9])$/);
  if (pin) {
    const pinned = s0.chats.filter((c) => c.pinned)[Number(pin[1]) - 1];
    return pinned ? openChat({ ...s0, pending: "" }, pinned.id) : toast({ ...s0, pending: "" }, `no pinned chat #${pin[1]}`);
  }

  if (s0.forward && s0.view === "list" && !s0.pending) {
    if (t === "escape" || t === "q") return [{ ...s0, forward: undefined, filter: "", view: s0.open ? "chat" : "list" }, []];
    if (t === "enter" || t === "l") {
      const to = chatById(s0, s0.listSel);
      if (!to) return [s0, []];
      const f = s0.forward;
      return [
        { ...s0, forward: undefined, filter: "", view: s0.open ? "chat" : "list", toast: { text: `forwarding to ${to.title}…`, error: false } },
        [{ type: "forward", fromChatId: f.fromChatId, msgIds: f.msgIds, toChatId: to.id, toTitle: to.title }],
      ];
    }
  }

  const seq = s0.pending + t;
  const cmd = commandFor(s0, seq);
  if (cmd) return cmd.run({ ...s0, pending: "" });
  if (!s0.pending && isPrefix(s0, seq)) return [{ ...s0, pending: seq }, []];
  return [{ ...s0, pending: "" }, []];
}

function insertKey(s: State, k: Key, t: string): Result {
  if (t === "escape" || t === "ctrl-c") return [{ ...s, mode: "normal" }, [{ type: "saveDrafts" }]];
  if (t === "ctrl-k") return palette("all")(s);
  if (t === "ctrl-v") return pasteImage(s);
  if (t === "enter") return send(s);
  if (t === "alt-enter" || t === "ctrl-j") return withDraft(s, (d) => ed.insert(d, "\n"));
  if (t === "backspace") return withDraft(s, ed.backspace);
  if (t === "ctrl-w" || t === "alt-backspace") return withDraft(s, ed.deleteWord);
  if (t === "ctrl-u") return withDraft(s, ed.deleteToStart);
  if (t === "left" || t === "ctrl-b") return withDraft(s, (d) => ed.move(d, -1));
  if (t === "right" || t === "ctrl-f") return withDraft(s, (d) => ed.move(d, 1));
  if (t === "ctrl-a" || t === "home") return withDraft(s, ed.home);
  if (t === "ctrl-e" || t === "end") return withDraft(s, ed.end);
  if (t === "ctrl-x") {
    return withDraft(s, (d) => (d.files.length ? { ...d, files: d.files.slice(0, -1) } : { ...d, replyTo: undefined }));
  }
  if (printable(k)) return withDraft(s, (d) => ed.insert(d, k.sequence));
  return [s, []];
}

function send(s: State): Result {
  if (!s.open || s.view !== "chat") return [s, []];
  const key = draftKey(s, openConv(s));
  const d = currentDraft(s);
  if (!d || (!d.text.trim() && !d.files.length)) return [s, []];
  if (s.outbox[key]) return toast(s, "still sending the previous message…");
  const drafts = { ...s.drafts };
  delete drafts[key];
  // the draft travels with its chat id: whatever happens to focus, it goes where it was typed
  return [{ ...s, drafts, outbox: { ...s.outbox, [key]: d } }, [{ type: "send", key, chatId: s.open.chatId, topicId: s.open.topicId, draft: d }, { type: "saveDrafts" }]];
}

function filterKey(s: State, k: Key, t: string): Result {
  if (s.view === "topics" && s.topics) {
    if (t === "escape") return [{ ...s, mode: "normal", filter: "" }, []];
    if (t === "enter") return [{ ...s, mode: "normal" }, []];
    if (t === "down" || t === "ctrl-n") return moveTopics(s, 1);
    if (t === "up" || t === "ctrl-p") return moveTopics(s, -1);
    const filter = t === "backspace" ? [...s.filter].slice(0, -1).join("") : printable(k) ? s.filter + k.sequence : s.filter;
    const next = { ...s, filter };
    return [{ ...next, topics: { ...s.topics, sel: visibleTopics(next)[0]?.id ?? s.topics.sel } }, []];
  }
  if (t === "escape") return [{ ...s, mode: "normal", filter: "" }, []];
  // picking a forward target: enter after typing the name forwards straight away
  if (t === "enter") return s.forward ? handleKey({ ...s, mode: "normal" }, k) : [{ ...s, mode: "normal" }, []];
  if (t === "backspace") return [{ ...s, filter: [...s.filter].slice(0, -1).join("") }, []];
  if (t === "down" || t === "ctrl-n") return moveList(s, 1);
  if (t === "up" || t === "ctrl-p") return moveList(s, -1);
  if (printable(k)) {
    const next = { ...s, filter: s.filter + k.sequence };
    const first = visibleChats(next)[0];
    return [{ ...next, listSel: first?.id ?? s.listSel }, []];
  }
  return [s, []];
}

// ---- palette

export interface PaletteEntry {
  label: string;
  hint: string;
  detail?: string;
  run: (s: State) => Result;
}

// telegram's standard free reactions, with names to type in the picker
export const REACTIONS: [string, string][] = [
  ["👍", "thumbs up like"], ["❤️", "heart love"], ["🔥", "fire"], ["😂", "laugh joy"], ["😮", "wow surprised"], ["😢", "sad cry"],
  ["🙏", "thanks pray"], ["👎", "thumbs down dislike"], ["🎉", "party tada"], ["🤔", "thinking"], ["👀", "eyes look"], ["💯", "hundred"],
  ["👏", "clap"], ["🤝", "handshake deal"], ["😁", "grin"], ["🤯", "mind blown"], ["😱", "scream"], ["🤡", "clown"], ["💩", "poo"], ["🐳", "whale"],
];

function addMine(list: Reaction[], emoji: string): Reaction[] {
  const at = list.findIndex((r) => r.emoji === emoji);
  if (at === -1) return [...list, { emoji, count: 1, mine: true }];
  return list.map((r, i) => (i === at ? { ...r, count: r.count + 1, mine: true } : r));
}

export function fuzzy(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 1;
  const at = t.indexOf(q);
  if (at !== -1) return 1000 - at * 2 - (t.length - q.length) * 0.01;
  let i = 0;
  let score = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) {
      score += j > 0 && t[j - 1] === q[i - 1] ? 3 : 1;
      i++;
    }
  }
  return i === q.length ? score : -1;
}

const keyLabel = (c: Command) => (c.keys[0] === " " ? "space" : (c.keys[0] ?? ""));

function chatEntries(s: State, query: string): PaletteEntry[] {
  return s.chats
    .map((c) => ({ c, score: Math.max(fuzzy(query, c.title), c.username ? fuzzy(query, `@${c.username}`) : -1) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map(({ c }) => ({
      label: c.title,
      hint: c.unread ? `${c.unread} unread` : "",
      detail: `${c.kind}${c.username ? ` @${c.username}` : ""} · ${c.id}`,
      run: (s2: State) => openChat({ ...s2, palette: undefined }, c.id),
    }));
}

export function paletteEntries(s: State): PaletteEntry[] {
  const p = s.palette;
  if (!p) return [];
  const q = p.query;
  const view = s.view;

  if (p.kind === "accounts") {
    return s.accounts
      .filter((a) => fuzzy(q, a) > 0)
      .map((a) => ({
        label: a,
        hint: a === s.account ? "current" : "",
        run: (s2: State): Result => switchTo(s2, a),
      }));
  }
  if (p.kind === "chats") return chatEntries(s, q);
  if (p.kind === "react") {
    const m = selectedMsg(s);
    if (!m || !s.open) return [];
    const chatId = s.open.chatId;
    const mine = m.reactions?.find((r) => r.mine)?.emoji;
    return REACTIONS.filter(([, name]) => fuzzy(q, name) > 0).map(([emoji, name]) => ({
      label: `${emoji}  ${name}`,
      hint: emoji === mine ? "yours · enter removes" : "",
      run: (s2: State): Result => {
        const next = emoji === mine ? undefined : emoji;
        // show it right away; telegram's update confirms it
        const others = (m.reactions ?? []).map((r) => (r.mine ? { ...r, count: r.count - 1, mine: false } : r)).filter((r) => r.count > 0);
        const updated = next ? addMine(others, next) : others;
        return [{ ...setReactions(s2, chatId, m.id, updated), palette: undefined }, [{ type: "react", chatId, msgId: m.id, emoji: next }]];
      },
    }));
  }
  if (p.kind === "folders") {
    return s.folders
      .filter((f) => fuzzy(q, f.title) > 0)
      .map((f) => ({ label: f.title, hint: f.id === currentFolder(s).id ? "current" : "", run: (s2: State): Result => goFolder(s2, f.id) }));
  }
  if (p.kind === "links") {
    const urls = s.open?.messages.find((m) => m.id === s.open?.sel)?.urls ?? [];
    return urls
      .filter((u) => fuzzy(q, u) > 0)
      .map((u) => ({ label: u, hint: "enter", run: (s2: State): Result => [{ ...s2, palette: undefined, toast: { text: `opening ${u}`, error: false } }, [{ type: "openUrl", url: u }]] }));
  }
  if (p.kind === "search" || p.kind === "search-chat") {
    if (!q.trim()) return [];
    const scope = p.kind === "search-chat" ? s.open?.chatId : undefined;
    const where = scope ? `in ${chatById(s, scope)?.title ?? "this chat"}` : "in all chats";
    return [
      {
        label: `search "${q}" ${where}`,
        hint: "enter",
        run: (s2: State): Result => [
          { ...s2, palette: undefined, view: "results", results: { query: q, scope, hits: [], sel: 0, loading: true } },
          [{ type: "search", query: q, chatId: scope }],
        ],
      },
    ];
  }
  if (p.kind === "file") {
    if (!q.trim()) return [];
    const chatId = s.open?.chatId;
    if (!chatId) return [];
    return [{ label: `attach ${q}`, hint: "enter", run: (s2: State): Result => [{ ...s2, palette: undefined }, [{ type: "attachPath", path: q, key: draftKey(s2, openConv(s2)), chatId }]] }];
  }

  // vim muscle memory: ":q" / ":wq" quit
  if (["q", "q!", "wq", "x", "qa"].includes(q.trim())) {
    return [{ label: "quit (drafts are kept)", hint: "ZZ", run: (s2: State) => quit({ ...s2, palette: undefined }) }];
  }

  const commands = COMMANDS.filter((c) => !c.hidden && c.views.includes(view) && c.id !== "palette" && (!c.when || c.when(s)))
    .map((c) => ({ c, score: fuzzy(q, c.title) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => (q ? b.score - a.score : 0))
    .map(({ c }) => ({ label: c.title, hint: keyLabel(c), run: (s2: State) => c.run({ ...s2, palette: undefined }) }));
  const accounts = q
    ? s.accounts
        .filter((a) => a !== s.account && fuzzy(q, `account ${a}`) > 0)
        .map((a) => ({ label: `switch to account ${a}`, hint: "ga", run: (s2: State): Result => switchTo(s2, a) }))
    : [];
  const folders = q
    ? s.folders.filter((f) => fuzzy(q, `folder ${f.title}`) > 0).map((f) => ({ label: `folder: ${f.title}`, hint: "gf", run: (s2: State): Result => goFolder(s2, f.id) }))
    : [];
  return [...commands, ...folders, ...accounts, ...(q ? chatEntries(s, q).slice(0, 8) : [])];
}

function paletteKey(s: State, k: Key, t: string): Result {
  const p = s.palette!;
  const entries = paletteEntries(s);
  if (t === "escape" || t === "ctrl-c" || (t === "ctrl-k" && p.kind === "all")) return [{ ...s, palette: undefined }, []];
  if (t === "enter") {
    const e = entries[p.index];
    // commands run from normal mode; the few that write (reply, paste) switch to insert themselves
    return e ? e.run({ ...s, mode: "normal" }) : [s, []];
  }
  if (t === "down" || t === "ctrl-n" || t === "tab") return [{ ...s, palette: { ...p, index: Math.min(entries.length - 1, p.index + 1) } }, []];
  if (t === "up" || t === "ctrl-p") return [{ ...s, palette: { ...p, index: Math.max(0, p.index - 1) } }, []];
  if (t === "backspace") {
    if (!p.query) return [{ ...s, palette: undefined }, []];
    return [{ ...s, palette: { ...p, query: [...p.query].slice(0, -1).join(""), index: 0 } }, []];
  }
  if (t === "ctrl-u") return [{ ...s, palette: { ...p, query: "", index: 0 } }, []];
  if (printable(k)) return [{ ...s, palette: { ...p, query: p.query + k.sequence, index: 0 } }, []];
  return [s, []];
}

export function helpRows(view: View): { keys: string; title: string }[] {
  return COMMANDS.filter((c) => c.views.includes(view) && c.keys.length).map((c) => ({
    keys: c.keys.map((x) => (x === " " ? "space" : x)).join(" "),
    title: c.title,
  }));
}

export { hasDraft };
