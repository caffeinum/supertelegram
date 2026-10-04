import { decodePasteBytes } from "@opentui/core";
import { useFocus, useKeyboard, usePaste, useTerminalDimensions } from "@opentui/react";
import { existsSync, statSync } from "node:fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { copyText, pastedPath, readClipboardImage } from "./clipboard";
import { saveDrafts } from "./drafts";
import { setConfig } from "../config/manager";
import { handleKey, type Key } from "./keys";
import { apply, type Action, type Effect, type State } from "./state";
import type { ChatPool, DataSource } from "./types";
import { ChatList, ChatView, FolderTabs, Header, Help, Palette, Prompt, Results, StatusBar, Topics, Viewer } from "./views";

const HISTORY_PAGE = 60;
const PREFETCH_CONCURRENCY = 2;
const CHATS = 200;

type Step = (s: State) => [State, Effect[]];

export interface AppProps {
  resyncMs?: number;
  saveSetting?: (key: string, value: string) => void;
  source: DataSource;
  initial: State;
  onQuit: () => void;
  persistPool?: (account: string, pool: ChatPool) => void;
  persistDrafts?: (drafts: State["drafts"]) => void;
  openFile?: (path: string) => Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// live updates can be missed (gramjs's catchUp is a no-op; ~3 of 8 live probes on startup were lost),
// so the list and the open chat are also refreshed on a slow timer and whenever the terminal regains focus
const RESYNC_MS = 30_000;

export function App({ source, initial, onQuit, persistDrafts = saveDrafts, persistPool = () => {}, openFile, resyncMs = RESYNC_MS, saveSetting = setConfig }: AppProps) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const { width: cols, height: rows } = useTerminalDimensions();
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cacheTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // prefetch queue: newest request first (the chat under the cursor), a couple at a time, never twice
  const prefetch = useRef({ queue: [] as { account: string; chatId: string }[], busy: 0, seen: new Set<string>() });

  const runRef = useRef<(f: Step) => void>(() => {});
  const act = useCallback((a: Action) => runRef.current((s) => apply(s, a)), []);
  const fail0 = useCallback((what: string) => (err: unknown) => act({ type: "toast", text: `${what}: ${message(err)}`, error: true }), [act]);

  // telegram calls issued while an account switch is in flight wait for it: never act as the old account
  const switching = useRef<Promise<unknown>>(Promise.resolve());

