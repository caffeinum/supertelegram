import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getCurrentAccount, accountSessionPath } from "./accounts";

const CONFIG_DIR = join(homedir(), ".supertelegram");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SESSION_FILE = join(CONFIG_DIR, "session.txt");

export interface Config {
  appId?: string;
  appHash?: string;
  wss?: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function getConfig(): Config {
  ensureConfigDir();
  
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("failed to read config:", err);
    return {};
  }
}

export function setConfig(key: string, value: string) {
  ensureConfigDir();
  
  const config = getConfig();
  config[key as keyof Config] = value;
  
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getSessionPath(customPath?: string): string {
  // precedence:
  // 1. custom path from flag (--account resolves to one of these)
  // 2. TELEGRAM_SESSION env var
  // 3. current account's session (~/.supertelegram/accounts/<name>.txt)
  // 4. local ./session.txt (backwards compat)
  // 5. global ~/.supertelegram/session.txt (legacy default)

  if (customPath) {
    return customPath;
  }

  if (process.env.TELEGRAM_SESSION) {
    return process.env.TELEGRAM_SESSION;
  }

  const current = getCurrentAccount();
  if (current) {
    return accountSessionPath(current);
  }

  // check if local session.txt exists (backwards compat)
  if (existsSync("./session.txt")) {
    return "./session.txt";
  }

  return SESSION_FILE;
}

export function wssEnabled(): boolean {
  const env = process.env.TELEGRAM_WSS;
  if (env !== undefined) return env === "1" || env === "true";
  return getConfig().wss === "true";
}

export function getApiCredentials(): { appId: number; appHash: string } | null {
  // precedence:
  // 1. env vars
  // 2. global config
  // 3. local .env (handled by process.env already)
  
  const envAppId = process.env.TELEGRAM_APP_ID;
  const envAppHash = process.env.TELEGRAM_APP_HASH;
  
  if (envAppId && envAppHash) {
    return {
      appId: Number.parseInt(envAppId),
      appHash: envAppHash,
    };
  }
  
  const config = getConfig();
  if (config.appId && config.appHash) {
    return {
      appId: Number.parseInt(config.appId),
      appHash: config.appHash,
    };
  }
  
  return null;
}

export { CONFIG_DIR, CONFIG_FILE, SESSION_FILE };
