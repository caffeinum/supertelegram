import { RGBA, TextAttributes, type ImageRenderable, type ScrollBoxRenderable } from "@opentui/core";
import { useRenderer } from "@opentui/react";
import { useEffect, useRef } from "react";
import { basename } from "node:path";
import { C, dayLabel, fit, hhmm, pad, padStart, sameDay, senderColor, shortTime, width } from "./format";
import { helpRows, paletteEntries } from "./keys";
import { chatById, currentDraft, currentFolder, draftKey, hasDraft, openConv, visibleChats, visibleTopics, type State } from "./state";
import { unreadChats } from "./folders";
import type { ChatSummary, Msg } from "./types";

const RGBADefaultBg = RGBA.defaultBackground();
const SCROLLBAR = { trackOptions: { foregroundColor: C.gray, backgroundColor: C.bg } };
const DIM = TextAttributes.DIM;
const BOLD = TextAttributes.BOLD;

const SCROLLOFF = 3;

// vim-like scrolling, done after layout (post-render) so positions are fresh:
// - scrolloff: the view scrolls only when the cursor comes within SCROLLOFF rows of an edge
// - content inserted above an unmoved cursor (older history) keeps the cursor on its screen row
// - ctrl-d / ctrl-u scroll half a page, then pick the row now under the cursor
// mouse scrolling is left alone: nothing here runs unless the cursor, the content or a request changed
function useCursorScroll(
  ref: React.RefObject<ScrollBoxRenderable | null>,
  selId: string | undefined,
  rowIds: string[],
  request: State["scrollReq"],
  onPick: ((id: string) => void) | undefined
) {
  const renderer = useRenderer();
  const st = useRef({ selId, rowIds, request, onPick, lastSel: undefined as string | undefined, handled: request?.seq ?? 0, anchor: undefined as { id: string; offset: number; top: number } | undefined });
  Object.assign(st.current, { selId, rowIds, request, onPick });

  useEffect(() => {
    const fn = () => {
      const box = ref.current;
      const s = st.current;
      // on the input row: half-page scrolls measure from the newest message
      if (box && !s.selId && s.request && s.request.seq !== s.handled && s.rowIds.length) s.selId = s.rowIds[s.rowIds.length - 1];
      if (!box || !s.selId) return;
      const vpTop = box.viewport.y;
      const vpH = box.viewport.height;
      const child = box.content.findDescendantById(s.selId);
      if (!child || vpH <= 0) return;
      let offset = child.y - vpTop;
      let moved = false;

      if (s.request && s.request.seq !== s.handled) {
        s.handled = s.request.seq;
        const delta = s.request.dir * Math.max(1, Math.floor(vpH / 2));
        const before = box.scrollTop;
        box.scrollBy(delta);
        const actual = box.scrollTop - before;
        // the row that will sit where the cursor is now
        const want = child.y + (actual !== 0 ? actual : delta);
        let best: string | undefined;
        let bestDist = Infinity;
        for (const id of s.rowIds) {
          const r = box.content.findDescendantById(id);
          if (!r) continue;
          const dist = want < r.y ? r.y - want : want >= r.y + r.height ? want - (r.y + r.height - 1) : 0;
          if (dist < bestDist) {
            bestDist = dist;
            best = id;
          }
        }
        s.anchor = undefined;
        if (best && best !== s.selId) {
          s.lastSel = best; // already in view: no scrolloff jump after the pick
          s.onPick?.(best);
        }
        renderer.requestRender();
        return;
      }

      const log = (why: string, by: number) =>
        console.log(`scroll ${why} sel=${s.selId} vp=${vpTop}+${vpH} child=${child.y}+${child.height} offset=${offset} top=${box.scrollTop} by=${by}`);
      if (s.anchor && s.anchor.id === s.selId && s.anchor.top === box.scrollTop && s.anchor.offset !== offset) {
        log("anchor", offset - s.anchor.offset);
        box.scrollBy(offset - s.anchor.offset);
        moved = true;
      } else if (s.selId !== s.lastSel) {
        if (offset < SCROLLOFF) {
          log("scrolloff-top", offset - SCROLLOFF);
          box.scrollBy(offset - SCROLLOFF);
          moved = true;
        } else if (offset + child.height > vpH - SCROLLOFF) {
          const by = Math.min(offset + child.height - (vpH - SCROLLOFF), offset);
          log("scrolloff-bottom", by);
          box.scrollBy(by);
          moved = true;
        }
      }
      s.lastSel = s.selId;
      if (moved) {
        s.anchor = undefined; // measure again after the next layout
        renderer.requestRender();
      } else {
        s.anchor = { id: s.selId, offset, top: box.scrollTop };
      }
    };
    renderer.addPostProcessFn(fn);
    return () => renderer.removePostProcessFn(fn);
  }, [renderer, ref]);
}

