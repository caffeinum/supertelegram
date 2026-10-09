// production loads gramjs's platform check before any renderer sets global.window; tests must too
import "telegram/platform";
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(20_000);
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/tui/app";
import { FakeSource } from "../src/tui/fake-source";
import { COMMANDS, handleKey, type Key } from "../src/tui/keys";
import { initialState, type Draft, type State } from "../src/tui/state";
import type { ChatSummary, Msg } from "../src/tui/types";

const now = Math.floor(Date.now() / 1000);

function chats(): ChatSummary[] {
  return [
    { id: "-100", title: "Covers!", kind: "group", unread: 3, mentions: 0, muted: false, pinned: false, last: { text: "8qcK address", from: "mnk", out: false, date: now - 60 } },
    { id: "42", title: "Kate", kind: "user", username: "kate", unread: 1, mentions: 0, muted: false, pinned: false, last: { text: "look at this", out: false, date: now - 120 } },
    { id: "7", title: "Saved Messages", kind: "user", unread: 0, mentions: 0, muted: false, pinned: true, self: true, last: { text: "note to self", out: true, date: now - 600 } },
    { id: "-200", title: "Noisy Group", kind: "supergroup", unread: 148, mentions: 0, muted: true, pinned: false, last: { text: "ci green", from: "bot", out: false, date: now - 900 } },
  ];
}

function msgs(): Record<string, Msg[]> {
  return {
    "-100": [
      { id: 1, date: now - 3600, out: false, senderId: "11", sender: "mnk", senderUsername: "im_moonko", text: "скинешь адрес?" },
      { id: 2, date: now - 3500, out: true, text: "sure, one sec" },
      { id: 3, date: now - 60, out: false, senderId: "11", sender: "mnk", senderUsername: "im_moonko", text: "8qcK address", replyTo: 2 },
    ],
    "42": [{ id: 9, date: now - 120, out: false, senderId: "42", sender: "Kate", text: "look at this", media: "photo" }],
    "7": [{ id: 5, date: now - 600, out: true, text: "note to self" }],
  };
}

let teardown: (() => void) | undefined;
type Setup = { t: Awaited<ReturnType<typeof testRender>> };

// a real 64×32 image: hand-made 1×1 pngs decoded to nothing, so image tests passed without drawing
const FIXTURE_PNG = new URL("./fixtures/gradient.png", import.meta.url).pathname;
const drawsPixels = (t: Awaited<ReturnType<typeof testRender>>) =>
  t.captureSpans().lines.some((l) => l.spans.some((sp) => sp.bg.intent === "rgb" && sp.bg.a > 0 && sp.text.includes("▀")));

// react's act() warnings are noise here: the renderer flushes on its own
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

async function setup(opts: { width?: number; height?: number; drafts?: Record<string, Draft>; messages?: Record<string, Msg[]>; resyncMs?: number } = {}) {
  const src = new FakeSource(chats(), opts.messages ?? msgs());
  const saved: Record<string, Draft>[] = [];
  const opened: string[] = [];
  const settings: [string, string][] = [];
  let quit = false;
  const t = await testRender(
    <App
      source={src}
      initial={initialState("default", ["default", "work"], opts.drafts ?? {}, "@default_user")}
      onQuit={() => (quit = true)}
      persistDrafts={(d) => saved.push(structuredClone(d))}
      resyncMs={opts.resyncMs ?? 60_000}
      saveSetting={(k: string, v: string) => settings.push([k, v])}
      openFile={async (p: string) => {
        opened.push(p);
      }}
    />,
    { width: opts.width ?? 100, height: opts.height ?? 30, exitOnCtrlC: false }
  );
  const keys = async (...ks: string[]) => {
    for (const k of ks) {
      if (k.startsWith("ctrl-")) await t.mockInput.pressKey(k.slice(5), { ctrl: true });
      else if (k.startsWith("alt-")) await t.mockInput.pressKey(k.slice(4), { meta: true });
      else if (k === "enter") await t.mockInput.pressKey("RETURN");
      else if (k === "esc") {
        // a person's esc stands alone; esc glued to the next key (alt+key) has its own test
        t.mockInput.pressEscape();
        await Bun.sleep(50);
      }
      else if (k === "backspace") await t.mockInput.pressKey("BACKSPACE");
      else for (const ch of k) await t.mockInput.pressKey(ch);
      await t.flush();
    }
    // react commits on its own scheduler outside act(): give it a tick before reading the frame
    await Bun.sleep(20);
    await t.renderOnce();
  };
  const frame = () => t.captureCharFrame();
  // effects resolve on real promises, so poll in real time rather than a fixed number of passes
  const until = async (pred: (f: string) => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      await t.renderOnce();
      const f = frame();
      if (pred(f)) return f;
      if (Date.now() > deadline) throw new Error(`frame never matched; last frame:\n${f}`);
      await Bun.sleep(10);
    }
  };
  await until((f) => f.includes("Covers!"));
  teardown = () => t.renderer.destroy();
  return { t, src, saved, opened, settings, keys, frame, until, quit: () => quit };
}

afterEach(() => {
  teardown?.();
  teardown = undefined;
});

describe("chat list", () => {
  test("shows chats with unread counts and moving never marks anything read", async () => {
    const { frame, keys, src } = await setup();
    const f = frame();
    expect(f).toContain("Covers!");
    expect(f).toContain("Kate");
    expect(f).toContain("99+"); // 148 unread caps at 99+
    expect(f).toContain("NORMAL");
    await keys("j", "j", "j", "k", "G", "gg");
    expect(src.calls.filter((c: { method: string }) => c.method === "markRead")).toHaveLength(0);
  });

  test("/ filters the list", async () => {
    const { frame, keys, until } = await setup();
    await keys("/", "kat");
    expect(frame()).toContain("Kate");
    expect(frame()).not.toContain("Covers!");
    await keys("esc");
    await until((x) => x.includes("Covers!"));
  });

  test("pressing / shows a search field right away, before anything is typed", async () => {
    const { keys, until } = await setup();
    await keys("/");
    const f = await until((x) => x.includes("4 matches · enter keep · esc clear"));
    expect(f.split("\n")[1]).toMatch(/^ \/ /);
    await keys("kat");
    await until((x) => x.includes(" / kat") && x.includes("1 match "));
    await keys("enter");
    await until((x) => x.includes("1 match · / edit · esc clear"));
    await keys("esc");
    await until((x) => !x.includes("match") && x.includes("Covers!"));
  });
});

