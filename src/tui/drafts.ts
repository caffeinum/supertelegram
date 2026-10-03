import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Draft } from "./state";

const FILE = join(homedir(), ".supertelegram", "drafts.json");

export function loadDrafts(file = FILE): Record<string, Draft> {
  if (!existsSync(file)) return {};
  const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, Draft>;
  return raw;
}

export function saveDrafts(drafts: Record<string, Draft>, file = FILE): void {
  const keep = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.text.trim() || d.files.length || d.replyTo));
  writeFileSync(file, JSON.stringify(keep, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}
