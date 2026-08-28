#!/usr/bin/env bun
import { explainConnectionError } from "../client/wss";
import { send, read, dialogs, unread, reply, login, config, sendFile, downloadMedia, accounts, switchAccount, logout, whoami } from "./commands";
import { setVerbose, setSessionPath } from "../client/telegram";
import { migrateLegacyIfNeeded, accountSessionPath } from "../config/accounts";
import pkg from "../../package.json";

const VERSION = pkg.version;
const NAME = "telegram";

const HELP = `
${NAME} - telegram cli for humans and bots

usage:
  ${NAME} <command> [options]

commands:
  send <chat> <message>      send a message (chat = @username, id, or name)
  send-file <chat> <path>    send a file/image/video (optional: caption)
  read <chat> [limit]        read messages from a chat (default: 10)
  download <chat> <id> [out] download media from message id
  reply <chat> <message>     reply to a chat by name (partial match)
  dialogs [limit]            list recent dialogs (default: 10)
  unread [limit]             show unread messages as json (default: 20)
  login [name]               authenticate with telegram (into a named account)
  accounts                   list logged-in accounts (* = current)
  switch <name>              switch the active account
  whoami                     show the active account
  logout [name]              remove an account (default: current)
  config set <key> <val>     set API credentials (appId, appHash) or wss true

options:
  -a, --account <name>     run this command as a specific account
  -v, --verbose            show debug logs
  -h, --help               show this help
  --version                show version

examples:
  ${NAME} send @username "hello there"
  ${NAME} send-file @username photo.jpg "check this out"
  ${NAME} read @username 5
  ${NAME} download @username 12345 ./photo.jpg
  ${NAME} reply "John" "hey!"
  ${NAME} unread
  ${NAME} dialogs 20
  ${NAME} login work            # log into a second account named "work"
  ${NAME} switch work           # make it active
  ${NAME} -a personal unread    # run one command as another account
`.trim();

const rawArgs = process.argv.slice(2);

// handle help/version first
if (rawArgs.includes("-h") || rawArgs.includes("--help") || rawArgs.length === 0) {
  console.log(HELP);
  process.exit(0);
}

if (rawArgs.includes("--version")) {
  console.log(`${NAME} v${VERSION}`);
  process.exit(0);
}

const verbose = rawArgs.includes("--verbose") || rawArgs.includes("-v");

// pull out --account/-a <name> before positional parsing
let accountFlag: string | undefined;
const accIdx = rawArgs.findIndex((a) => a === "--account" || a === "-a");
if (accIdx !== -1) {
  accountFlag = rawArgs[accIdx + 1];
  rawArgs.splice(accIdx, accountFlag ? 2 : 1);
}

const args = rawArgs.filter((a) => !a.startsWith("-"));
const [command, ...rest] = args;

if (verbose) {
  setVerbose(true);
}

// fold a pre-multi-account session.txt into account "default" (one-time, no-op after)
migrateLegacyIfNeeded();

// an explicit --account pins this invocation to that account's session
if (accountFlag) {
  setSessionPath(accountSessionPath(accountFlag));
}

async function main() {
  switch (command) {
    case "send":
      if (rest.length < 2 || !rest[0]) {
        console.error("usage: telegram send <chat> <message>");
        process.exit(1);
      }
      await send(rest[0], rest.slice(1).join(" "));
      break;

    case "read":
      if (rest.length < 1 || !rest[0]) {
        console.error("usage: telegram read <chat> [limit]");
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
      if (rest.length < 2 || !rest[0]) {
        console.error("usage: telegram reply <chat> <message>");
        process.exit(1);
      }
      await reply(rest[0], rest.slice(1).join(" "));
      break;

    case "send-file":
      if (rest.length < 2 || !rest[0] || !rest[1]) {
        console.error("usage: telegram send-file <chat> <path> [caption]");
        process.exit(1);
      }
      await sendFile(rest[0], rest[1], rest.slice(2).join(" ") || undefined);
      break;

    case "download":
      if (rest.length < 2 || !rest[0] || !rest[1]) {
        console.error("usage: telegram download <chat> <message-id> [output-path]");
        process.exit(1);
      }
      await downloadMedia(rest[0], Number.parseInt(rest[1]), rest[2]);
      break;

    case "login":
      await login(rest[0]);
      break;

    case "accounts":
      await accounts();
      break;

    case "switch":
      await switchAccount(rest[0]);
      break;

    case "whoami":
      await whoami();
      break;

    case "logout":
      await logout(rest[0]);
      break;

    case "config":
      await config(rest[0], rest[1], rest[2]);
      break;

    case "help":
      console.log(HELP);
      break;

    default:
      console.error(`unknown command: ${command}`);
      console.error(`run '${NAME} --help' for usage`);
      process.exit(1);
  }
}

function die(err: unknown) {
  console.error("error:", explainConnectionError(err).message);
  process.exit(1);
}

process.on("unhandledRejection", die);
main().catch(die);