describe("chat view", () => {
  test("enter opens a chat like a transcript and marks it read once", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    const f = await until((x) => x.includes("8qcK address") && x.includes("sure, one sec"));
    expect(f).toContain("⏺ mnk");
    expect(f).toMatch(/> sure, one sec/);
    expect(f).toContain("↳ you: sure, one sec"); // reply quote
    expect(src.calls.filter((c) => c.method === "markRead").map((c) => c.args[0])).toEqual(["-100"]);
  });

  test("i, type, enter sends to the open chat and clears the prompt", async () => {
    const { keys, until, src, frame } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i", "hello world", "enter");
    await until((x) => x.includes("> hello world"));
    expect(src.sent()).toEqual([["-100", "hello world", { replyTo: undefined }]]);
    expect(frame()).toContain("INSERT");
  });

  test("normal-mode letters never land in the draft", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("jkjk", "enter"); // enter in normal = focus the prompt, not send
    await keys("enter");
    expect(src.sent()).toHaveLength(0);
  });

  test("r replies to the selected message", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("k", "k", "enter", "got it", "enter"); // from your input: k → #3, k → #2; enter replies
    await until((x) => x.includes("> got it"));
    expect(src.sent()[0]).toEqual(["-100", "got it", { replyTo: 2 }]);
  });

  test("k past the top loads older messages", async () => {
    const long = Array.from({ length: 70 }, (_, i): Msg => ({ id: i + 1, date: now - 7000 + i * 60, out: false, senderId: "11", sender: "mnk", text: `msg ${i + 1}` }));
    const { keys, until, src } = await setup({ messages: { ...msgs(), "-100": long } });
    await keys("enter");
    await until((x) => x.includes("msg 70"));
    await keys("gg"); // first loaded page starts at msg 11
    await until((x) => x.includes("msg 1") && !x.includes("loading older"));
    expect(src.calls.some((c) => c.method === "history" && (c.args[1] as { before?: number }).before === 11)).toBe(true);
  });

  test("a live message in the open chat appears", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    src.push({ type: "message", chatId: "-100", msg: { id: 50, date: now, out: false, senderId: "12", sender: "Kate D", text: "live one" } });
    await until((x) => x.includes("live one"));
  });
});

describe("drafts never go astray", () => {
  test("a draft survives esc, switching chats, and is persisted", async () => {
    const { keys, until, saved, frame } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i", "half typed", "esc", "h");
    await until((x) => x.includes("draft: half typed"));
    await keys("j", "enter");
    await until((x) => x.includes("look at this"));
    await keys("h", "k", "enter");
    await until((x) => x.includes("> half typed"));
    await Bun.sleep(400);
    expect(JSON.stringify(saved.at(-1))).toContain("half typed");
    expect(frame()).toContain("half typed");
  });

  test("an incoming message reordering the list doesn't change where enter sends", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i", "for covers");
    src.push({ type: "message", chatId: "42", msg: { id: 77, date: now, out: false, senderId: "42", sender: "Kate", text: "ping" } });
    await keys("enter");
    await until((x) => x.includes("> for covers"));
    expect(src.sent().map((a) => a[0])).toEqual(["-100"]);
  });

  test("a failed send puts the text back and is not retried", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    src.failNextSend = "FLOOD_WAIT_30";
    await keys("i", "keep me", "enter");
    const f = await until((x) => x.includes("not sent"));
    expect(f).toContain("> keep me");
    expect(src.sent()).toHaveLength(1);
  });

  test("ctrl-c with a draft leaves insert mode instead of quitting; twice in normal quits", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("i", "draft", "ctrl-c");
    expect(s.quit()).toBe(false);
    expect(s.frame()).toContain("NORMAL");
    await s.keys("ctrl-c");
    expect(s.quit()).toBe(false);
    expect(s.frame()).toContain("press ctrl-c again");
    await s.keys("ctrl-c");
    expect(s.quit()).toBe(true);
  });
});

test("esc then a key typed fast (arrives as alt+key) still leaves insert mode first", async () => {
  const { keys, until, t } = await setup();
  await keys("enter");
  await until((x) => x.includes("8qcK address"));
  await keys("i", "fast");
  t.mockInput.pressEscape();
  await t.mockInput.pressKey("h"); // lands as alt-h
  await until((x) => x.includes("draft: fast") && x.includes("NORMAL"));
});

describe("palette, go-to keys, search", () => {
  test("ctrl-k lists features with their shortcuts", async () => {
    const { keys, frame } = await setup();
    await keys("ctrl-k");
    const f = frame();
    expect(f).toContain("commands");
    expect(f).toMatch(/open chat….*gc/);
    expect(f).toMatch(/search messages everywhere….*gs/);
    expect(f).toMatch(/switch account….*ga/);
  });

  test("gc fuzzy-opens a chat", async () => {
    const { keys, until } = await setup();
    await keys("gc", "kat", "enter");
    await until((x) => x.includes("look at this") && x.includes("▣ photo"));
  });

  test(":q quits", async () => {
    const s = await setup();
    await s.keys(":", "q", "enter");
    expect(s.quit()).toBe(true);
  });

  test("gs searches everywhere and enter jumps to the hit", async () => {
    const { keys, until, src } = await setup();
    await keys("gs", "address", "enter");
    await until((x) => x.includes('search "address"') && x.includes("Covers!"));
    await keys("enter");
    await until((x) => x.includes("8qcK address") && x.includes("newer messages not loaded"));
    expect(src.calls.some((c) => c.method === "search" && c.args[0] === "address")).toBe(true);
  });

  test("ga switches account and reloads chats", async () => {
    const { keys, until, src } = await setup();
    await keys("ga", "work", "enter");
    await until((x) => x.includes("work"));
    expect(src.calls.some((c) => c.method === "switchAccount" && c.args[0] === "work")).toBe(true);
  });

  test("gu opens the next unread chat (skipping muted)", async () => {
    const { keys, until } = await setup();
    await keys("gu");
    await until((x) => x.includes("8qcK address"));
  });

  test("gm opens saved messages", async () => {
    const { keys, until } = await setup();
    await keys("gm");
    await until((x) => x.includes("> note to self"));
  });
});

