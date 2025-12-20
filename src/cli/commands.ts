import {
  isLoggedIn,
  sendMessage,
  getMessages,
  getDialogs,
  disconnect,
  getClient,
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

export async function unread(limit = 20) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: bun run login");
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
    const messages = await client.getMessages(dialog.entity, { limit: Math.min(dialog.unreadCount, 5) });
    
    const fromOthers = messages.filter((m) => m.senderId?.toString() !== myId);

    output.push({
      chat: dialog.title,
      unreadCount: dialog.unreadCount,
      messages: fromOthers.map((m) => ({
        id: m.id,
        text: m.message,
        date: m.date ? new Date(m.date * 1000).toISOString() : null,
      })),
    });
  }

  console.log(JSON.stringify(output, null, 2));
  await disconnect();
}

export async function reply(chatName: string, message: string) {
  if (!(await isLoggedIn())) {
    console.error("not logged in. run: bun run login");
    process.exit(1);
  }

  const client = await getClient();
  const dialogList = await getDialogs(50);

  const dialog = dialogList.find(
    (d) => d.title?.toLowerCase().includes(chatName.toLowerCase())
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
