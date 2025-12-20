import { TelegramClient, type Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { loadSession, saveSession } from "../session/storage";

const API_ID = Number(process.env.TELEGRAM_APP_ID);
const API_HASH = process.env.TELEGRAM_APP_HASH ?? "";

let client: TelegramClient | null = null;

export async function getClient(): Promise<TelegramClient> {
  if (client) return client;

  const sessionStr = loadSession();
  const session = new StringSession(sessionStr);

  client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
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
  saveSession(sessionStr);
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
