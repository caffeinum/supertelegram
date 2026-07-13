import {
  isLoggedIn,
  sendMessage,
  getMessages,
  getDialogs,
  disconnect,
  getClient,
  login as telegramLogin,
  sendFile as telegramSendFile,
  downloadMedia as telegramDownloadMedia,
} from "../client/telegram";
import { askPhoneNumber, askPhoneCode, askPassword, askAppId, askAppHash } from "./prompts";
import { getApiCredentials, setConfig } from "../config/manager";
import { Api } from "telegram";

export async function send(username: string, message: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const result = await sendMessage(username, message);
  console.log(`sent message id: ${result.id}`);
  await disconnect();
}

function getMediaInfo(msg: Api.Message): string {
  if (!msg.media) return "";
  
  if (msg.media instanceof Api.MessageMediaPhoto) {
    return " [photo]";
  }
  if (msg.media instanceof Api.MessageMediaDocument) {
    const doc = msg.media.document;
    if (doc instanceof Api.Document) {
      const attrs = doc.attributes;
      const filenameAttr = attrs.find((a) => "fileName" in a && a.fileName);
      const filename = filenameAttr && "fileName" in filenameAttr ? filenameAttr.fileName : undefined;
      const isVideo = attrs.some((a) => a instanceof Api.DocumentAttributeVideo);
      const isAudio = attrs.some((a) => a instanceof Api.DocumentAttributeAudio);
      
      if (isVideo) return ` [video${filename ? `: ${filename}` : ""}]`;
      if (isAudio) return ` [audio${filename ? `: ${filename}` : ""}]`;
      return ` [file${filename ? `: ${filename}` : ""}]`;
    }
  }
  return " [media]";
}

export async function read(username: string, limit = 10) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const messages = await getMessages(username, limit);
  for (const msg of messages.reverse()) {
    const sender = msg.senderId?.toString() ?? "unknown";
    const date = msg.date ? new Date(msg.date * 1000).toISOString() : "";
    const mediaInfo = getMediaInfo(msg);
    console.log(`[${date}] [${sender}]: ${msg.message}${mediaInfo}`);
  }
  await disconnect();
}

export async function dialogs(limit = 10) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const dialogList = await getDialogs(limit);
  for (const dialog of dialogList) {
    const entity = dialog.entity;
    const username =
      entity && "username" in entity && entity.username
        ? ` @${entity.username}`
        : "";
    const id = dialog.id?.toString() ?? entity?.id?.toString() ?? "?";
    const unread = dialog.unreadCount > 0 ? ` (${dialog.unreadCount} unread)` : "";
    console.log(`- ${dialog.title}${username} [id: ${id}]${unread}`);
  }
  console.log("\nsend with: telegram send <@username|id> \"your message\"");
  await disconnect();
}

export async function unread(limit = 20) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const client = await getClient();
  const me = await client.getMe();
  const myId = me.id.toString();

  const dialogList = await getDialogs(limit);

  const unreadDialogs = dialogList.filter((d) => d.unreadCount > 0 && d.entity);

  if (unreadDialogs.length === 0) {
    console.log("no unread messages");
    await disconnect();
    return;
  }

  // output as JSON for easy parsing
  const output = [];

  for (const dialog of unreadDialogs) {
    if (!dialog.entity) continue;

    // get last few messages
    const messages = await client.getMessages(dialog.entity, {
      limit: Math.min(dialog.unreadCount, 5),
    });

    const fromOthers = messages.filter((m) => m.senderId?.toString() !== myId);

    output.push({
      chat: dialog.title,
      unreadCount: dialog.unreadCount,
      messages: fromOthers.map((m) => ({
        id: m.id,
        text: m.message,
        media: m.media ? getMediaInfo(m).trim() : null,
        date: m.date ? new Date(m.date * 1000).toISOString() : null,
      })),
    });
  }

  console.log(JSON.stringify(output, null, 2));
  await disconnect();
}

export async function reply(chatName: string, message: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const client = await getClient();
  const dialogList = await getDialogs(50);

  const dialog = dialogList.find((d) =>
    d.title?.toLowerCase().includes(chatName.toLowerCase())
  );

  if (!dialog || !dialog.entity) {
    console.error(`chat "${chatName}" not found`);
    process.exit(1);
  }

  const result = await client.sendMessage(dialog.entity, { message });
  console.log(`sent to ${dialog.title}: ${message} (id: ${result.id})`);

  // mark as read
  await client.markAsRead(dialog.entity);

  await disconnect();
}

export async function login() {
  // check if API credentials are configured
  const creds = getApiCredentials();
  if (!creds) {
    console.log("no API credentials found. let's set them up first.");
    const appId = await askAppId();
    const appHash = await askAppHash();
    
    setConfig("appId", appId);
    setConfig("appHash", appHash);
    console.log("credentials saved to ~/.supertelegram/config.json\n");
  }

  const loggedIn = await isLoggedIn();
  if (loggedIn) {
    console.log("already logged in!");
    await disconnect();
    return;
  }

  console.log("starting login...");
  await telegramLogin({
    phoneNumber: askPhoneNumber,
    phoneCode: askPhoneCode,
    password: askPassword,
  });

  console.log("login complete!");
  await disconnect();
}

export async function config(action?: string, key?: string, value?: string) {
  if (action === "set" && key && value) {
    setConfig(key, value);
    console.log(`set ${key} = ${value}`);
    return;
  }
  
  if (action === "get" && key) {
    const cfg = getApiCredentials();
    if (key === "appId" && cfg) {
      console.log(cfg.appId);
    } else if (key === "appHash" && cfg) {
      console.log(cfg.appHash);
    } else {
      console.log("not found");
    }
    return;
  }
  
  console.log("usage:");
  console.log("  telegram config set appId <id>");
  console.log("  telegram config set appHash <hash>");
  console.log("  telegram config get appId");
}

export async function sendFile(username: string, filePath: string, caption?: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const result = await telegramSendFile(username, filePath, caption);
  console.log(`sent file id: ${result.id}`);
  await disconnect();
}

export async function downloadMedia(username: string, messageId: number, outputPath?: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: telegram login");
    process.exit(1);
  }

  const messages = await getMessages(username, 100);
  const msg = messages.find((m) => m.id === messageId);
  
  if (!msg) {
    console.error(`message ${messageId} not found`);
    await disconnect();
    process.exit(1);
  }
  
  if (!msg.media) {
    console.error(`message ${messageId} has no media`);
    await disconnect();
    process.exit(1);
  }

  console.log("downloading media...");
  const path = await telegramDownloadMedia(msg, outputPath);
  console.log(`saved to: ${path || outputPath || "unknown"}`);
  await disconnect();
}
