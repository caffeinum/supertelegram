import { send, read, dialogs, unread, reply } from "./commands";
import { setVerbose } from "../client/telegram";

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes("--verbose") || rawArgs.includes("-v");
const args = rawArgs.filter((a) => a !== "--verbose" && a !== "-v");
const [command, ...rest] = args;

if (verbose) {
  setVerbose(true);
}

async function main() {
  switch (command) {
    case "send":
      if (rest.length < 2) {
        console.error("usage: bun run cli send <username> <message> [-v]");
        process.exit(1);
      }
      await send(rest[0], rest.slice(1).join(" "));
      break;

    case "read":
      if (rest.length < 1) {
        console.error("usage: bun run cli read <username> [limit] [-v]");
        process.exit(1);
      }
      await read(rest[0], rest[1] ? Number.parseInt(rest[1]) : 10);
      break;

    case "dialogs":
      await dialogs(rest[0] ? Number.parseInt(rest[0]) : 10);
      break;

    case "unread":
      await unread(rest[0] ? Number.parseInt(rest[0]) : 20);
      break;

    case "reply":
      if (rest.length < 2) {
        console.error("usage: bun run cli reply <chat> <message>");
        process.exit(1);
      }
      await reply(rest[0], rest.slice(1).join(" "));
      break;

    default:
      console.log("commands:");
      console.log("  send <username> <message>  - send a message");
      console.log("  read <username> [limit]    - read messages");
      console.log("  dialogs [limit]            - list dialogs");
      console.log("");
      console.log("flags:");
      console.log("  -v, --verbose              - show debug logs");
      process.exit(1);
  }
}

main().catch(console.error);
