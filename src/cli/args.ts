import { usageError } from "./errors";

export interface FlagSpec {
  name: string;
  short?: string;
  value?: string; // placeholder when the flag takes a value, e.g. "n"
  desc: string;
}

export interface Parsed {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | true>;
}

const NEGATIVE_NUMBER = /^-\d+$/;

function isFlag(token: string): boolean {
  return token.startsWith("-") && token !== "-" && !NEGATIVE_NUMBER.test(token) && !/\s/.test(token);
}

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

export function closest(input: string, options: string[]): string | undefined {
  const scored = options.map((o) => [o, distance(input, o)] as const).sort((x, y) => x[1] - y[1]);
  const best = scored[0];
  return best && best[1] <= Math.max(2, Math.floor(input.length / 3)) ? best[0] : undefined;
}

function flagHint(spec: FlagSpec): string {
  return spec.short ? `--${spec.name} (-${spec.short})` : `--${spec.name}`;
}

// the command is the first bare token that isn't the value of a global flag
export function findCommand(tokens: string[], globals: FlagSpec[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--") return -1;
    if (!isFlag(t)) return NEGATIVE_NUMBER.test(t) ? -1 : i;
    const name = t.replace(/^-+/, "").split("=")[0]!;
    const spec = globals.find((g) => g.name === name || g.short === name);
    if (spec?.value && !t.includes("=")) i++;
  }
  return -1;
}

export function parse(tokens: string[], flags: FlagSpec[], commandLabel: string): Omit<Parsed, "command"> {
  const positionals: string[] = [];
  const out: Record<string, string | true> = {};

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--") {
      positionals.push(...tokens.slice(i + 1));
      break;
    }
    if (!isFlag(t)) {
      positionals.push(t);
      continue;
    }

    const long = t.startsWith("--");
    const [rawName, inline] = t.replace(/^-+/, "").split(/=(.*)/s, 2) as [string, string | undefined];
    const spec = flags.find((f) => (long ? f.name === rawName : f.short === rawName));

    if (!spec) {
      const shortMatch = long && flags.find((f) => f.short === rawName);
      const guess = shortMatch || flags.find((f) => f.name === closest(rawName, flags.map((x) => x.name)));
      throw usageError(
        `unknown flag ${t.split("=")[0]} for '${commandLabel}'.` +
          (guess ? ` did you mean ${flagHint(guess)}?` : "") +
          `\nrun: telegram ${commandLabel} --help  (a message starting with "-" goes after --)`
      );
    }

    if (!spec.value) {
      if (inline !== undefined) throw usageError(`flag --${spec.name} takes no value. run: telegram ${commandLabel} --help`);
      out[spec.name] = true;
      continue;
    }

    const value = inline ?? tokens[++i];
    if (value === undefined) throw usageError(`flag --${spec.name} needs a <${spec.value}>. run: telegram ${commandLabel} --help`);
    out[spec.name] = value;
  }

  return { positionals, flags: out };
}

export function intFlag(raw: string | true | undefined, name: string, fallback: number, commandLabel: string, min = 0): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (raw === true || !Number.isInteger(n) || n < min) {
    throw usageError(`--${name} must be an integer >= ${min}, got "${raw}". run: telegram ${commandLabel} --help`);
  }
  return n;
}
