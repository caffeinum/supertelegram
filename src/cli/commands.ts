import {
  isLoggedIn,
  sendMessage,
  getMessages,
  getDialogs,
  disconnect,
} from "../client/telegram";

export async function send(username: string, message: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: bun run login");
    process.exit(1);
  }

  const result = await sendMessage(username, message);
  console.log(`sent message id: ${result.id}`);
  await disconnect();
}

export async function read(username: string, limit = 10) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: bun run login");
    process.exit(1);
  }

  const messages = await getMessages(username, limit);
  for (const msg of messages.reverse()) {
    const sender = msg.senderId?.toString() ?? "unknown";
    const date = msg.date ? new Date(msg.date * 1000).toISOString() : "";
    console.log(`[${date}] [${sender}]: ${msg.message}`);
  }
  await disconnect();
}

export async function dialogs(limit = 10) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: bun run login");
    process.exit(1);
  }

  const dialogList = await getDialogs(limit);
  for (const dialog of dialogList) {
    console.log(`- ${dialog.title}`);
  }
  await disconnect();
}
