import {
  isLoggedIn,
  login,
  sendMessage,
  getMessages,
  getDialogs,
  disconnect,
} from "../client/telegram";
import {
  askPhoneNumber,
  askPhoneCode,
  askPassword,
  askMessage,
  askUsername,
  askCommand,
} from "./prompts";

async function ensureLoggedIn() {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    console.log("not logged in, starting login flow...");
    await login({
      phoneNumber: askPhoneNumber,
      phoneCode: askPhoneCode,
      password: askPassword,
    });
  }
  console.log("logged in!");
}

async function handleSend() {
  const username = await askUsername();
  const message = await askMessage();
  const result = await sendMessage(username, message);
  console.log("sent:", result.id);
}

async function handleRead() {
  const username = await askUsername();
  const messages = await getMessages(username, 10);
  console.log("\n--- messages ---");
  for (const msg of messages.reverse()) {
    const sender = msg.senderId?.toString() ?? "unknown";
    console.log(`[${sender}]: ${msg.message}`);
  }
  console.log("----------------\n");
}

async function handleDialogs() {
  const dialogs = await getDialogs(10);
  console.log("\n--- dialogs ---");
  for (const dialog of dialogs) {
    console.log(`- ${dialog.title}`);
  }
  console.log("---------------\n");
}

async function main() {
  console.log("telegram cli - meow!");

  await ensureLoggedIn();

  let running = true;
  while (running) {
    const cmd = await askCommand();
    switch (cmd.toLowerCase()) {
      case "send":
        await handleSend();
        break;
      case "read":
        await handleRead();
        break;
      case "dialogs":
        await handleDialogs();
        break;
      case "quit":
      case "exit":
      case "q":
        running = false;
        break;
      default:
        console.log("unknown command. try: send, read, dialogs, quit");
    }
  }

  await disconnect();
  console.log("bye!");
}

main().catch(console.error);
