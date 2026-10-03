import { RGBA, TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import { basename } from "node:path";
import { C, dayLabel, fit, hhmm, pad, padStart, sameDay, senderColor, shortTime, width } from "./format";
import { helpRows, paletteEntries } from "./keys";
import { chatById, currentDraft, draftKey, hasDraft, visibleChats, type State } from "./state";
import type { ChatSummary, Msg } from "./types";

const RGBADefaultBg = RGBA.defaultBackground();
const DIM = TextAttributes.DIM;
const BOLD = TextAttributes.BOLD;

function useScrollTo(ref: React.RefObject<ScrollBoxRenderable | null>, id: string | undefined, deps: unknown[]) {
  useEffect(() => {
    if (id && ref.current) ref.current.scrollChildIntoView(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function Header({ s, cols }: { s: State; cols: number }) {
  const chat = s.view === "chat" && s.open ? chatById(s, s.open.chatId) : undefined;
  const where =
    s.view === "chat" && chat
      ? `← ${chat.title} · ${chat.kind} · ${chat.id}`
      : s.view === "results" && s.results
        ? `search "${s.results.query}"${s.results.scope ? ` in ${chatById(s, s.results.scope)?.title ?? "chat"}` : ""}`
        : `${s.chats.filter((c) => c.unread > 0).length} unread chats · ${s.chats.length} loaded`;
  const right = `${s.online ? "" : "offline · "}${s.account}   ? help`;
  return (
    <box height={1} flexDirection="row">
      <text attributes={BOLD} fg={C.accent}>
        {" supertelegram "}
      </text>
      <text>{fit(where, Math.max(10, cols - 18 - width(right)))}</text>
      <box flexGrow={1} />
      <text fg={s.online ? C.gray : C.red}>{right + " "}</text>
    </box>
  );
}

function Rule({ cols }: { cols: number }) {
  return (
    <text fg={C.gray} attributes={DIM}>
      {"─".repeat(Math.max(0, cols))}
    </text>
  );
}

function preview(c: ChatSummary): string {
  if (!c.last) return "";
  const body = c.last.text || (c.last.media ? `[${c.last.media}]` : "");
  const who = c.last.out ? "you: " : c.kind === "group" || c.kind === "supergroup" ? (c.last.from ? `${c.last.from.split(" ")[0]}: ` : "") : "";
  return `${who}${body}`;
}

export function ChatList({ s, cols, rows }: { s: State; cols: number; rows: number }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const chats = visibleChats(s);
  useScrollTo(ref, s.listSel ? `c${s.listSel}` : undefined, [s.listSel, chats.length]);
  const titleW = Math.min(30, Math.max(14, Math.floor(cols * 0.28)));
  const timeW = 7;
  const badgeW = 5;
  const previewW = Math.max(0, cols - titleW - timeW - badgeW - 6);

  if (!s.chatsLoaded) return <text fg={C.gray}> loading chats…</text>;
  if (!chats.length) return <text fg={C.gray}>{s.filter ? ` no chats matching "${s.filter}"` : " no chats"}</text>;

  return (
    <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling>
      {chats.map((c) => {
        const sel = c.id === s.listSel;
        const draft = hasDraft(s.drafts[draftKey(s, c.id)]);
        const unread = c.unread > 0;
        const marker = draft ? "✎" : unread ? (c.muted ? "◌" : "●") : c.pinned ? "⌃" : " ";
        const badge = unread ? (c.unread > 99 ? "99+" : String(c.unread)) + (c.mentions ? "@" : "") : "";
        return (
          <box key={c.id} id={`c${c.id}`} height={1} flexDirection="row">
            <text fg={C.accent}>{sel ? "▌" : " "}</text>
            <text fg={draft ? C.yellow : c.muted ? C.gray : C.accent}>{`${marker} `}</text>
            <text attributes={unread ? BOLD : sel ? BOLD : 0}>{pad(fit(c.title, titleW), titleW)}</text>
            <text fg={c.mentions ? C.yellow : c.muted ? C.gray : C.accent} attributes={c.muted ? DIM : BOLD}>
              {padStart(badge, badgeW - 1) + " "}
            </text>
            <text fg={C.gray} attributes={unread ? 0 : DIM}>
              {pad(fit(draft ? `draft: ${s.drafts[draftKey(s, c.id)]!.text}` : preview(c), previewW), previewW)}
            </text>
            <text fg={C.gray} attributes={DIM}>
              {padStart(c.last ? shortTime(c.last.date) : "", timeW)}
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
}

function MessageView({ m, prev, sel, s, replied }: { m: Msg; prev?: Msg; sel: boolean; s: State; replied?: Msg }) {
  const gutter = (
    <text fg={C.accent} width={1}>
      {sel ? "▌" : " "}
    </text>
  );
  const meta = `${hhmm(m.date)} #${m.id}`;
  const body = m.action ? `[${m.action}]` : m.text;
  const media = m.media ? `▣ ${m.media}` : undefined;
  const quote = m.replyTo
    ? replied
      ? `┃ ↳ ${replied.out ? "you" : (replied.sender ?? "?")}: ${replied.text || (replied.media ? `[${replied.media}]` : "")}`
      : `┃ ↳ reply to #${m.replyTo}`
    : undefined;

  if (m.out) {
    return (
      <box id={`m${m.id}`} flexDirection="row" marginTop={prev && !prev.out ? 1 : 0}>
        {gutter}
        <box flexDirection="column" flexGrow={1}>
          {quote && (
            <text fg={C.gray} attributes={DIM} wrapMode="none" truncate>
              {"  " + quote}
            </text>
          )}
          <box flexDirection="row">
            <text fg={C.gray}>{"> "}</text>
            <box flexGrow={1} flexDirection="column">
              {body ? <text wrapMode="word">{body}</text> : null}
              {media && <text fg={C.blue}>{media}</text>}
            </box>
            <text fg={C.gray} attributes={DIM}>{` ${meta}`}</text>
          </box>
        </box>
      </box>
    );
  }

  const grouped = prev && !prev.out && prev.senderId === m.senderId && sameDay(prev.date, m.date) && m.date - prev.date < 300 && !m.action;
  const color = senderColor(m.senderId);
  return (
    <box id={`m${m.id}`} flexDirection="row" marginTop={grouped ? 0 : 1}>
      {gutter}
      <box flexDirection="column" flexGrow={1}>
        {!grouped && (
          <box flexDirection="row">
            <text fg={color} attributes={BOLD}>{`⏺ ${m.sender ?? m.senderId ?? "unknown sender"}`}</text>
            {m.senderUsername ? <text fg={C.gray} attributes={DIM}>{` @${m.senderUsername}`}</text> : null}
            <box flexGrow={1} />
            <text fg={C.gray} attributes={DIM}>
              {meta}
            </text>
          </box>
        )}
        <box flexDirection="row" paddingLeft={2}>
          <box flexDirection="column" flexGrow={1}>
            {quote && (
              <text fg={C.gray} attributes={DIM} wrapMode="none" truncate>
                {quote}
              </text>
            )}
            {body ? (
              <text wrapMode="word" attributes={m.action ? DIM : 0}>
                {body}
              </text>
            ) : null}
            {media && <text fg={C.blue}>{media}</text>}
          </box>
          {grouped && (
            <text fg={C.gray} attributes={DIM}>
              {` ${meta}`}
            </text>
          )}
        </box>
      </box>
    </box>
  );
}

function DaySeparator({ date, cols }: { date: number; cols: number }) {
  const label = ` ${dayLabel(date)} `;
  const side = Math.max(2, Math.floor((cols - width(label)) / 2) - 1);
  return (
    <box marginTop={1} height={1}>
      <text fg={C.gray} attributes={DIM}>
        {"─".repeat(side) + label + "─".repeat(side)}
      </text>
    </box>
  );
}

export function ChatView({ s, cols, rows }: { s: State; cols: number; rows: number }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const o = s.open!;
  useScrollTo(ref, o.sel !== undefined ? `m${o.sel}` : undefined, [o.sel, o.messages.length]);
  const byId = new Map(o.messages.map((m) => [m.id, m]));

  const items: React.ReactNode[] = [];
  if (o.loading && !o.messages.length) items.push(<text key="loading" fg={C.gray}>{" loading messages…"}</text>);
  else if (o.atStart) items.push(<text key="start" fg={C.gray} attributes={DIM}>{" beginning of chat"}</text>);
  else if (o.loading) items.push(<text key="older" fg={C.gray} attributes={DIM}>{" loading older messages…"}</text>);
  o.messages.forEach((m, i) => {
    const prev = o.messages[i - 1];
    if (!prev || !sameDay(prev.date, m.date)) items.push(<DaySeparator key={`d${m.id}`} date={m.date} cols={cols} />);
    items.push(<MessageView key={m.id} m={m} prev={prev && sameDay(prev.date, m.date) ? prev : undefined} sel={m.id === o.sel} s={s} replied={m.replyTo ? byId.get(m.replyTo) : undefined} />);
  });
  if (!o.latest) items.push(<text key="detached" fg={C.yellow}>{" … newer messages not loaded — G to jump to the newest"}</text>);

  return (
    <box flexDirection="column" flexGrow={1}>
      <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling stickyScroll stickyStart="bottom">
        {items}
      </scrollbox>
      {o.newBelow > 0 && (
        <text fg={C.accent} attributes={BOLD}>
          {`${"─".repeat(Math.max(2, Math.floor(cols / 2) - 6))} ${o.newBelow} new ↓ (G)`}
        </text>
      )}
    </box>
  );
}

export function Prompt({ s, cols }: { s: State; cols: number }) {
  const d = currentDraft(s);
  const key = s.open ? draftKey(s, s.open.chatId) : "";
  const sending = Boolean(s.outbox[key]);
  const insert = s.mode === "insert";
  const replied = d?.replyTo ? s.open?.messages.find((m) => m.id === d.replyTo) : undefined;
  const lines = (d?.text ?? "").split("\n");

  // the cursor is drawn as an inverse cell inside the line that holds it
  let offset = 0;
  const rendered = lines.map((line, i) => {
    const start = offset;
    offset += line.length + 1;
    const prefix = i === 0 ? "> " : "  ";
    if (!insert || !d || d.cursor < start || d.cursor > start + line.length) {
      return (
        <text key={i}>
          <span fg={C.gray}>{prefix}</span>
          {line}
        </text>
      );
    }
    const at = d.cursor - start;
    const ch = [...line.slice(at)][0] ?? " ";
    return (
      <text key={i}>
        <span fg={C.gray}>{prefix}</span>
        {line.slice(0, at)}
        <span attributes={TextAttributes.INVERSE}>{ch}</span>
        {line.slice(at + ch.length)}
      </text>
    );
  });

  const height = 1 + (d?.replyTo !== undefined ? 1 : 0) + (d?.files.length ?? 0) + (sending ? 1 : 0) + (insert || hasDraft(d) ? lines.length : 1);
  return (
    <box flexDirection="column" height={height} flexShrink={0}>
      <Rule cols={cols} />
      {d?.replyTo !== undefined && (
        <text fg={C.gray}>{fit(`↳ replying to ${replied ? (replied.out ? "yourself" : (replied.sender ?? replied.senderId ?? "unknown sender")) : "message"} #${d.replyTo}${replied ? ` "${replied.text}"` : ""}`, cols - 14) + "   ctrl-x drop"}</text>
      )}
      {d?.files.map((f) => (
        <text key={f} fg={C.blue}>{fit(`⧉ ${basename(f)}`, cols - 14) + "   ctrl-x drop"}</text>
      ))}
      {sending && <text fg={C.yellow}>{" sending…"}</text>}
      {insert || hasDraft(d) ? (
        rendered
      ) : (
        <text fg={C.gray} attributes={DIM}>
          {"> press i to write · r to reply to the selected message · ctrl-k commands"}
        </text>
      )}
    </box>
  );
}

export function Results({ s, cols, rows }: { s: State; cols: number; rows: number }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const r = s.results!;
  useScrollTo(ref, `r${r.sel}`, [r.sel, r.hits.length]);
  if (r.loading) return <text fg={C.gray}>{` searching for "${r.query}"…`}</text>;
  if (!r.hits.length) return <text fg={C.gray}>{` no messages matching "${r.query}". esc to go back`}</text>;
  return (
    <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling>
      {r.hits.map((h, i) => {
        const who = h.msg.out ? "you" : (h.msg.sender ?? h.msg.senderId ?? h.chat.title);
        const head = `${shortTime(h.msg.date)} ${h.chat.title} · ${who}: `;
        return (
          <box key={`${h.chat.id}:${h.msg.id}`} id={`r${i}`} height={1} flexDirection="row">
            <text fg={C.accent}>{i === r.sel ? "▌" : " "}</text>
            <text fg={C.gray}>{fit(head, Math.floor(cols * 0.45))}</text>
            <text attributes={i === r.sel ? BOLD : 0}>{fit(h.msg.text || (h.msg.media ? `[${h.msg.media}]` : ""), cols - Math.min(width(head), Math.floor(cols * 0.45)) - 2)}</text>
          </box>
        );
      })}
    </scrollbox>
  );
}

const PALETTE_TITLES: Record<string, string> = {
  all: "commands",
  chats: "open chat",
  accounts: "switch account",
  search: "search messages everywhere",
  "search-chat": "search in this chat",
  file: "attach a file — type a path",
};

export function Palette({ s, cols }: { s: State; cols: number }) {
  const p = s.palette!;
  const entries = paletteEntries(s);
  const w = Math.min(84, cols - 4);
  const visible = 14;
  const start = Math.max(0, Math.min(p.index - Math.floor(visible / 2), entries.length - visible));
  return (
    <box position="absolute" top={2} left={Math.max(0, Math.floor((cols - w) / 2))} width={w} zIndex={10} border borderStyle="rounded" borderColor={C.accent} title={` ${PALETTE_TITLES[p.kind]} `} flexDirection="column" backgroundColor={RGBADefaultBg}>
      <text>
        <span fg={C.accent}>{"> "}</span>
        {p.query}
        <span attributes={TextAttributes.INVERSE}>{" "}</span>
      </text>
      <Rule cols={w - 2} />
      {entries.length === 0 && <text fg={C.gray}>{p.kind.startsWith("search") || p.kind === "file" ? " type, then enter" : " no matches"}</text>}
      {entries.slice(start, start + visible).map((e, i) => {
        const idx = start + i;
        const sel = idx === p.index;
        const hint = e.hint ? ` ${e.hint}` : "";
        const labelW = w - 4 - width(hint);
        return (
          <box key={`${idx}:${e.label}`} height={1} flexDirection="row">
            <text fg={C.accent}>{sel ? "▌" : " "}</text>
            <text attributes={sel ? BOLD : 0}>{pad(fit(e.label + (e.detail ? `  ${e.detail}` : ""), labelW), labelW)}</text>
            <text fg={C.gray}>{hint}</text>
          </box>
        );
      })}
    </box>
  );
}


export function Help({ s, cols }: { s: State; cols: number }) {
  const rowsList = helpRows(s.view);
  const w = Math.min(96, cols - 4);
  const keyW = 22;
  return (
    <box position="absolute" top={1} left={Math.max(0, Math.floor((cols - w) / 2))} width={w} zIndex={20} border borderStyle="rounded" borderColor={C.accent} title={` keys · ${s.view} view · esc to close `} flexDirection="column" backgroundColor={RGBADefaultBg}>
      {rowsList.map((r) => (
        <box key={r.title} height={1} flexDirection="row">
          <text fg={C.accent}>{pad(fit(r.keys, keyW - 1), keyW)}</text>
          <text>{fit(r.title, w - keyW - 3)}</text>
        </box>
      ))}
      <box height={1} flexDirection="row">
        <text fg={C.accent}>{pad("alt-1..9", keyW)}</text>
        <text>pinned chats 1–9</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={C.accent}>{pad("ctrl-c ctrl-c", keyW)}</text>
        <text>quit (drafts are kept)</text>
      </box>
      <text fg={C.gray} attributes={DIM}>
        {" in the prompt: enter send · alt-enter newline · ctrl-v paste image · ctrl-x drop chip · esc keeps the draft"}
      </text>
    </box>
  );
}

const HINTS: Record<string, string> = {
  list: "j/k move · enter open · / filter · gu next unread · gs search · ctrl-k commands",
  chat: "j/k select · i write · r reply · o open media · / search · h back · ctrl-k commands",
  results: "j/k move · enter open in chat · esc back",
  insert: "enter send · alt-enter newline · ctrl-v paste image · esc normal (draft kept)",
  filter: "type to filter · enter keep · esc clear",
};

export function StatusBar({ s, cols }: { s: State; cols: number }) {
  const mode = s.palette ? "PALETTE" : s.mode.toUpperCase();
  const hint = s.toast ? s.toast.text : s.mode === "filter" ? `/${s.filter}  ·  ${HINTS.filter}` : s.mode === "insert" ? HINTS.insert : HINTS[s.view];
  return (
    <box height={1} flexDirection="row">
      <text attributes={BOLD | TextAttributes.INVERSE} fg={s.mode === "insert" ? C.green : C.accent}>{` ${mode} `}</text>
      <text fg={s.toast?.error ? C.red : C.gray}>{" " + fit(`${s.pending ? `${s.pending}… ` : ""}${hint ?? ""}`, cols - mode.length - 4)}</text>
    </box>
  );
}