// real terminals send DEL (0x7f) for backspace; the mock's BACKSPACE sends \b, which hid this
describe("backspace as a real terminal sends it", () => {
  const DEL = "\x7f";
  test("deletes in search", async () => {
    const { keys, until, t } = await setup();
    await keys("gs", "adress");
    await t.mockInput.pressKey(DEL);
    await t.mockInput.pressKey(DEL);
    await keys("ss");
    // "adress" − 2 chars + "ss" = "adress" only if backspace really deleted
    await until((x) => x.includes('search "adress" in all chats'));
  });
  test("deletes in the prompt", async () => {
    const { keys, until, t } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i", "helo");
    await t.mockInput.pressKey(DEL);
    await keys("lo");
    await until((x) => x.includes("> hello") && !x.includes("hel\x7f"));
  });
  test("deletes in the list filter", async () => {
    const { keys, until, t } = await setup();
    await keys("/", "katx");
    await t.mockInput.pressKey(DEL);
    await until((x) => x.includes("/kat ") && x.includes("Kate"));
  });
});

describe("preload", () => {
  test("the top of the list is prefetched at start, and nothing gets marked read", async () => {
    const { src, until } = await setup();
    await until(() => new Set(src.calls.filter((c) => c.method === "history").map((c) => c.args[0])).size === 4);
    expect(src.calls.filter((c) => c.method === "markRead")).toHaveLength(0);
  });

  test("a preloaded chat opens instantly even when telegram is slow, then refreshes in place", async () => {
    const { src, until, keys, frame } = await setup();
    await until(() => src.calls.filter((c) => c.method === "history").length >= 4);
    await Bun.sleep(50);
    src.historyDelayMs = 1500;
    src.messages["42"]!.push({ id: 10, date: now, out: false, senderId: "42", sender: "Kate", text: "arrived while closed" });
    await keys("j", "enter");
    const t0 = Date.now();
    await until((x) => x.includes("look at this"), 500); // from cache, not after the 1.5s fetch
    expect(Date.now() - t0).toBeLessThan(500);
    expect(frame()).not.toContain("loading messages");
    await until((x) => x.includes("arrived while closed"), 4000); // the background refresh merges in
  });

  test("resting the cursor on a chat prefetches it and its neighbours", async () => {
    const s = await setup();
    const extra = Array.from({ length: 12 }, (_, i) => ({ id: `${900 + i}`, title: `Chat ${i}`, kind: "user" as const, unread: 0, mentions: 0, muted: false, pinned: false }));
    s.src.chats.push(...extra);
    await s.keys("ctrl-r");
    await s.until((x) => x.includes("Chat 0"));
    await s.keys("G");
    await s.until(() => s.src.calls.some((c) => c.method === "history" && c.args[0] === "911"));
  });
});

describe("scrolling like vim", () => {
  const long = () => Array.from({ length: 70 }, (_, i): Msg => ({ id: i + 1, date: now - 7000 + i * 60, out: i % 3 === 0, senderId: "11", sender: "mnk", text: `msg ${i + 1}` }));
  const chatArea = (f: string) => f.split("\n").slice(1, 12).map((l) => l.replace("▌", " ")).join("\n");
  const cursorRow = (f: string) => f.split("\n").findIndex((l) => l.startsWith("▌"));

  test("k moves the cursor without scrolling until it nears the top", async () => {
    const s = await setup({ height: 24, messages: { ...msgs(), "-100": long() } });
    await s.keys("enter");
    await s.until((x) => x.includes("msg 70"));
    await Bun.sleep(60);
    await s.t.renderOnce();
    const before = chatArea(s.frame());
    await s.keys("k", "k");
    await Bun.sleep(60);
    await s.t.renderOnce();
    expect(chatArea(s.frame())).toBe(before); // view didn't move
    for (let i = 0; i < 12; i++) await s.keys("k");
    await Bun.sleep(80);
    await s.t.renderOnce();
    expect(chatArea(s.frame())).not.toBe(before); // now it scrolled
    expect(cursorRow(s.frame())).toBeGreaterThanOrEqual(3); // with context above the cursor
  });

  test("ctrl-u scrolls half a page and keeps the cursor on screen", async () => {
    const s = await setup({ height: 24, messages: { ...msgs(), "-100": long() } });
    await s.keys("enter");
    await s.until((x) => x.includes("msg 70"));
    await Bun.sleep(60);
    await s.keys("ctrl-u");
    // post-render frames run late under a full parallel suite: allow longer than the default
    await s.until((x) => !x.includes("msg 70") && cursorRow(x) > 0, 8000);
  });
});

