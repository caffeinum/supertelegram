import { expect, test } from "bun:test";

// 0.13.0 shipped offline: gramjs loaded after opentui's renderer set global.window and took the browser path.
// runs in a fresh process, in the tui's real order: tui entry, then a renderer, then gramjs
test("gramjs still sees node after the tui creates its renderer", async () => {
  const script = `
    await import("${import.meta.dir}/../src/tui/index.tsx");
    const { createTestRenderer } = await import("@opentui/core/testing");
    const t = await createTestRenderer({ width: 10, height: 2 });
    const { isBrowser, isNode } = await import("telegram/platform");
    const { TelegramClient } = await import("telegram");
    const { StringSession } = await import("telegram/sessions");
    new TelegramClient(new StringSession(""), 1, "x", {});
    console.log(JSON.stringify({ windowSet: typeof globalThis.window, isBrowser, isNode }));
    t.renderer.destroy();
    process.exit(0);
  `;
  const p = Bun.spawnSync(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const out = p.stdout.toString().trim().split("\n").pop()!;
  expect(p.exitCode).toBe(0);
  expect(JSON.parse(out)).toEqual({ windowSet: "object", isBrowser: false, isNode: true });
});