export function Header({ s, cols }: { s: State; cols: number }) {
  const chat = s.view === "chat" && s.open ? chatById(s, s.open.chatId) : undefined;
  const where = s.forward
    ? `forward #${s.forward.msgIds.join(", #")} to… (enter picks · / filters · esc cancels)`
    : s.view === "chat" && chat && s.open?.topicId !== undefined
      ? `← ${chat.title} › ${s.open.topicTitle ?? `topic ${s.open.topicId}`}`
      : s.view === "topics" && s.topics
        ? `← ${chatById(s, s.topics.chatId)?.title ?? "forum"} · ${s.topics.items.length} topics`
        : s.view === "chat" && chat
      ? `← ${chat.title} · ${chat.kind} · ${chat.id}`
      : s.view === "results" && s.results
        ? `search "${s.results.query}"${s.results.scope ? ` in ${chatById(s, s.results.scope)?.title ?? "chat"}` : ""}`
        : `${s.chats.filter((c) => c.unread > 0).length} unread chats · ${s.chats.length} loaded`;
  // narrow screens shed the hints, then the brand, so the parts never draw over each other
  const offline = s.online ? "" : "offline · ";
  const room = (brand: string, right: string) => cols - width(brand) - width(right) - 2;
  const layouts = [
    [" supertelegram ", `${offline}${s.account} ${s.accountLabel} · ga switch   ? help`],
    [" supertelegram ", `${offline}${s.account} ${s.accountLabel}`],
    [" ", `${offline}${s.account}`],
  ] as const;
  const [brand, right] = layouts.find(([b, r]) => room(b, r) >= 24) ?? layouts[2];
  return (
    <box height={1} flexDirection="row">
      <text attributes={BOLD} fg={C.accent}>
        {brand}
      </text>
      <text fg={C.fg}>{fit(where, Math.max(0, room(brand, right)))}</text>
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

// telegram folders as tabs; the badge counts unread (unmuted) chats like telegram does
export function FolderTabs({ s, cols }: { s: State; cols: number }) {
  if (s.folders.length < 2 || s.forward) return null;
  const current = currentFolder(s).id;
  let used = 1;
  return (
    <box height={1} flexDirection="row">
      <text fg={C.fg}>{" "}</text>
      {s.folders.map((f) => {
        const n = unreadChats(s.chats, f);
        const label = ` ${f.title}${n ? ` ${n}` : ""} `;
        used += width(label) + 1;
        if (used > cols - 12) return null;
        const on = f.id === current && !s.filter;
        return (
          <text key={f.id} fg={on ? C.bg : C.fg} bg={on ? C.accent : C.bg} attributes={on ? BOLD : 0}>
            {label}
          </text>
        );
      })}
      <box flexGrow={1} />
      <text fg={C.gray} attributes={DIM}>
        {"tab ⇥ folders "}
      </text>
    </box>
  );
}

export function ChatList({ s, cols, onPick }: { s: State; cols: number; rows: number; onPick?: (id: string) => void }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const chats = visibleChats(s);
  useCursorScroll(ref, s.listSel ? `c${s.listSel}` : undefined, chats.map((c) => `c${c.id}`), s.view === "list" ? s.scrollReq : undefined, onPick && ((id) => onPick(id.slice(1))));
  const titleW = Math.min(30, Math.max(14, Math.floor(cols * 0.28)));
  const timeW = 7;
  const badgeW = 5;
  const previewW = Math.max(0, cols - titleW - timeW - badgeW - 6);

  if (!s.chatsLoaded) return <text fg={C.gray}> loading chats…</text>;
  if (!chats.length) return <text fg={C.gray}>{s.filter ? ` no chats matching "${s.filter}"` : " no chats"}</text>;

  return (
    <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling scrollbarOptions={SCROLLBAR}>
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
            <text fg={C.fg} attributes={unread ? BOLD : sel ? BOLD : 0}>{pad(fit(c.title, titleW), titleW)}</text>
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

const INLINE_ROWS = 14;

// an image shown inside the transcript, under its message (v toggles it)
function InlineImage({ s, m }: { s: State; m: Msg }) {
  const it = s.open ? s.inline[`${s.account}:${s.open.chatId}:${m.id}`] : undefined;
  if (!it) return null;
  if (it.error) return <text fg={C.red}>{`  ${it.error}`}</text>;
  if (!it.path) return <text fg={C.gray} attributes={DIM}>{"  loading image…"}</text>;
  return (
    <box height={INLINE_ROWS} flexDirection="row" paddingLeft={2}>
      {/* always blocks inside the scrolling chat: kitty/sixel images don't survive scrolling (and drew blank in cmux) */}
      <image key={it.path} source={it.path} fit="fit" protocol="blocks" height={INLINE_ROWS} width={INLINE_ROWS * 4} />
    </box>
  );
}

function Reactions({ m }: { m: Msg }) {
  if (!m.reactions?.length) return null;
  return (
    <text fg={C.fg}>
      {"  "}
      {m.reactions.map((r, i) => (
        <span key={r.emoji} fg={r.mine ? C.accent : C.gray} attributes={r.mine ? BOLD : 0}>
          {`${i ? "  " : ""}${r.emoji} ${r.count}`}
        </span>
      ))}
    </text>
  );
}

function Transcript({ s, m }: { s: State; m: Msg }) {
  const t = s.open ? s.transcripts[`${s.account}:${s.open.chatId}:${m.id}`] : undefined;
  if (!t) return null;
  if (t.error) return <text fg={C.red}>{`  ✎ ${t.error}`}</text>;
  if (t.text === undefined) return <text fg={C.gray} attributes={DIM}>{"  ✎ transcribing…"}</text>;
  return (
    <text fg={C.fg} attributes={TextAttributes.ITALIC} wrapMode="word">
      {`  ✎ ${t.text || "(no speech)"}`}
    </text>
  );
}

// the cursor: a bar down the whole selected message (text, photo, transcript…), not just its first line
const BAR = { topLeft: "▌", topRight: " ", bottomLeft: "▌", bottomRight: " ", horizontal: " ", vertical: "▌", topT: "▌", bottomT: "▌", leftT: "▌", rightT: " ", cross: "▌" };
function selBar(sel: boolean) {
  return sel ? { border: ["left"] as ("left")[], borderColor: C.accent, customBorderChars: BAR } : { paddingLeft: 1 };
}

// "album 1/3": photos sent together arrive as separate messages sharing a grouped id
function albumPart(m: Msg, all: Msg[]): string {
  if (!m.album) return "";
  const parts = all.filter((x) => x.album === m.album);
  return parts.length > 1 ? ` · album ${parts.findIndex((x) => x.id === m.id) + 1}/${parts.length}` : "";
}

function MessageView({ m, prev, sel, s, replied }: { m: Msg; prev?: Msg; sel: boolean; s: State; replied?: Msg }) {

  const meta = `${hhmm(m.date)} #${m.id}`;
  const body = m.action ? `[${m.action}]` : m.text;
  const media = m.media ? `▣ ${m.media}${albumPart(m, s.open?.messages ?? [])}` : undefined;
  const quote = m.replyTo
    ? replied
      ? `┃ ↳ ${replied.out ? "you" : (replied.sender ?? "?")}: ${replied.text || (replied.media ? `[${replied.media}]` : "")}`
      : `┃ ↳ reply to #${m.replyTo}`
    : undefined;

  if (m.out) {
    return (
      <box id={`m${m.id}`} flexDirection="row" marginTop={prev && !prev.out ? 1 : 0} {...selBar(sel)}>
        <box flexDirection="column" flexGrow={1}>
          {quote && (
            <text fg={C.gray} attributes={DIM} wrapMode="none" truncate>
              {"  " + quote}
            </text>
          )}
          <box flexDirection="row">
            <text fg={C.gray}>{"> "}</text>
            <box flexGrow={1} flexDirection="column">
              {body ? <text fg={C.fg} wrapMode="word">{body}</text> : null}
              {media && <text fg={C.blue}>{media}</text>}
              <InlineImage s={s} m={m} />
              <Transcript s={s} m={m} />
              <Reactions m={m} />
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
    <box id={`m${m.id}`} flexDirection="row" marginTop={grouped ? 0 : 1} {...selBar(sel)}>
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
              <text fg={C.fg} wrapMode="word" attributes={m.action ? DIM : 0}>
                {body}
              </text>
            ) : null}
            {media && <text fg={C.blue}>{media}</text>}
            <InlineImage s={s} m={m} />
            <Transcript s={s} m={m} />
            <Reactions m={m} />
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

export function ChatView({ s, cols, onPick }: { s: State; cols: number; rows: number; onPick?: (id: string) => void }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const o = s.open!;
  useCursorScroll(ref, o.sel !== undefined ? `m${o.sel}` : undefined, o.messages.map((m) => `m${m.id}`), s.view === "chat" ? s.scrollReq : undefined, onPick && ((id) => onPick(id.slice(1))));
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
      <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling stickyScroll stickyStart="bottom" scrollbarOptions={SCROLLBAR}>
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
  const key = s.open ? draftKey(s, openConv(s)) : "";
  const sending = Boolean(s.outbox[key]);
  const insert = s.mode === "insert";
  const replied = d?.replyTo ? s.open?.messages.find((m) => m.id === d.replyTo) : undefined;
  const lines = (d?.text ?? "").split("\n");
  const onInputRow = s.view === "chat" && s.open?.sel === undefined;

  // the cursor is drawn as an inverse cell inside the line that holds it
  let offset = 0;
  const rendered = lines.map((line, i) => {
    const start = offset;
    offset += line.length + 1;
    const prefix = i === 0 ? (onInputRow ? "▌> " : "> ") : onInputRow ? "▌  " : "  ";
    if (!insert || !d || d.cursor < start || d.cursor > start + line.length) {
      return (
        <text fg={C.fg} key={i} wrapMode="char">
          <span fg={C.gray}>{prefix}</span>
          {line}
        </text>
      );
    }
    const at = d.cursor - start;
    const ch = [...line.slice(at)][0] ?? " ";
    return (
      <text fg={C.fg} key={i} wrapMode="char">
        <span fg={C.gray}>{prefix}</span>
        {line.slice(0, at)}
        <span fg={C.bg} bg={C.fg}>
          {ch}
        </span>
        {line.slice(at + ch.length)}
      </text>
    );
  });

  // a long line wraps; the box must be as tall as the wrapped rows or they draw over the rule above
  const rows = (line: string) => Math.max(1, Math.ceil((3 + width(line) + 1) / Math.max(1, cols)));
  const textRows = insert || hasDraft(d) ? lines.reduce((n, l) => n + rows(l), 0) : 1;
  const height = 1 + (d?.replyTo !== undefined ? 1 : 0) + (d?.files.length ?? 0) + (sending ? 1 : 0) + textRows;
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
        <text fg={C.gray} attributes={onInputRow ? 0 : DIM}>
          {fit(onInputRow ? "▌> enter to write · k to pick a message (enter replies, r reacts) · ctrl-k commands" : "> enter replies to the selected message · r reacts · j to your input", cols)}
        </text>
      )}
    </box>
  );
}

export function Topics({ s, cols, onPick }: { s: State; cols: number; rows: number; onPick?: (id: string) => void }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const t = s.topics!;
  const items = visibleTopics(s);
  useCursorScroll(ref, t.sel !== undefined ? `t${t.sel}` : undefined, items.map((x) => `t${x.id}`), s.view === "topics" ? s.scrollReq : undefined, onPick && ((id) => onPick(id.slice(1))));
  if (t.loading && !t.items.length) return <text fg={C.gray}>{" loading topics…"}</text>;
  if (!items.length) return <text fg={C.gray}>{s.filter ? ` no topics matching "${s.filter}"` : " no topics"}</text>;
  const titleW = Math.min(30, Math.max(14, Math.floor(cols * 0.28)));
  const previewW = Math.max(0, cols - titleW - 18);
  return (
    <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling scrollbarOptions={SCROLLBAR}>
      {items.map((x) => {
        const sel = x.id === t.sel;
        const unread = x.unread > 0;
        const preview = x.last ? `${x.last.out ? "you: " : x.last.from ? `${x.last.from.split(" ")[0]}: ` : ""}${x.last.text}` : "";
        return (
          <box key={x.id} id={`t${x.id}`} height={1} flexDirection="row">
            <text fg={C.accent}>{sel ? "▌" : " "}</text>
            <text fg={C.accent}>{unread ? "● " : x.pinned ? "⌃ " : x.closed ? "✕ " : "# "}</text>
            <text fg={C.fg} attributes={unread || sel ? BOLD : 0}>{pad(fit(x.title, titleW), titleW)}</text>
            <text fg={C.accent} attributes={BOLD}>{padStart(unread ? (x.unread > 99 ? "99+" : String(x.unread)) : "", 4) + " "}</text>
            <text fg={C.gray} attributes={unread ? 0 : DIM}>{pad(fit(preview, previewW), previewW)}</text>
            <text fg={C.gray} attributes={DIM}>{padStart(x.last ? shortTime(x.last.date) : "", 7)}</text>
          </box>
        );
      })}
    </scrollbox>
  );
}

export function Results({ s, cols, onPick }: { s: State; cols: number; rows: number; onPick?: (id: string) => void }) {
  const ref = useRef<ScrollBoxRenderable>(null);
  const r = s.results!;
  useCursorScroll(ref, `r${r.sel}`, r.hits.map((_, i) => `r${i}`), s.view === "results" ? s.scrollReq : undefined, onPick && ((id) => onPick(id.slice(1))));
  if (r.loading) return <text fg={C.gray}>{` searching for "${r.query}"…`}</text>;
  if (!r.hits.length) return <text fg={C.gray}>{` no messages matching "${r.query}". esc to go back`}</text>;
  return (
    <scrollbox ref={ref} flexGrow={1} scrollY viewportCulling scrollbarOptions={SCROLLBAR}>
      {r.hits.map((h, i) => {
        const who = h.msg.out ? "you" : (h.msg.sender ?? h.msg.senderId ?? h.chat.title);
        const head = `${shortTime(h.msg.date)} ${h.chat.title} · ${who}: `;
        return (
          <box key={`${h.chat.id}:${h.msg.id}`} id={`r${i}`} height={1} flexDirection="row">
            <text fg={C.accent}>{i === r.sel ? "▌" : " "}</text>
            <text fg={C.gray}>{fit(head, Math.floor(cols * 0.45))}</text>
            <text fg={C.fg} attributes={i === r.sel ? BOLD : 0}>{fit(h.msg.text || (h.msg.media ? `[${h.msg.media}]` : ""), cols - Math.min(width(head), Math.floor(cols * 0.45)) - 2)}</text>
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
  links: "open which link?",
  folders: "go to folder",
  react: "react with…",
};

export function Palette({ s, cols }: { s: State; cols: number }) {
  const p = s.palette!;
  const entries = paletteEntries(s);
  const w = Math.min(84, cols - 4);
  const visible = 14;
  const start = Math.max(0, Math.min(p.index - Math.floor(visible / 2), entries.length - visible));
  return (
    <box position="absolute" top={2} left={Math.max(0, Math.floor((cols - w) / 2))} width={w} zIndex={10} border borderStyle="rounded" borderColor={C.accent} title={` ${PALETTE_TITLES[p.kind]} `} flexDirection="column" backgroundColor={RGBADefaultBg}>
      <text fg={C.fg}>
        <span fg={C.accent}>{"> "}</span>
        {p.query}
        <span fg={C.bg} bg={C.fg}>
          {" "}
        </span>
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
            <text fg={C.fg} attributes={sel ? BOLD : 0}>{pad(fit(e.label + (e.detail ? `  ${e.detail}` : ""), labelW), labelW)}</text>
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
          <text fg={C.fg}>{fit(r.title, w - keyW - 3)}</text>
        </box>
      ))}
      <box height={1} flexDirection="row">
        <text fg={C.accent}>{pad("alt-1..9", keyW)}</text>
        <text fg={C.fg}>pinned chats 1–9</text>
      </box>
      <box height={1} flexDirection="row">
        <text fg={C.accent}>{pad("ctrl-c ctrl-c", keyW)}</text>
        <text fg={C.fg}>quit (drafts are kept)</text>
      </box>
      <text fg={C.gray} attributes={DIM}>
        {" in the prompt: enter send · alt-enter newline · ctrl-v paste image · ctrl-x drop chip · esc keeps the draft"}
      </text>
    </box>
  );
}

const HINTS: Record<string, string> = {
  topics: "j/k move · enter open topic · / filter topics · h back to chats · ctrl-k commands",
  forward: "pick a chat to forward to · j/k move · / filter · enter forward · esc cancel",
  list: "j/k move · enter open · / filter · gu next unread · gs search · ctrl-k commands",
  chat: "j/k select · enter reply (or write) · r react · f forward · v image · o open · / search · h back · ctrl-k",
  results: "j/k move · enter open in chat · esc back",
  insert: "enter send · alt-enter newline · ctrl-v paste image · esc normal (draft kept)",
  filter: "type to filter · enter keep · esc clear",
};

export function StatusBar({ s, cols }: { s: State; cols: number }) {
  const mode = s.palette ? "PALETTE" : s.mode.toUpperCase();
  // while typing, always say who you're sending as
  const hint = s.toast
    ? s.toast.text
    : s.mode === "filter" && s.view === "topics"
      ? `/${s.filter}  ·  filter topics · enter keep · esc clear`
      : s.mode === "filter"
      ? `/${s.filter}  ·  ${HINTS.filter}`
      : s.mode === "insert"
        ? `sending as ${s.accountLabel || s.account} · ${HINTS.insert}`
        : s.forward && s.view === "list"
          ? HINTS.forward
          : HINTS[s.view];
  return (
    <box height={1} flexDirection="row">
      <text attributes={BOLD} fg={C.bg} bg={s.mode === "insert" ? C.green : C.accent}>{` ${mode} `}</text>
      <text fg={s.toast?.error ? C.red : C.gray}>{" " + fit(`${s.pending ? `${s.pending}… ` : ""}${hint ?? ""}`, cols - mode.length - 4)}</text>
    </box>
  );
}

// full-screen inline image: kitty graphics where the terminal supports it (ghostty, cmux, kitty, wezterm),
// sixel or unicode blocks elsewhere — opentui picks with protocol="auto"
export function Viewer({ s, cols, rows }: { s: State; cols: number; rows: number }) {
  const v = s.viewer!;
  const imageRef = useRef<ImageRenderable>(null);
  const m = s.open?.chatId === v.chatId ? s.open.messages.find((x) => x.id === v.msgId) : undefined;
  const who = m ? (m.out ? "you" : (m.sender ?? m.senderId ?? "unknown sender")) : "";
  const title = ` ${who}${m ? ` · ${hhmm(m.date)} #${m.id}` : ""}${m?.text ? ` · ${m.text}` : ""} `;
  return (
    <box position="absolute" top={0} left={0} width={cols} height={rows} zIndex={30} flexDirection="column" backgroundColor={RGBADefaultBg}>
      <text fg={C.accent} attributes={BOLD}>
        {fit(title, cols)}
      </text>
      <box flexGrow={1} alignItems="center" justifyContent="center">
        {v.error ? (
          <text fg={C.red}>{` couldn't load this image: ${v.error}. press o to open it in another app.`}</text>
        ) : v.path ? (
          <image
            key={`${v.path}:${s.imageProtocol}`}
            source={v.path}
            fit="fit"
            protocol={s.imageProtocol}
            width={cols}
            height={rows - 2}
            ref={imageRef}
            onLoad={() => console.log(`image ${v.path} requested=${s.imageProtocol} drawn-with=${imageRef.current?.effectiveProtocol ?? "unknown"}`)}
            onError={(err: unknown) => console.log(`image ${v.path} failed: ${err instanceof Error ? err.message : String(err)}`)}
          />
        ) : (
          <text fg={C.gray}>{" loading image…"}</text>
        )}
      </box>
      <text fg={C.gray}>{fit(` ${v.video ? "▶ video preview — o to play · " : ""}esc close · j/k next/prev · o open in another app · p drawing: ${s.imageProtocol} (blank? press p)`, cols)}</text>
    </box>
  );
}