describe("links, images, filter, accounts", () => {
  test("o on a link preview opens the link; on a location opens maps", async () => {
    const m = msgs();
    m["-100"]!.push(
      { id: 5, date: now - 20, out: false, senderId: "11", sender: "mnk", text: "I mean…", media: "link: X (formerly Twitter)", urls: ["https://x.com/paw_lean/status/1"] },
      { id: 6, date: now - 10, out: false, senderId: "11", sender: "mnk", text: "", media: "location", urls: ["https://maps.apple.com/?ll=37.7,-122.4"] }
    );
    const s = await setup({ messages: m });
    await s.keys("enter");
    await s.until((x) => x.includes("I mean"));
    await s.keys("k", "o"); // the location (newest)
    await s.until(() => s.opened.includes("https://maps.apple.com/?ll=37.7,-122.4"));
    await s.keys("k", "o");
    await s.until(() => s.opened.includes("https://x.com/paw_lean/status/1"));
    expect(s.src.calls.some((c) => c.method === "download")).toBe(false);
  });

  test("gx opens the link in the selected message", async () => {
    const m = msgs();
    m["-100"]!.push({ id: 4, date: now, out: false, senderId: "11", sender: "mnk", text: "tx https://solscan.io/tx/abc", urls: ["https://solscan.io/tx/abc"] });
    const s = await setup({ messages: m });
    await s.keys("enter");
    await s.until((x) => x.includes("solscan"));
    await s.keys("k", "gx");
    await s.until(() => s.opened.includes("https://solscan.io/tx/abc"));
  });

  test("v shows the photo inline; esc closes it", async () => {
    const png = FIXTURE_PNG;
    const s = await setup();
    s.src.imagePath = png;
    await s.keys("gc", "kate", "enter");
    await s.until((x) => x.includes("look at this"));
    await s.keys("k", "v"); // inline, under the message
    // drawn in the chat: the image's pixels appear while the transcript is still on screen
    await s.until((f) => f.includes("look at this") && drawsPixels(s.t) && !f.includes("esc close"));
    expect(s.src.calls.some((c) => c.method === "download")).toBe(true);
    await s.keys("V"); // full screen
    await s.until((x) => x.includes("esc close") && drawsPixels(s.t));
    await s.keys("esc");
    await s.until((x) => !x.includes("esc close") && x.includes("look at this"));
  });

  test("v refuses non-images (a location) and j/k step over them; p switches how images are drawn", async () => {
    const png = FIXTURE_PNG;
    const m = msgs();
    m["42"] = [
      { id: 20, date: now - 300, out: false, senderId: "42", sender: "Kate", text: "", media: "photo" },
      { id: 21, date: now - 200, out: false, senderId: "42", sender: "Kate", text: "", media: "location" },
      { id: 22, date: now - 100, out: false, senderId: "42", sender: "Kate", text: "second pic", media: "photo" },
    ];
    const s = await setup({ messages: m });
    s.src.imagePath = png;
    await s.keys("gc", "kate", "enter");
    await s.until((x) => x.includes("second pic"));
    await s.keys("k", "k"); // from your input: #22, then the location
    await s.keys("v");
    await s.until((x) => x.includes("not an image"));
    expect(s.frame()).not.toContain("esc close");
    await s.keys("j", "V"); // #22
    await s.until((x) => x.includes("#22") && x.includes("esc close"));
    await s.keys("k"); // steps over the location to #20
    await s.until((x) => x.includes("#20") && x.includes("esc close"));
    await s.keys("p"); // blocks is the default; next is auto
    await s.until((x) => x.includes("drawing: auto"));
    expect(s.settings).toEqual([["images", "auto"]]);
  });

  test("t transcribes a voice message under it; a video shows its preview with a play hint", async () => {
    const png = FIXTURE_PNG;
    const m = msgs();
    m["42"] = [
      { id: 30, date: now - 300, out: false, senderId: "42", sender: "Kate", text: "", media: "voice 0:17" },
      { id: 31, date: now - 200, out: false, senderId: "42", sender: "Kate", text: "", media: "video note 0:09" },
      { id: 32, date: now - 100, out: false, senderId: "42", sender: "Kate", text: "clip", media: "video 1:23: trip.mp4" },
    ];
    const s = await setup({ messages: m });
    s.src.imagePath = png;
    s.src.transcripts["42:30"] = "see you at seven near the station";
    await s.keys("gc", "kate", "enter");
    await s.until((x) => x.includes("trip.mp4"));
    await s.keys("k", "k", "k", "t"); // from your input up to the voice message
    await s.until((x) => x.includes("✎ see you at seven near the station"));
    await s.keys("j", "t"); // the video note has no transcript in the fake → error shown, not invented
    await s.until((x) => x.includes("✎ transcription needs telegram premium"));
    await s.keys("j", "t"); // a plain video isn't speech
    await s.until((x) => x.includes("select a voice message or video note"));
    await s.keys("V");
    await s.until((x) => x.includes("▶ video preview") && drawsPixels(s.t));
    expect(s.src.calls.some((c) => c.method === "thumbnail" && c.args[1] === 32)).toBe(true);
  });

  test("photos sent together say they're one album", async () => {
    const m = msgs();
    m["42"] = [
      { id: 40, date: now - 60, out: false, senderId: "42", sender: "Kate", text: "look", media: "photo", album: "g1" },
      { id: 41, date: now - 60, out: false, senderId: "42", sender: "Kate", text: "", media: "photo", album: "g1" },
    ];
    const s = await setup({ messages: m });
    await s.keys("gc", "kate", "enter");
    await s.until((x) => x.includes("▣ photo · album 1/2") && x.includes("▣ photo · album 2/2"));
  });

  test("durations read like a player", async () => {
    const { duration } = await import("../src/cli/duration");
    expect([duration(9), duration(16.8), duration(83), duration(3725)]).toEqual(["0:09", "0:17", "1:23", "1:02:05"]);
  });

  test("opening a chat from a filtered list resets the filter", async () => {
    const s = await setup();
    await s.keys("/", "kat", "enter", "enter");
    await s.until((x) => x.includes("look at this"));
    await s.keys("h");
    await s.until((x) => x.includes("Covers!") && x.includes("Kate"));
  });

  test("other accounts are warmed: ga shows them instantly, and calls wait for the real switch", async () => {
    const s = await setup();
    await s.until(() => s.src.peeks.includes("work"));
    await Bun.sleep(50);
    s.src.switchDelayMs = 800;
    const t0 = Date.now();
    await s.keys("ga", "work", "enter");
    await s.until((x) => x.includes("work team"), 400);
    expect(Date.now() - t0).toBeLessThan(700);
    await s.keys("enter", "i", "hi team", "enter");
    await s.until(() => s.src.calls.some((c) => c.method === "send"), 3000);
    const send = s.src.calls.find((c) => c.method === "send")!;
    expect(send.args[0]).toBe("555");
    expect(send.args[3]).toBe("work"); // sent only after the client really switched
    expect(s.settings).toContainEqual(["tuiAccount", "work"]); // remembered for next launch
  });
});

