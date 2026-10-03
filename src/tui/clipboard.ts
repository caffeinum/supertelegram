import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// terminals can't paste image bytes, so read the macOS clipboard directly:
// an image (PNG) is written to a temp file; a copied file (Finder) gives its path
const SCRIPT = (out: string) => `
try
  set img to (the clipboard as «class PNGf»)
  set f to open for access (POSIX file "${out}") with write permission
  set eof of f to 0
  write img to f
  close access f
  return "image"
on error
  try
    return "file:" & (POSIX path of (the clipboard as «class furl»))
  on error
    return "none"
  end try
end try`;

export type ClipboardResult = { kind: "image" | "file"; path: string } | { kind: "none"; reason: string };

export async function readClipboardImage(): Promise<ClipboardResult> {
  if (process.platform !== "darwin") return { kind: "none", reason: "pasting images needs macOS (osascript)" };
  const dir = join(tmpdir(), "supertelegram");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `paste-${Date.now()}.png`);
  const proc = Bun.spawn(["osascript", "-e", SCRIPT(out)], { stdout: "pipe", stderr: "pipe" });
  const text = (await new Response(proc.stdout).text()).trim();
  if ((await proc.exited) !== 0) return { kind: "none", reason: (await new Response(proc.stderr).text()).trim() || "osascript failed" };
  if (text === "image") return { kind: "image", path: out };
  if (text.startsWith("file:")) return { kind: "file", path: text.slice(5) };
  return { kind: "none", reason: "no image on the clipboard" };
}

export async function copyText(text: string): Promise<void> {
  const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" });
  proc.stdin.write(text);
  await proc.stdin.end();
  if ((await proc.exited) !== 0) throw new Error("pbcopy failed");
}

// a dragged-in or pasted path, shell-escaped or quoted by the terminal
export function pastedPath(text: string): string | undefined {
  const t = text.trim();
  if (!t || t.includes("\n")) return undefined;
  const unquoted = t.replace(/^'(.*)'$/s, "$1").replace(/^"(.*)"$/s, "$1").replace(/\\(.)/g, "$1");
  const expanded = unquoted.startsWith("~/") ? join(process.env.HOME ?? "", unquoted.slice(2)) : unquoted;
  return expanded.startsWith("/") ? expanded : undefined;
}
