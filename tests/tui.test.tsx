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

// react's act() warnings are noise here: the renderer flushes on its own
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

async function setup(opts: { width?: number; height?: number; drafts?: Record<string, Draft>; messages?: Record<string, Msg[]> } = {}) {
  const src = new FakeSource(chats(), opts.messages ?? msgs());
  const saved: Record<string, Draft>[] = [];
  let quit = false;
  const t = await testRender(
    <App
      source={src}
      initial={initialState("default", ["default", "work"], opts.drafts ?? {})}
      onQuit={() => (quit = true)}
      persistDrafts={(d) => saved.push(structuredClone(d))}
      openFile={async () => {}}
    />,
    { width: opts.width ?? 100, height: opts.height ?? 30, exitOnCtrlC: false }
  );
  const keys = async (...ks: string[]) => {
    for (const k of ks) {
      if (k.startsWith("ctrl-")) await t.mockInput.pressKey(k.slice(5), { ctrl: true });
      else if (k.startsWith("alt-")) await t.mockInput.pressKey(k.slice(4), { meta: true });
      else if (k === "enter") await t.mockInput.pressKey("RETURN");
      else if (k === "esc") t.mockInput.pressEscape();
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
  return { t, src, saved, keys, frame, until, quit: () => quit };
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
    await keys("k", "r", "got it", "enter"); // k → message #2
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
