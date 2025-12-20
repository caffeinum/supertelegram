import { send, read, dialogs } from "./commands";

const [command, ...args] = process.argv.slice(2);

async function main() {
  switch (command) {
    case "send":
      if (args.length < 2) {
        console.error("usage: bun run cli send <username> <message>");
        process.exit(1);
      }
      await send(args[0], args.slice(1).join(" "));
      break;

    case "read":
      if (args.length < 1) {
        console.error("usage: bun run cli read <username> [limit]");
        process.exit(1);
      }
      await read(args[0], args[1] ? Number.parseInt(args[1]) : 10);
      break;

    case "dialogs":
      await dialogs(args[0] ? Number.parseInt(args[0]) : 10);
      break;

    default:
      console.log("commands:");
      console.log("  send <username> <message>  - send a message");
      console.log("  read <username> [limit]    - read messages");
      console.log("  dialogs [limit]            - list dialogs");
      process.exit(1);
  }
}

main().catch(console.error);
