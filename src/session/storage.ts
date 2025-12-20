import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getSessionPath } from "../config/manager";

export function loadSession(customPath?: string): string {
  const sessionFile = getSessionPath(customPath);
  
  if (existsSync(sessionFile)) {
    return readFileSync(sessionFile, "utf-8").trim();
  }
  return "";
}

export function saveSession(session: string, customPath?: string): void {
  const sessionFile = getSessionPath(customPath);
  
  // ensure directory exists
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  writeFileSync(sessionFile, session, "utf-8");
}
