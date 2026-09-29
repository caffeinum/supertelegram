import { explainConnectionError } from "../client/wss";
import { login, config, accounts, switchAccount, logout, whoami } from "./commands";
import { send, sendFile, reply, read, list, info, unread, downloadMedia, type Out } from "./chat";
import { setVerbose, setSessionPath } from "../client/telegram";
import { migrateLegacyIfNeeded, accountSessionPath } from "../config/accounts";
import { parse, findCommand, intFlag, closest, type FlagSpec, type Parsed } from "./args";
import { CliError, usageError } from "./errors";
import pkg from "../../package.json";

const NAME = "telegram";

export const GLOBAL_FLAGS: FlagSpec[] = [
  { name: "account", short: "a", value: "name", desc: "run this command as a specific account" },
  { name: "json", desc: "machine-readable output" },
  { name: "verbose", short: "v", desc: "show debug logs" },
  { name: "help", short: "h", desc: "show help" },
  { name: "version", desc: "show version" },
];

const LIMIT: FlagSpec = { name: "limit", short: "n", value: "n", desc: "how many to show" };
const OFFSET: FlagSpec = { name: "offset", value: "n", desc: "skip this many (pagination)" };

export interface Command {
  name: string;
  aliases?: string[];
  args: string;
  summary: string;
  flags?: FlagSpec[];
  examples: string[];
  min?: number;
  run(p: Parsed, out: Out): Promise<void>;
}

// back-compat: `read @x 5` / `dialogs 20` / `unread 20` still take a positional limit
function limitFrom(p: Parsed, positional: string | undefined, fallback: number, cmd: string): number {
  const named = intFlag(p.flags.limit, "limit", fallback, cmd, 1);
  if (positional === undefined) return named;
  const pos = intFlag(positional, "limit", fallback, cmd, 1);
  if (p.flags.limit !== undefined && pos !== named) throw usageError(`limit given twice (${pos} and --limit ${named}). use one.`);
  return pos;
}

