import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SESSION_FILE = "./session.txt";

export function loadSession(): string {
  if (existsSync(SESSION_FILE)) {
    return readFileSync(SESSION_FILE, "utf-8").trim();
  }
  return "";
}

export function saveSession(session: string): void {
  writeFileSync(SESSION_FILE, session, "utf-8");
}
