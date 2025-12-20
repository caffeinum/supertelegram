import { TelegramClient, type Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { Logger } from "telegram/extensions/Logger";
import type { LogLevel } from "telegram/extensions/Logger";
import { loadSession, saveSession } from "../session/storage";
import { getApiCredentials } from "../config/manager";

let verbose = false;

export function setVerbose(v: boolean) {
  verbose = v;
}

class SilentLogger extends Logger {
  override log(_level: LogLevel, _message: string, _color: string): void {
    if (verbose) {
      super.log(_level, _message, _color);
    }
  }
}

let client: TelegramClient | null = null;
let customSessionPath: string | undefined;

export function setSessionPath(path: string) {
  customSessionPath = path;
}

export async function getClient(): Promise<TelegramClient> {
  if (client) return client;

  const creds = getApiCredentials();
  if (!creds) {
    throw new Error(
      "telegram API credentials not found.\n" +
      "get them from: https://my.telegram.org/apps\n" +
      "then run: telegram config set appId <id>\n" +
      "         telegram config set appHash <hash>\n" +
      "or set env vars: TELEGRAM_APP_ID, TELEGRAM_APP_HASH"
    );
  }

  const sessionStr = loadSession(customSessionPath);
  const session = new StringSession(sessionStr);

  client = new TelegramClient(session, creds.appId, creds.appHash, {
    connectionRetries: 5,
    baseLogger: new SilentLogger(),
  });

  await client.connect();
  return client;
}

export async function isLoggedIn(): Promise<boolean> {
  const c = await getClient();
  return c.checkAuthorization();
}

export async function login(callbacks: {
  phoneNumber: () => Promise<string>;
  phoneCode: () => Promise<string>;
  password: () => Promise<string>;
}): Promise<void> {
  const c = await getClient();

  await c.start({
    phoneNumber: callbacks.phoneNumber,
    phoneCode: callbacks.phoneCode,
    password: callbacks.password,
    onError: (err) => console.error("login error:", err),
  });

  const sessionStr = c.session.save() as unknown as string;
  saveSession(sessionStr, customSessionPath);
  console.log("session saved!");
}

export async function sendMessage(
  username: string,
  message: string
): Promise<Api.Message> {
  const c = await getClient();
  return c.sendMessage(username, { message });
}

export async function getMessages(
  username: string,
  limit = 10
): Promise<Api.Message[]> {
  const c = await getClient();
  const messages = await c.getMessages(username, { limit });
  return messages as Api.Message[];
}

export async function getDialogs(limit = 10) {
  const c = await getClient();
  return c.getDialogs({ limit });
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.disconnect();
    client = null;
  }
}