describe("folders", () => {
  test("membership follows telegram's rules", async () => {
    const { inFolder, ALL_CHATS } = await import("../src/tui/folders");
    const [covers, kate, saved, noisy] = chats();
    const unreadOnly = { id: 2, title: "Unread", include: [], exclude: [], pinned: [], contacts: true, nonContacts: true, groups: true, broadcasts: true, bots: true, excludeRead: true };
    expect(inFolder(covers!, unreadOnly)).toBe(true); // 3 unread
    expect(inFolder(saved!, unreadOnly)).toBe(false); // read
    const work = { id: 1, title: "Work", include: ["42"], exclude: ["-100"], pinned: ["7"], groups: true };
    expect(inFolder(covers!, work)).toBe(false); // excluded beats the groups flag
    expect(inFolder(kate!, work)).toBe(true); // included
    expect(inFolder(saved!, work)).toBe(true); // pinned
    expect(inFolder(noisy!, work)).toBe(true); // a group
    expect(inFolder(noisy!, { ...work, excludeMuted: true })).toBe(false); // muted dropped
    expect(inFolder({ ...kate!, archived: true }, ALL_CHATS)).toBe(false); // archived isn't in All chats
  });

  async function withFolders() {
    const s = await setup();
    s.src.folders = [
      { id: 1, title: "Work", include: ["42", "-100"], exclude: [], pinned: ["42"] },
      { id: 0, title: "All chats", all: true, include: [], exclude: [], pinned: [] },
      { id: 2, title: "Unread", include: [], exclude: [], pinned: [], groups: true, contacts: true, nonContacts: true, broadcasts: true, bots: true, excludeRead: true },
    ];
    await s.keys("ctrl-r");
    await s.until((x) => x.includes(" Work "));
    return s;
  }

  test("opens on the default folder (first in telegram order) with tabs and unread badges", async () => {
    const s = await withFolders();
    const f = s.frame();
    expect(f).toMatch(/ Work 2 .* All chats 2 .* Unread 2 /); // muted Noisy Group isn't counted
    const list = f.split("\n").filter((l) => /^[▌ ][●◌✎⌃ ] /.test(l));
    expect(list[0]).toContain("Kate"); // the folder's pinned chat first
    expect(f).not.toContain("Saved Messages"); // not in Work
  });

  test("tab and shift-tab cycle folders; gf picks one", async () => {
    const s = await withFolders();
    await s.keys("\t");
    await s.until((x) => x.includes("Saved Messages")); // All chats
    await s.keys("\t");
    await s.until((x) => !x.includes("Saved Messages") && x.includes("Covers!")); // Unread
    await s.t.mockInput.pressKey("TAB", { shift: true });
    await s.until((x) => x.includes("Saved Messages"));
    await s.keys("gf", "work", "enter");
    await s.until((x) => !x.includes("Saved Messages") && x.includes("Kate"));
  });

  test("chats only a folder names (older than the recent list) fill in from the background", async () => {
    const s = await setup();
    s.src.extras = [{ id: "888", title: "Old Friend", kind: "user", unread: 0, mentions: 0, muted: false, pinned: false, last: { text: "from 2023", out: false, date: now - 86400 * 900 } }];
    s.src.folders = [
      { id: 1, title: "Work", include: ["42", "888"], exclude: [], pinned: [] },
      { id: 0, title: "All chats", all: true, include: [], exclude: [], pinned: [] },
    ];
    await s.keys("ctrl-r");
    await s.until((x) => x.includes(" Work ") && x.includes("Old Friend"));
    expect(s.src.calls.some((c) => c.method === "folderExtras")).toBe(true);
  });

  test("the chat cache round-trips owner-only and refuses a corrupt file", async () => {
    const { loadPool, savePool } = await import("../src/tui/cache");
    const { statSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "st-cache-"));
    savePool("caffeinum", { chats: chats(), folders: [] }, dir);
    expect(loadPool("caffeinum", dir)?.chats.map((c) => c.title)).toEqual(chats().map((c) => c.title));
    expect(statSync(join(dir, "caffeinum.json")).mode & 0o777).toBe(0o600);
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ nope: 1 }));
    expect(() => loadPool("bad", dir)).toThrow(/corrupt chat cache/);
    expect(loadPool("missing", dir)).toBeUndefined();
  });

  test("/ searches every chat, not just the folder", async () => {
    const s = await withFolders();
    await s.keys("/", "saved");
    await s.until((x) => x.includes("Saved Messages"));
  });
});

test("a message whose live update was lost still shows up on the next resync", async () => {
  const s = await setup({ resyncMs: 300 });
  await s.keys("enter");
  await s.until((x) => x.includes("8qcK address"));
  // telegram got it, the live push didn't arrive
  s.src.messages["-100"]!.push({ id: 99, date: now, out: false, senderId: "11", sender: "mnk", text: "missed by the push" });
  s.src.chats[0]!.last = { text: "missed by the push", out: false, date: now };
  await s.until((x) => x.includes("missed by the push"), 3000);
});

test("the cursor bar covers every row of the selected message, photo included", async () => {
  const m = msgs();
  m["42"] = [{ id: 50, date: now - 60, out: false, senderId: "42", sender: "Kate", text: "line one", media: "photo" }];
  const s = await setup({ messages: m });
  await s.keys("gc", "kate", "enter");
  await s.until((x) => x.includes("line one"));
  await s.keys("k");
  const f = await s.until((x) => x.split("\n").some((l) => l.startsWith("▌") && l.includes("⏺ Kate")));
  const lines = f.split("\n");
  const head = lines.findIndex((l) => l.includes("⏺ Kate"));
  expect(lines[head]!.startsWith("▌")).toBe(true);
  expect(lines[head + 1]!.startsWith("▌")).toBe(true); // the text row
  expect(lines[head + 2]!.startsWith("▌") && lines[head + 2]!.includes("▣ photo")).toBe(true); // the photo row
});