export const COMMANDS: Command[] = [
  {
    name: "list",
    aliases: ["dialogs", "search"],
    args: "[query]",
    summary: "list chats, or find chats whose title/@username contains query",
    flags: [{ ...LIMIT, desc: "how many chats (default 100)" }, OFFSET],
    examples: ["list", "list covers -a work", "list -n 20 --offset 20", "list --json"],
    async run(p, out) {
      const numericLimit = p.command === "dialogs" && p.positionals.length === 1 && /^\d+$/.test(p.positionals[0]!);
      const query = numericLimit ? undefined : p.positionals.join(" ") || undefined;
      const limit = limitFrom(p, numericLimit ? p.positionals[0] : undefined, 100, p.command!);
      await list(query, { ...out, limit, offset: intFlag(p.flags.offset, "offset", 0, p.command!) }, p.command);
    },
  },
  {
    name: "read",
    args: "<chat> [limit]",
    summary: "read messages, newest last (chat = @username, id, or title)",
    flags: [
      { ...LIMIT, desc: "how many messages (default 100)" },
      { name: "before", value: "msg-id", desc: "only messages older than this id (page back)" },
      { name: "after", value: "msg-id", desc: "only messages newer than this id (page forward)" },
    ],
    examples: ["read @username", "read -5078309102 -n 20", "read Covers -a work --before 2742300"],
    min: 1,
    async run(p, out) {
      const before = p.flags.before === undefined ? undefined : intFlag(p.flags.before, "before", 0, "read");
      const after = p.flags.after === undefined ? undefined : intFlag(p.flags.after, "after", 0, "read");
      if (before !== undefined && after !== undefined) throw usageError("use --before or --after, not both");
      await read(p.positionals[0]!, { ...out, limit: limitFrom(p, p.positionals[1], 100, "read"), before, after });
    },
  },
  {
    name: "info",
    aliases: ["members"],
    args: "<chat>",
    summary: "chat details and members (names, @usernames, ids, roles); user profile for a person",
    flags: [
      { ...LIMIT, desc: "how many members (default 100)" },
      OFFSET,
      { name: "query", short: "q", value: "text", desc: "only members whose name matches" },
    ],
    examples: ["info -5078309102", "info @username", "info 'Covers!' -q aleks"],
    min: 1,
    async run(p, out) {
      await info(p.positionals[0]!, {
        ...out,
        limit: intFlag(p.flags.limit, "limit", 100, "info", 1),
        offset: intFlag(p.flags.offset, "offset", 0, "info"),
        query: typeof p.flags.query === "string" ? p.flags.query : undefined,
      });
    },
  },
  {
    name: "send",
    args: "<chat> <message>",
    summary: "send a message (chat must match exactly one chat)",
    examples: ['send @username "hello there"', 'send -5078309102 "hi all"', 'send me -- "- a note starting with a dash"'],
    min: 2,
    run: (p, out) => send(p.positionals[0]!, p.positionals.slice(1).join(" "), out),
  },
  {
    name: "send-file",
    args: "<chat> <path> [caption]",
    summary: "send a file/image/video",
    examples: ['send-file @username photo.jpg "check this out"'],
    min: 2,
    run: (p, out) => sendFile(p.positionals[0]!, p.positionals[1]!, p.positionals.slice(2).join(" ") || undefined, out),
  },
  {
    name: "reply",
    args: "<chat> <message>",
    summary: "send and mark the chat as read",
    examples: ['reply "John" "hey!"'],
    min: 2,
    run: (p, out) => reply(p.positionals[0]!, p.positionals.slice(1).join(" "), out),
  },
  {
    name: "download",
    args: "<chat> <msg-id> [out-path]",
    summary: "download media from a message (ids are the #numbers in read)",
    examples: ["download @username 12345 ./photo.jpg"],
    min: 2,
    run: (p, out) => downloadMedia(p.positionals[0]!, intFlag(p.positionals[1], "msg-id", 0, "download"), p.positionals[2], out),
  },
  {
    name: "unread",
    args: "[limit]",
    summary: "unread messages as json, across the most recent chats",
    flags: [{ ...LIMIT, desc: "how many recent chats to check (default 20)" }],
    examples: ["unread", "unread -n 50"],
    run: (p) => unread(limitFrom(p, p.positionals[0], 20, "unread")),
  },
  {
    name: "login",
    args: "[name]",
    summary: "authenticate with telegram (into a named account)",
    examples: ["login", "login work"],
    run: (p) => login(p.positionals[0]),
  },
  { name: "accounts", args: "", summary: "list logged-in accounts (* = current)", examples: ["accounts"], run: () => accounts() },
  { name: "switch", args: "<name>", summary: "switch the active account", examples: ["switch work"], min: 1, run: (p) => switchAccount(p.positionals[0]) },
  { name: "whoami", args: "", summary: "show the account this command runs as", examples: ["whoami", "whoami -a work"], run: (p) => whoami(p.flags.account as string | undefined) },
  { name: "logout", args: "[name]", summary: "remove an account (default: current)", examples: ["logout work"], run: (p) => logout(p.positionals[0]) },
  {
    name: "config",
    args: "set|get <key> [value]",
    summary: "set API credentials (appId, appHash) or wss true",
    examples: ["config set appId 12345", "config set wss true"],
    run: (p) => config(p.positionals[0], p.positionals[1], p.positionals[2]),
  },
];

export function findSpec(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
}

function flagLine(f: FlagSpec): string {
  const head = `${f.short ? `-${f.short}, ` : "    "}--${f.name}${f.value ? ` <${f.value}>` : ""}`;
  return `  ${head.padEnd(26)} ${f.desc}`;
}

