import { createInterface, type Interface } from "node:readline";
import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { execute, COMMANDS, GLOBAL_FLAGS, findSpec } from "./cli";
import { fetchDialogs, getClient, getClientFor, resetClients, setKeepAlive, setSessionPath, shutdown } from "../client/telegram";
import { accountSessionPath, getCurrentAccount, listAccounts } from "../config/accounts";
import pkg from "../../package.json";

const HISTORY_FILE = join(homedir(), ".supertelegram", "repl_history");
const HISTORY_SIZE = 1000;
const BUILTINS = ["exit", "quit", "help"];
// commands whose first positional is a chat
const CHAT_COMMANDS = new Set(["read", "info", "members", "send", "send-file", "reply", "download"]);
// commands that change which session a path means: drop warm connections after them
const SESSION_CHANGING = new Set(["login", "logout", "switch"]);

interface Tokens {
  all: string[];
  // complete tokens before the one under the cursor
  tokens: string[];
  // the token under the cursor, as typed (raw) and as parsed (value); raw is "" after a space
  raw: string;
  value: string;
  quote: '"' | "'" | undefined;
}

// shell-ish splitting: whitespace separates, '...' is literal, "..." and bare words take \ escapes.
// nothing else is special — `!`, `$`, `*` are plain characters here.
export function tokenize(line: string): Tokens {
  const tokens: string[] = [];
  let value = "";
  let raw = "";
  let inToken = false;
  let quote: '"' | "'" | undefined;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      raw += ch;
      if (ch === quote) quote = undefined;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) {
        raw += line[++i];
        value += line[i];
      } else value += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) tokens.push(value);
      value = "";
      raw = "";
      inToken = false;
      continue;
    }
    inToken = true;
    raw += ch;
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "\\" && i + 1 < line.length) {
      raw += line[++i];
      value += line[i];
    } else value += ch;
  }
  if (inToken) tokens.push(value);
  return { all: tokens, tokens: inToken ? tokens.slice(0, -1) : tokens, raw, value, quote };
}

function escapeBare(s: string): string {
  return s.replace(/([\s"'\\])/g, "\\$1");
}

// how a candidate should be inserted so it re-tokenizes to itself, given how the user started typing
function asTyped(candidate: string, t: Tokens): string {
  if (t.quote === "'") return `'${candidate.replace(/'/g, `'\\''`)}'`;
  if (t.quote === '"') return `"${candidate.replace(/(["\\])/g, "\\$1")}"`;
  return escapeBare(candidate);
}

function loadHistory(): string[] {
  if (!existsSync(HISTORY_FILE)) return [];
  // readline wants newest first
  return readFileSync(HISTORY_FILE, "utf-8").split("\n").filter(Boolean).slice(-HISTORY_SIZE).reverse();
}

function saveHistory(line: string) {
  if (!existsSync(HISTORY_FILE)) writeFileSync(HISTORY_FILE, "", { mode: 0o600 });
  appendFileSync(HISTORY_FILE, `${line}\n`);
  chmodSync(HISTORY_FILE, 0o600);
}

async function chatCandidates(account: string | undefined): Promise<string[]> {
  const c = account ? await getClientFor(accountSessionPath(account)) : await getClient();
  const dialogs = await fetchDialogs(c, 200);
  const out: string[] = [];
  for (const d of dialogs) {
    if (d.title) out.push(d.title);
    const u = d.entity && "username" in d.entity ? d.entity.username : undefined;
    if (u) out.push(`@${u}`);
    if (d.id) out.push(d.id.toString());
  }
  return out;
}

function pathCandidates(prefix: string): string[] {
  const expanded = prefix.startsWith("~/") ? join(homedir(), prefix.slice(2)) : prefix;
  const dir = expanded.endsWith("/") ? expanded : dirname(expanded);
  const base = expanded.endsWith("/") ? "" : basename(expanded);
  const shownDir = prefix.endsWith("/") ? prefix : prefix.slice(0, prefix.length - base.length);
  try {
    return readdirSync(resolve(dir || "."))
      .filter((f) => f.startsWith(base) && (base.startsWith(".") || !f.startsWith(".")))
      .map((f) => {
        const isDir = statSync(join(resolve(dir || "."), f), { throwIfNoEntry: false })?.isDirectory();
        return `${shownDir}${f}${isDir ? "/" : ""}`;
      });
  } catch {
    return [];
  }
}