describe("forums", () => {
  async function forum() {
    const s = await setup();
    s.src.chats.push({ id: "-300", title: "ai", kind: "supergroup", forum: true, unread: 2, mentions: 0, muted: false, pinned: false, last: { text: "done", out: false, date: now } });
    s.src.topicList["-300"] = [
      { id: 1, title: "General", unread: 0, last: { text: "hi all", date: now - 900, out: false } },
      { id: 1622, title: "vibeos-landing", unread: 2, last: { text: "all done and live", from: "paw", date: now - 60, out: false } },
      { id: 3381, title: "forum", unread: 0, pinned: true, last: { text: "pinned topic", date: now - 5000, out: false } },
    ];
    s.src.messages["-300"] = [
      { id: 10, date: now - 900, out: false, senderId: "5", sender: "paw", text: "hi all" }, // General: no topic header
      { id: 1622, date: now - 800, out: false, senderId: "5", sender: "paw", text: "[TopicCreate]", topicId: 1622 },
      { id: 1700, date: now - 60, out: false, senderId: "5", sender: "paw", text: "all done and live", topicId: 1622 },
      { id: 3400, date: now - 50, out: false, senderId: "5", sender: "paw", text: "pinned topic", topicId: 3381 },
    ];
    await s.keys("ctrl-r");
    await s.until((x) => x.includes(" ai "));
    await s.keys("gc", "ai", "enter");
    await s.until((x) => x.includes("3 topics") && x.includes("vibeos-landing"));
    return s;
  }

  test("a forum opens on its topics: pinned first, then by latest message", async () => {
    const s = await forum();
    const rows = s.frame().split("\n").filter((l) => /^[▌ ][●⌃✕#] /.test(l)).map((l) => l.slice(3, 20).trim());
    expect(rows).toEqual(["forum", "vibeos-landing", "General"]);
  });

  test("a topic shows only its messages, sends into it, and h goes back to the topics", async () => {
    const s = await forum();
    await s.keys("j", "enter"); // vibeos-landing
    await s.until((x) => x.includes("ai › vibeos-landing") && x.includes("all done and live"));
    expect(s.frame()).not.toContain("hi all"); // General's message isn't here
    expect(s.frame()).not.toContain("pinned topic");
    expect(s.src.calls.some((c) => c.method === "markRead" && JSON.stringify(c.args) === JSON.stringify(["-300", { id: 1622, maxId: 1700 }]))).toBe(true);
    await s.keys("i", "posting here", "enter");
    await s.until((x) => x.includes("> posting here"));
    expect(s.src.calls.find((c) => c.method === "send")!.args.slice(0, 3)).toEqual(["-300", "posting here", { replyTo: undefined, topicId: 1622 }]);
    await s.keys("esc", "h");
    await s.until((x) => x.includes("3 topics"));
    await s.keys("h");
    await s.until((x) => x.includes("Covers!"));
  });

  test("drafts are per topic", async () => {
    const s = await forum();
    await s.keys("j", "enter");
    await s.until((x) => x.includes("ai › vibeos-landing"));
    await s.keys("i", "for landing", "esc", "h", "j", "enter");
    await s.until((x) => x.includes("ai › General") && x.includes("hi all"));
    expect(s.frame()).not.toContain("for landing");
  });
});

describe("small terminal", () => {
  // the line above the input is the rule; text that wrapped past the box drew over it ("enter-to-write-…")
  const ruleAbove = (f: string, marker: string) => {
    const rows = f.split("\n");
    const i = rows.findIndex((r) => r.includes(marker));
    expect(i).toBeGreaterThan(0);
    return rows[i - 1]!.trim();
  };

  test("the input hint fits a narrow screen instead of wrapping over the rule", async () => {
    const s = await setup({ width: 50 });
    const header = s.frame().split("\n")[0]!;
    expect(header).toContain("3 unread chats");
    expect(header).toContain("default");
    await s.keys("enter");
    const f = await s.until((x) => x.includes("8qcK address") && x.includes("▌> enter to write"));
    expect(ruleAbove(f, "▌> enter to write")).toMatch(/^─+$/);
    expect(f).not.toContain("ctrl-k commands");
  });

  test("a long draft wraps inside the input box, below the rule", async () => {
    const s = await setup({ width: 40 });
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    const long = "the quick brown fox jumps over the lazy dog and keeps running far away";
    await s.keys("enter", long);
    const f = await s.until((x) => x.includes("▌> the quick"));
    expect(ruleAbove(f, "▌> the quick")).toMatch(/^─+$/);
    expect(f.replace(/\s+/g, "")).toContain("keepsrunningfaraway");
  });
});

describe("input row, reply, reactions", () => {
  test("a chat opens with the cursor on your input; enter writes (no reply); k then enter replies", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address") && x.includes("▌> enter to write"));
    await s.keys("enter", "fresh one", "enter");
    await s.until((x) => x.includes("> fresh one"));
    expect(s.src.sent()[0]).toEqual(["-100", "fresh one", { replyTo: undefined }]);
    await s.keys("esc", "k", "enter", "answer", "enter");
    await s.until((x) => x.includes("> answer"));
    expect(s.src.sent()[1]![2]).toEqual({ replyTo: 1000 }); // the newest message, our own "fresh one"
  });

  test("option+cyrillic arriving as alt keeps you typing and explains why", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("i", "при");
    // the real bytes a terminal with option-as-alt sends for ukrainian option+і: esc + utf-8 (d1 96)
    s.t.renderer.stdin.emit("data", Buffer.from("\x1bі", "utf8"));
    await Bun.sleep(60);
    await s.until((x) => x.includes("option+key arrived as alt"));
    expect(s.frame()).toContain("INSERT");
    await s.keys("вет", "enter");
    await s.until((x) => x.includes("> привет"));
  });

  test("ctrl-r refreshes the list and says so", async () => {
    const s = await setup();
    s.src.chats.push({ id: "77", title: "Brand New", kind: "user", unread: 1, mentions: 0, muted: false, pinned: false, last: { text: "hey", out: false, date: now + 5 } });
    await s.keys("ctrl-r");
    await s.until((x) => x.includes("refreshed · 5 chats") && x.includes("Brand New"));
  });

  test("ctrl-x drops the reply chip from normal mode too", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("k", "enter", "esc"); // reply started, back to normal
    await s.until((x) => x.includes("replying to") && x.includes("NORMAL"));
    await s.keys("ctrl-x");
    await s.until((x) => !x.includes("replying to"));
  });

  test("j past the last message returns to the input; a live message doesn't move a cursor on a message", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("k");
    await s.until((x) => !x.includes("▌> enter to write"));
    s.src.push({ type: "message", chatId: "-100", msg: { id: 60, date: now, out: false, senderId: "11", sender: "mnk", text: "while reading" } });
    await s.until((x) => x.includes("1 new ↓"));
    const barred = s.frame().split("\n").filter((l) => l.startsWith("▌")).join("\n");
    expect(barred).toContain("8qcK address"); // still on #3
    expect(barred).not.toContain("while reading");
    await s.keys("j", "j"); // the new message, then your input
    await s.until((x) => x.includes("▌> enter to write"));
  });

  test("r opens the reaction picker; picking reacts and shows it; picking again removes it", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("k", "r");
    await s.until((x) => x.includes("react with…") && x.includes("thumbs up like"));
    await s.keys("fire", "enter");
    await s.until((x) => x.includes("🔥 1"));
    expect(s.src.calls.find((c) => c.method === "react")!.args).toEqual(["-100", 3, ["🔥"]]);
    await s.keys("r", "fire");
    await s.until((x) => x.includes("yours · enter removes"));
    await s.keys("enter");
    await s.until((x) => !x.includes("🔥 1"));
    expect(s.src.calls.filter((c) => c.method === "react").pop()!.args).toEqual(["-100", 3, []]);
  });

  test("several reactions at once; telegram's limit is reported and the real state reloaded", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("k", "r", "fire", "enter");
    await s.until((x) => x.includes("🔥 1"));
    await s.keys("r", "heart", "enter");
    await s.until((x) => x.includes("🔥 1") && x.includes("❤️ 1"));
    expect(s.src.calls.filter((c) => c.method === "react").pop()!.args).toEqual(["-100", 3, ["🔥", "❤️"]]);
    s.src.reactLimit = 2;
    await s.keys("r", "party", "enter");
    await s.until((x) => x.includes("telegram refused the reaction: REACTIONS_TOO_MANY"));
  });

  test("reactions from others arrive live", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    s.src.push({ type: "reactions", chatId: "-100", msgId: 3, reactions: [{ emoji: "❤️", count: 2, mine: false }] });
    await s.until((x) => x.includes("❤️ 2"));
  });
});

