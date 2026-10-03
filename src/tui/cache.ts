import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatPool } from "./types";

// the last chat list per account, so the first frame is instant and complete; refreshed live right after.
// holds chat titles and last-message previews: owner-only, like the session files next to it
const DIR = join(homedir(), ".supertelegram", "cache");

const file = (account: string, dir: string) => join(dir, `${account.replace(/[^\w.-]/g, "_")}.json`);

export function loadPool(account: string, dir = DIR): ChatPool | undefined {
  const f = file(account, dir);
  if (!existsSync(f)) return undefined;
  const data = JSON.parse(readFileSync(f, "utf-8")) as ChatPool;
  if (!Array.isArray(data.chats) || !Array.isArray(data.folders)) throw new Error(`corrupt chat cache at ${f} — delete it and restart`);
  return data;
}

export function savePool(account: string, pool: ChatPool, dir = DIR): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = file(account, dir);
  writeFileSync(f, JSON.stringify(pool), { mode: 0o600 });
  chmodSync(f, 0o600);
}