  const exec = useCallback(
    async (e: Effect) => {
      if (e.type === "switchAccount") {
        const p = source.switchAccount(e.name);
        switching.current = p.catch(() => undefined);
        return p.then(() => {
          act({ type: "accountSwitched", account: e.name, label: source.accountLabel() });
          saveSetting("tuiAccount", e.name); // open here next time
        }, fail0(`couldn't switch to ${e.name}`));
      }
      if (e.type !== "saveDrafts" && e.type !== "quit" && e.type !== "copy" && e.type !== "warmAccounts") await switching.current;
      const fail = (what: string) => (err: unknown) => act({ type: "toast", text: `${what}: ${message(err)}`, error: true });
      switch (e.type) {
        case "prefetch": {
          const q = prefetch.current;
          const account = ref.current.account;
          for (const chatId of [...e.chatIds].reverse()) {
            const key = `${account}:${chatId}`;
            if (q.seen.has(key)) continue;
            q.seen.add(key);
            q.queue.unshift({ account, chatId });
          }
          q.queue.length = Math.min(q.queue.length, 12);
          const pump = () => {
            while (q.busy < PREFETCH_CONCURRENCY && q.queue.length) {
              const job = q.queue.shift()!;
              if (job.account !== ref.current.account) continue;
              q.busy++;
              source
                .history(job.chatId, { limit: HISTORY_PAGE })
                .then((msgs) => act({ type: "prefetched", key: `${job.account}:${job.chatId}`, msgs }))
                .catch(() => q.seen.delete(`${job.account}:${job.chatId}`)) // a miss just means a normal open later
                .finally(() => {
                  q.busy--;
                  pump();
                });
            }
          };
          return pump();
        }
        case "loadChats":
          return source.listChats(CHATS).then((pool) => act({ type: "chatsLoaded", chats: pool.chats, folders: pool.folders }), fail("couldn't load chats"));
        case "loadTopics":
          return source.topics(e.chatId).then((items) => act({ type: "topicsLoaded", chatId: e.chatId, items }), fail("couldn't load topics"));
        case "openChat":
          if (e.markRead) source.markRead(e.chatId).catch(fail("couldn't mark read"));
          return source
            .history(e.chatId, { limit: HISTORY_PAGE, topicId: e.topicId })
            .then((msgs) => act({ type: "historyLoaded", chatId: e.chatId, topicId: e.topicId, msgs, mode: "replace", latest: true, limit: HISTORY_PAGE }))
            .catch((err) => act({ type: "historyFailed", chatId: e.chatId, error: message(err) }));
        case "loadOlder":
          return source
            .history(e.chatId, { limit: HISTORY_PAGE, before: e.before, topicId: e.topicId })
            .then((msgs) => act({ type: "historyLoaded", chatId: e.chatId, topicId: e.topicId, msgs, mode: "prepend", latest: true, limit: HISTORY_PAGE }))
            .catch((err) => act({ type: "historyFailed", chatId: e.chatId, error: message(err) }));
        case "jumpTo":
          return source
            .history(e.chatId, { limit: HISTORY_PAGE, before: e.msgId + 1, topicId: e.topicId })
            .then((msgs) => act({ type: "historyLoaded", chatId: e.chatId, topicId: e.topicId, msgs, mode: "replace", select: e.msgId, latest: false, limit: HISTORY_PAGE }))
            .catch((err) => act({ type: "historyFailed", chatId: e.chatId, error: message(err) }));
        case "send": {
          const { draft, chatId, key } = e;
          // track what actually went out, so a failure only puts back the rest (never a duplicate)
          let sentFiles = 0;
          try {
            let last;
            if (draft.files.length) {
              for (const [i, file] of draft.files.entries()) {
                last = await source.send(chatId, i === 0 ? draft.text : "", { file, replyTo: i === 0 ? draft.replyTo : undefined, topicId: e.topicId });
                sentFiles = i + 1;
              }
            } else {
              last = await source.send(chatId, draft.text, { replyTo: draft.replyTo, topicId: e.topicId });
            }
            act({ type: "sent", key, chatId, msg: last! });
          } catch (err) {
            const unsent =
              sentFiles === 0
                ? draft
                : { text: "", cursor: 0, files: draft.files.slice(sentFiles), replyTo: undefined };
            act({ type: "sendFailed", key, error: message(err), unsent });
          }
          return;
        }
        case "markRead":
          return source.markRead(e.chatId, e.topic).catch(fail("couldn't mark read"));
        case "react":
          return source.react(e.chatId, e.msgId, e.emoji).catch(fail("couldn't react"));
        case "forward":
          return source
            .forward(e.fromChatId, e.msgIds, e.toChatId)
            .then(() => act({ type: "toast", text: `forwarded to ${e.toTitle} · gc to open it` }), fail(`couldn't forward to ${e.toTitle}`));
        case "markUnread":
          return source.markUnread(e.chatId).catch(fail("couldn't mark unread"));
        case "loadExtras": {
          const account = ref.current.account;
          return source
            .folderExtras(ref.current.folders, ref.current.chats.map((c) => c.id))
            .then((chats) => act({ type: "chatsExtended", account, chats }))
            .catch(fail("couldn't load folder chats"));
        }
        case "warmAccounts":
          for (const account of e.accounts) {
            source
              .peek(account, 5)
              .then((w) => act({ type: "accountWarmed", account, label: w.label, chats: w.pool.chats, folders: w.pool.folders, history: w.history }))
              .catch(() => undefined); // an account that can't be warmed just switches the slow way
          }
          return;
        case "search":
          return source.search(e.query, e.chatId).then((hits) => act({ type: "searchResults", hits }), fail("search failed"));
        case "openMedia":
          return source
            .download(e.chatId, e.msgId)
            .then(async (path) => {
              await (openFile ?? defaultOpen)(path);
              act({ type: "toast", text: `opened ${path}` });
            })
            .catch(fail("couldn't open the attachment"));
        case "openUrl":
          return (openFile ?? defaultOpen)(e.url).catch(fail("couldn't open the link"));
        case "loadInline":
          return (e.video ? source.thumbnail(e.chatId, e.msgId) : source.download(e.chatId, e.msgId))
            .then((path) => act({ type: "inlineReady", key: e.key, path }))
            .catch((err) => act({ type: "inlineReady", key: e.key, error: message(err) }));
        case "transcribe":
          return source
            .transcribe(e.chatId, e.msgId)
            .then((text) => act({ type: "transcribed", key: e.key, text }))
            .catch((err) => act({ type: "transcribed", key: e.key, error: message(err) }));
        case "viewImage":
          return (e.video ? source.thumbnail(e.chatId, e.msgId) : source.download(e.chatId, e.msgId))
            .then((path) => act({ type: "viewerReady", chatId: e.chatId, msgId: e.msgId, path }))
            .catch((err) => act({ type: "viewerReady", chatId: e.chatId, msgId: e.msgId, error: message(err) }));
        case "copy":
          return copyText(e.text).then(() => act({ type: "toast", text: `copied ${e.what}` }), fail("copy failed"));
        case "pasteImage": {
          const got = await readClipboardImage();
          if (got.kind === "none") return act({ type: "toast", text: `nothing pasted: ${got.reason}`, error: true });
          return act({ type: "attach", path: got.path, key: e.key, chatId: e.chatId });
        }
        case "attachPath": {
          const path = pastedPath(e.path) ?? e.path;
          if (!existsSync(path) || !statSync(path).isFile()) return act({ type: "toast", text: `no file at ${path}`, error: true });
          return act({ type: "attach", path, key: e.key, chatId: e.chatId });
        }
        case "saveImageProtocol":
          return saveSetting("images", e.protocol);
        case "saveCache":
          clearTimeout(cacheTimer.current);
          cacheTimer.current = setTimeout(() => {
            const st = ref.current;
            try {
              persistPool(st.account, { chats: st.chats, folders: st.folders });
            } catch (err) {
              act({ type: "toast", text: `couldn't save the chat cache: ${message(err)}`, error: true });
            }
          }, 1500);
          return;
        case "saveDrafts":
          clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => persistDrafts(ref.current.drafts), 300);
          return;
        case "quit":
          clearTimeout(saveTimer.current);
          try {
            persistDrafts(ref.current.drafts);
          } catch (err) {
            // never quit on top of unsaved drafts
            return act({ type: "toast", text: `couldn't save drafts (${message(err)}) — not quitting`, error: true });
          }
          return onQuit();
      }
    },
    [source, act, onQuit, persistDrafts, openFile]
  );

  runRef.current = (f: Step) => {
    const [next, effects] = f(ref.current);
    ref.current = next;
    setState(next);
    for (const e of effects) void exec(e);
  };

  useEffect(() => {
    const off = source.subscribe((event) => act({ type: "event", event }));
    source.ready?.catch((err) => {
      act({ type: "event", event: { type: "online", online: false } });
      act({ type: "toast", text: `can't connect: ${message(err)}`, error: true });
    });
    void exec({ type: "loadChats" });
    return off;
  }, [source, act, exec]);

  useEffect(() => {
    const t = setInterval(() => act({ type: "resync" }), resyncMs);
    return () => clearInterval(t);
  }, [act, resyncMs]);
  useFocus(() => act({ type: "resync" }));

  useKeyboard((k) => runRef.current((s) => handleKey(s, k as Key)));

  usePaste((event) => {
    const text = decodePasteBytes(event.bytes);
    const s = ref.current;
    if (s.palette) return runRef.current((st) => [{ ...st, palette: { ...st.palette!, query: st.palette!.query + text.replace(/\n/g, " "), index: 0 } }, []]);
    if (s.mode === "filter") return runRef.current((st) => [{ ...st, filter: st.filter + text.replace(/\n/g, " ") }, []]);
    if (s.view !== "chat") return;
    const path = pastedPath(text);
    const chatId = s.open?.chatId;
    if (path && chatId && existsSync(path) && statSync(path).isFile()) return act({ type: "attach", path, key: `${s.account}:${chatId}`, chatId });
    runRef.current((st) => [{ ...st, mode: "insert" }, []]);
    act({ type: "insertText", text });
  });

  const pick = useCallback((id: string) => act({ type: "pick", id }), [act]);

  const main =
    state.view === "chat" && state.open ? (
      <>
        <ChatView s={state} cols={cols} rows={rows} onPick={pick} />
        <Prompt s={state} cols={cols} />
      </>
    ) : state.view === "topics" && state.topics ? (
      <Topics s={state} cols={cols} rows={rows} onPick={pick} />
    ) : state.view === "results" && state.results ? (
      <Results s={state} cols={cols} rows={rows} onPick={pick} />
    ) : (
      <>
        <FolderTabs s={state} cols={cols} />
        <ChatList s={state} cols={cols} rows={rows} onPick={pick} />
      </>
    );

  return (
    <box flexDirection="column" width={cols} height={rows}>
      <Header s={state} cols={cols} />
      <box flexDirection="column" flexGrow={1}>
        {main}
      </box>
      <StatusBar s={state} cols={cols} />
      {state.palette && <Palette s={state} cols={cols} />}
      {state.viewer && <Viewer s={state} cols={cols} rows={rows} />}
      {state.help && <Help s={state} cols={cols} />}
    </box>
  );
}

async function defaultOpen(path: string) {
  const proc = Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", path], { stdout: "ignore", stderr: "pipe" });
  if ((await proc.exited) !== 0) throw new Error((await new Response(proc.stderr).text()).trim() || `couldn't open ${path}`);
}