describe("forward", () => {
  test("f picks a chat from a recency-sorted list and forwards there; esc cancels", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("k", "f");
    await s.until((x) => x.includes("forward #3 to…"));
    const rows = s.frame().split("\n").filter((l) => /^[▌ ][●◌✎⌃ ] /.test(l)).map((l) => l.slice(3, 20).trim()).filter(Boolean);
    expect(rows).toEqual(["Covers!", "Kate", "Saved Messages", "Noisy Group"]); // newest first
    await s.keys("esc");
    await s.until((x) => x.includes("← Covers!"));
    expect(s.src.calls.some((c) => c.method === "forward")).toBe(false);
    await s.keys("f", "/", "kat", "enter");
    await s.until((x) => x.includes("forwarded to Kate"));
    expect(s.src.calls.find((c) => c.method === "forward")?.args).toEqual(["-100", [3], "42", "default"]);
    expect(s.frame()).toContain("← Covers!"); // back where you were
  });
});

describe("review regressions", () => {
  test("search picked from insert mode: typing in results never reaches the prompt or sends", async () => {
    const { keys, until, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i", "hi", "ctrl-k", "search messages everywhere", "enter", "address", "enter");
    await until((x) => x.includes('search "address"'));
    await keys("j", "x", "enter");
    await Bun.sleep(100);
    expect(src.sent()).toHaveLength(0);
  });

  test("a late clipboard image lands in the chat it was pasted in, without typing mode elsewhere", async () => {
    const { apply, initialState: init } = await import("../src/tui/state");
    const s = init("default", ["default"], {});
    s.view = "list"; // the user left the chat before osascript answered
    s.open = { chatId: "-100", messages: [], loading: false, atStart: true, latest: true, newBelow: 0 };
    const [after] = apply(s, { type: "attach", path: "/tmp/x.png", key: "default:-100", chatId: "-100" });
    expect(after.mode).toBe("normal");
    expect(after.drafts["default:-100"]?.files).toEqual(["/tmp/x.png"]);
  });

  test("a partly failed multi-file send restores only the unsent files", async () => {
    const { apply, initialState: init } = await import("../src/tui/state");
    const s = init("default", ["default"], {});
    s.outbox = { "default:-100": { text: "cap", cursor: 3, files: ["/a.png", "/b.png"] } };
    const [after] = apply(s, { type: "sendFailed", key: "default:-100", error: "boom", unsent: { text: "", cursor: 0, files: ["/b.png"] } });
    expect(after.drafts["default:-100"]).toEqual({ text: "", cursor: 0, files: ["/b.png"] });
  });

  test("quitting while a message is sending waits for it", async () => {
    const s = await setup();
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const send = s.src.send.bind(s.src);
    s.src.send = async (...a) => {
      await held;
      return send(...a);
    };
    await s.keys("i", "slow one", "enter", "esc", "ZZ");
    expect(s.quit()).toBe(false);
    await s.until((x) => x.includes("quitting as soon as it lands"));
    release();
    await s.until(() => s.quit());
    expect(s.src.sent()).toHaveLength(1);
  });

  test("account switch is refused while a message is in flight", async () => {
    const { switchTo } = await import("../src/tui/keys");
    const { initialState: init } = await import("../src/tui/state");
    const s = init("default", ["default", "work"], {});
    s.outbox = { "default:-100": { text: "x", cursor: 1, files: [] } };
    const [after, fx] = switchTo(s, "work");
    expect(fx).toHaveLength(0);
    expect(after.toast?.error).toBe(true);
  });
});

describe("paste", () => {
  test("a pasted path to a file becomes an attachment chip and is sent as a file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "st-test-"));
    const img = join(dir, "shot.png");
    writeFileSync(img, "png");
    const { keys, until, t, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await t.mockInput.pasteBracketedText(img);
    await until((x) => x.includes("⧉ shot.png"));
    await keys("caption", "enter");
    await until((x) => !x.includes("⧉ shot.png"));
    expect(src.sent()[0]).toEqual(["-100", "caption", { file: img, replyTo: undefined }]);
  });

  test("pasted multi-line text stays one message", async () => {
    const { keys, until, t, src } = await setup();
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    await keys("i");
    await t.mockInput.pasteBracketedText("line one\nline two\nline three");
    await keys("enter");
    await until((x) => x.includes("line three"));
    expect(src.sent()).toEqual([["-100", "line one\nline two\nline three", { replyTo: undefined }]]);
  });
});

// light and dark terminals: every visible cell must use the terminal's own colors (default or palette index),
// never a fixed rgb (opentui's implicit default is white, invisible on a light theme) or inverse video
test("the header names the account, and typing says who you send as", async () => {
  const { keys, until, frame } = await setup();
  expect(frame()).toContain("default @default_user · ga switch");
  await keys("enter");
  await until((x) => x.includes("8qcK address"));
  await keys("i");
  await until((x) => x.includes("sending as @default_user"));
});

describe("theme-safe colors", () => {
  async function offenders(t: Setup["t"]) {
    const bad: string[] = [];
    const { TextAttributes } = await import("@opentui/core");
    for (const line of t.captureSpans().lines) {
      for (const sp of line.spans) {
        if (!sp.text.trim()) continue;
        if (sp.fg.intent === "rgb") bad.push(`fg rgb ${sp.fg.toString()} on "${sp.text.trim().slice(0, 30)}"`);
        if (sp.bg.intent === "rgb" && sp.bg.a > 0) bad.push(`bg rgb ${sp.bg.toString()} on "${sp.text.trim().slice(0, 30)}"`);
        if (sp.attributes & TextAttributes.INVERSE) bad.push(`inverse on "${sp.text.trim().slice(0, 30)}"`);
      }
    }
    return [...new Set(bad)];
  }
  test("list, chat + prompt, palette, help, results", async () => {
    const s = await setup();
    expect(await offenders(s.t)).toEqual([]);
    await s.keys("enter");
    await s.until((x) => x.includes("8qcK address"));
    await s.keys("i", "typing");
    expect(await offenders(s.t)).toEqual([]);
    await s.keys("ctrl-k");
    expect(await offenders(s.t)).toEqual([]);
    await s.keys("esc", "esc", "?");
    expect(await offenders(s.t)).toEqual([]);
    await s.keys("esc", "gs", "address", "enter");
    await s.until((x) => x.includes('search "address"'));
    expect(await offenders(s.t)).toEqual([]);
  });
});

describe("layout", () => {
  test("80 columns: nothing overflows", async () => {
    const { frame, keys, until } = await setup({ width: 80, height: 24 });
    for (const line of frame().split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80);
    await keys("enter");
    await until((x) => x.includes("8qcK address"));
    for (const line of frame().split("\n")) expect(Bun.stringWidth(line)).toBeLessThanOrEqual(80);
  });
});

// every shortcut shown in the palette must do exactly what picking that entry does
describe("shortcut ↔ palette parity", () => {
  const base = (view: State["view"]): State => {
    const s = initialState("default", ["default", "work"], {});
    s.chats = chats();
    s.chatsLoaded = true;
    s.listSel = "-100";
    s.view = view;
    if (view !== "list") s.open = { chatId: "-100", messages: msgs()["-100"]!, sel: 3, loading: false, atStart: true, latest: true, newBelow: 0 };
    if (view === "results") s.results = { query: "x", hits: [], sel: 0, loading: false };
    return s;
  };
  const press = (s: State, token: string): ReturnType<typeof handleKey> => {
    let r: ReturnType<typeof handleKey> = [s, []];
    const parts = token.startsWith("ctrl-") || token.startsWith("alt-") ? [token] : token.length === 2 && token !== "gg" ? [...token] : token === "gg" ? ["g", "g"] : [token];
    for (const p of parts) {
      const k: Key = p.startsWith("ctrl-")
        ? { name: p.slice(5), ctrl: true, meta: false, shift: false, sequence: "" }
        : { name: p.length === 1 ? p : p, ctrl: false, meta: false, shift: false, sequence: p.length === 1 ? p : "" };
      r = handleKey(r[0], k);
    }
    return r;
  };
  for (const c of COMMANDS.filter((c) => !c.hidden && c.keys[0])) {
    for (const view of c.views) {
      test(`${c.keys[0]} = "${c.title}" in ${view}`, () => {
        const viaKey = press(base(view), c.keys[0]!);
        const viaPalette = c.run(base(view));
        const strip = ([s, fx]: ReturnType<typeof handleKey>) => JSON.stringify([{ ...s, pending: "", quitArmed: false, toast: undefined }, fx]);
        expect(strip(viaKey)).toBe(strip(viaPalette));
      });
    }
  }
});