async function candidatesFor(t: Tokens): Promise<string[]> {
  const words = t.tokens;
  const prev = words[words.length - 1];

  if (prev === "-a" || prev === "--account") return listAccounts().map((a) => a.name);

  // skip leading global flags (and their values) to find the command
  let i = 0;
  while (i < words.length && words[i]!.startsWith("-") && !/^-\d+$/.test(words[i]!)) {
    const flag = GLOBAL_FLAGS.find((f) => words[i] === `--${f.name}` || words[i] === `-${f.short}`);
    i += flag?.value ? 2 : 1;
  }
  const command = words[i];
  if (command === undefined) {
    if (t.value.startsWith("-")) return GLOBAL_FLAGS.flatMap((f) => [`--${f.name}`, ...(f.short ? [`-${f.short}`] : [])]);
    return [...COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]), ...BUILTINS];
  }

  const spec = findSpec(command);
  if (!spec) return command === "help" ? COMMANDS.map((c) => c.name) : [];
  const flags = [...(spec.flags ?? []), ...GLOBAL_FLAGS];

  if (t.value.startsWith("-") && !/^-\d/.test(t.value)) return flags.map((f) => `--${f.name}`);

  // which positional is being typed (flags with values consume the next word)
  const after = words.slice(i + 1);
  let position = 0;
  for (let j = 0; j < after.length; j++) {
    const w = after[j]!;
    const flag = flags.find((f) => w === `--${f.name}` || w === `-${f.short}`);
    if (flag) j += flag.value ? 1 : 0;
    else if (!w.startsWith("-") || /^-\d+$/.test(w)) position++;
  }

  const accIdx = words.findIndex((w) => w === "-a" || w === "--account");
  const account = accIdx === -1 ? undefined : words[accIdx + 1];
  if (position === 0 && CHAT_COMMANDS.has(spec.name)) return [...(await chatCandidates(account)), ...(spec.name === "send" || spec.name === "send-file" ? ["me"] : [])];
  if (spec.name === "send-file" && position === 1) return pathCandidates(t.value);
  if (spec.name === "download" && position === 2) return pathCandidates(t.value);
  if (spec.name === "switch" || spec.name === "logout" || spec.name === "login") return listAccounts().map((a) => a.name);
  return [];
}

function completer(line: string, done: (err: Error | null, result: [string[], string]) => void) {
  const t = tokenize(line);
  candidatesFor(t)
    .then((all) => {
      const want = t.value.toLowerCase();
      const hits = [...new Set(all)].filter((c) => c.toLowerCase().startsWith(want));
      // insert exactly what was typed plus the rest, keeping the user's quoting;
      // a unique hit gets a trailing space so you can keep typing (not for directories)
      const typed = hits.map((h) => asTyped(h, t));
      if (typed.length === 1 && !typed[0]!.endsWith("/")) typed[0] += " ";
      done(null, [typed, t.raw]);
    })
    .catch(() => done(null, [[], t.raw]));
}

function prompt(rl: Interface) {
  rl.setPrompt(`telegram:${getCurrentAccount() ?? "default"}> `);
  rl.prompt();
}

export async function repl(): Promise<void> {
  setKeepAlive(true);
  console.log(`supertelegram v${pkg.version} — type a command without "telegram" (list, read, send, ...). tab completes, ↑ for history, "help", ctrl-d to quit.`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    history: loadHistory(),
    historySize: HISTORY_SIZE,
    removeHistoryDuplicates: true,
    terminal: true,
  });

  // warm the connection and chat list in the background so the first tab is instant
  getClient()
    .then((c) => fetchDialogs(c, 200))
    .catch(() => undefined);

  let running = false;
  rl.on("SIGINT", () => {
    if (running) return;
    if (rl.line) {
      rl.write(null, { ctrl: true, name: "u" });
      process.stdout.write("\n");
      prompt(rl);
    } else {
      process.stdout.write('\n(ctrl-d or "exit" to quit)\n');
      prompt(rl);
    }
  });

  prompt(rl);
  for await (const input of rl) {
    const line = input.trim();
    if (!line) {
      prompt(rl);
      continue;
    }
    saveHistory(line);

    const t = tokenize(line);
    if (t.quote) {
      console.error(`error: unclosed ${t.quote} quote`);
      prompt(rl);
      continue;
    }
    let argv = t.all;
    if (argv[0] === "telegram" || argv[0] === "supertelegram") argv = argv.slice(1);
    if (argv[0] === "exit" || argv[0] === "quit") break;

    running = true;
    rl.pause();
    if (argv[0] === "login") {
      // login prompts for phone/code/password on the tty — run it as its own process
      spawnSync(process.execPath, [process.argv[1]!, ...argv], { stdio: "inherit" });
    } else {
      const code = await execute(argv);
      if (code !== 0) console.error(`(exit ${code})`);
    }
    setSessionPath(undefined);
    if (SESSION_CHANGING.has(argv[0]!)) await resetClients();
    running = false;
    rl.resume();
    prompt(rl);
  }

  rl.close();
  await shutdown();
  process.exit(0);
}