function commandHelp(c: Command): string {
  return [
    `usage: ${NAME} ${c.name} ${c.args}`.trimEnd(),
    "",
    c.summary,
    ...(c.aliases ? [`aliases: ${c.aliases.join(", ")}`] : []),
    "",
    "options:",
    ...[...(c.flags ?? []), ...GLOBAL_FLAGS.filter((f) => f.name !== "version")].map(flagLine),
    "",
    "examples:",
    ...c.examples.map((e) => `  ${NAME} ${e}`),
  ].join("\n");
}

const HELP = [
  `${NAME} - telegram cli for humans and bots`,
  "",
  "usage:",
  `  ${NAME} <command> [options]`,
  "",
  "commands:",
  ...COMMANDS.map((c) => `  ${`${c.name} ${c.args}`.padEnd(28)} ${c.summary}`),
  "",
  "options:",
  ...GLOBAL_FLAGS.map(flagLine),
  "",
  `chats are addressed by @username, numeric id (from '${NAME} list'), or title.`,
  `details for any command: ${NAME} <command> --help`,
  `interactive shell with tab completion: run ${NAME} with no arguments in a terminal`,
  "",
  "examples:",
  `  ${NAME} list covers              # find a chat, get its id`,
  `  ${NAME} read -5078309102 -n 20`,
  `  ${NAME} info -5078309102         # who's in the group`,
  `  ${NAME} send @username "hello there"`,
  `  ${NAME} -a work unread           # run one command as another account`,
].join("\n");

type Job = { spec: Command; parsed: Parsed };

function dispatch(raw: string[]): Job | undefined {
  const at = findCommand(raw, GLOBAL_FLAGS);
  const name = at === -1 ? undefined : raw[at]!;
  const rest = at === -1 ? raw : [...raw.slice(0, at), ...raw.slice(at + 1)];

  if (name === "help") {
    const target = rest.find((t) => !t.startsWith("-"));
    const spec = target ? findSpec(target) : undefined;
    console.log(spec ? commandHelp(spec) : HELP);
    return undefined;
  }

  if (name === undefined) {
    const { flags, positionals } = parse(rest, GLOBAL_FLAGS, "");
    if (flags.version) console.log(`${NAME} v${pkg.version}`);
    else if (positionals.length) throw usageError(`"${positionals[0]}" isn't a command. run: ${NAME} --help`);
    else console.log(HELP);
    return undefined;
  }

  const spec = findSpec(name);
  if (!spec) {
    const guess = closest(name, COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
    throw usageError(`unknown command: ${name}.${guess ? ` did you mean '${guess}'?` : ""} run: ${NAME} --help`);
  }

  const { flags, positionals } = parse(rest, [...(spec.flags ?? []), ...GLOBAL_FLAGS], name);
  if (flags.help) {
    console.log(commandHelp(spec));
    return undefined;
  }
  if (positionals.length < (spec.min ?? 0)) {
    throw usageError(`usage: ${NAME} ${spec.name} ${spec.args}\nrun: ${NAME} ${spec.name} --help`);
  }
  return { spec, parsed: { command: name, flags, positionals } };
}

// prints the error the way the cli always has and returns the exit code
export function report(err: unknown): number {
  if (err instanceof CliError) {
    console.error(err.message.startsWith("usage:") ? err.message : `error: ${err.message}`);
    return err.code;
  }
  console.error("error:", explainConnectionError(err).message);
  return 1;
}

// runs one command line; never exits the process
export async function execute(raw: string[]): Promise<number> {
  try {
    const job = dispatch(raw);
    if (!job) return 0;
    const { spec, parsed } = job;

    setVerbose(parsed.flags.verbose === true);

    // fold a pre-multi-account session.txt into account "default" (one-time, no-op after)
    migrateLegacyIfNeeded();

    const account = parsed.flags.account;
    if (account === true) throw usageError(`--account needs a name. run: ${NAME} accounts`);
    setSessionPath(account ? accountSessionPath(account) : undefined, account || undefined);

    await spec.run(parsed, { json: parsed.flags.json === true, accountFlag: account || undefined });
    return 0;
  } catch (err) {
    return report(err);
  }
}
