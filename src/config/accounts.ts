import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// kept in sync with manager.ts; recomputed here to avoid a circular import
const CONFIG_DIR = join(homedir(), ".supertelegram");
const ACCOUNTS_DIR = join(CONFIG_DIR, "accounts");
const ACCOUNTS_FILE = join(CONFIG_DIR, "accounts.json");
const LEGACY_SESSION_FILE = join(CONFIG_DIR, "session.txt");

export interface AccountMeta {
  username?: string;
  userId?: string;
  name?: string;
}

export interface AccountsRegistry {
  current?: string;
  accounts: Record<string, AccountMeta>;
}

function readRegistry(): AccountsRegistry {
  if (!existsSync(ACCOUNTS_FILE)) return { accounts: {} };
  try {
    return JSON.parse(readFileSync(ACCOUNTS_FILE, "utf-8"));
  } catch {
    return { accounts: {} };
  }
}

function writeRegistry(reg: AccountsRegistry): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(reg, null, 2));
}

export function accountSessionPath(name: string): string {
  return join(ACCOUNTS_DIR, `${name}.txt`);
}

export function getCurrentAccount(): string | undefined {
  return readRegistry().current;
}

export function listAccounts(): {
  name: string;
  meta: AccountMeta;
  current: boolean;
}[] {
  const reg = readRegistry();
  return Object.entries(reg.accounts).map(([name, meta]) => ({
    name,
    meta,
    current: name === reg.current,
  }));
}

export function setCurrentAccount(name: string): void {
  const reg = readRegistry();
  if (!reg.accounts[name]) {
    const known = Object.keys(reg.accounts);
    throw new Error(
      `account "${name}" not found.` +
        (known.length ? ` known accounts: ${known.join(", ")}` : " run: telegram login <name>")
    );
  }
  reg.current = name;
  writeRegistry(reg);
}

export function registerAccount(
  name: string,
  meta: AccountMeta,
  makeCurrent = true
): void {
  if (!existsSync(ACCOUNTS_DIR)) mkdirSync(ACCOUNTS_DIR, { recursive: true });
  const reg = readRegistry();
  reg.accounts[name] = meta;
  if (makeCurrent) reg.current = name;
  writeRegistry(reg);
}

export function removeAccount(name: string): void {
  const reg = readRegistry();
  if (!reg.accounts[name]) {
    throw new Error(`account "${name}" not found`);
  }
  delete reg.accounts[name];
  if (reg.current === name) reg.current = Object.keys(reg.accounts)[0];
  writeRegistry(reg);

  const sessionFile = accountSessionPath(name);
  if (existsSync(sessionFile)) rmSync(sessionFile);
}

// one-time migration: fold a pre-multi-account session.txt into account "default"
// so existing installs keep their login after upgrading.
export function migrateLegacyIfNeeded(): void {
  const reg = readRegistry();
  if (Object.keys(reg.accounts).length > 0) return; // already on the accounts system

  if (existsSync(LEGACY_SESSION_FILE) && readFileSync(LEGACY_SESSION_FILE, "utf-8").trim()) {
    if (!existsSync(ACCOUNTS_DIR)) mkdirSync(ACCOUNTS_DIR, { recursive: true });
    copyFileSync(LEGACY_SESSION_FILE, accountSessionPath("default"));
    registerAccount("default", {}, true);
  }
}
