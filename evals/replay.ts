#!/usr/bin/env bun
// replays real invocations people/agents tried. every case must either work or
// fail with an error that names the fix (a runnable `telegram ...` suggestion).
// usage: ST_CMD="bun run src/cli/run.ts" bun evals/replay.ts [cases.json]
import { readFileSync } from "node:fs";

type Expect = "work" | "fix" | "help";
interface Case { args: string[]; expect: Expect; contains?: string; rows?: number; why: string }

const cmd = (process.env.ST_CMD ?? "bun run src/cli/run.ts").split(" ");
const file = process.argv[2] ?? new URL("./transcripts/2026-09-23-covers.json", import.meta.url).pathname;
const cases: Case[] = JSON.parse(readFileSync(file, "utf-8"));
const control = JSON.parse(readFileSync(file.replace(/\.json$/, ".control.json"), "utf-8")) as Case;

function run(args: string[]) {
  const p = Bun.spawnSync([...cmd, ...args], { stdout: "pipe", stderr: "pipe", timeout: 60_000 });
  const out = (p.stdout.toString() + p.stderr.toString()).replace(/\x1b\[[0-9;]*m/g, "");
  return { code: p.exitCode, out };
}

const CONN = /Not connected|ECONNREFUSED|ETIMEDOUT|connection (closed|failed)|network/i;
const GLOBAL_HELP = /^telegram - telegram cli/m;

function judge(c: Case, r: { code: number | null; out: string }): ["PASS" | "WALL" | "UNVERIFIED", string] {
  if (CONN.test(r.out)) return ["UNVERIFIED", "network/connection failure — subject not exercised"];
  if (c.expect === "help") {
    if (GLOBAL_HELP.test(r.out)) return ["WALL", "asked for command help, got global help"];
    return r.out.includes(c.contains ?? "") ? ["PASS", "command help"] : ["WALL", `help missing "${c.contains}"`];
  }
  if (c.expect === "work") {
    if (r.code !== 0) return ["WALL", `exit ${r.code}: ${r.out.trim().split("\n")[0]}`];
    if (/^usage:/m.test(r.out) || GLOBAL_HELP.test(r.out)) return ["WALL", "printed usage/help instead of doing it"];
    if (c.contains && !r.out.includes(c.contains)) return ["WALL", `output missing "${c.contains}"`];
    const rows = r.out.split("\n").filter((l) => /^(- |\[\d{4}-)/.test(l)).length;
    if (c.rows !== undefined && rows !== c.rows) return ["WALL", `expected ${c.rows} rows, got ${rows}`];
    return ["PASS", "worked"];
  }
  // expect "fix": a clear failure that tells you what to run next
  if (r.code === 0) return ["WALL", "exited 0 — failure was silent"];
  if (!/telegram [a-z-]+/.test(r.out.replace(/^usage: telegram.*$/m, ""))) return ["WALL", `error names no fix: ${r.out.trim().split("\n")[0]}`];
  if (c.contains && !r.out.includes(c.contains)) return ["WALL", `fix missing "${c.contains}"`];
  return ["PASS", "error names the fix"];
}

function alive(label: string) {
  const r = run(control.args);
  if (r.code !== 0 || !r.out.includes(control.contains ?? "")) {
    console.log(`UNVERIFIED — positive control failed ${label}: ${control.args.join(" ")} → ${r.out.trim().split("\n")[0]}`);
    process.exit(2);
  }
}

alive("before");
let walls = 0, unverified = 0;
for (const c of cases) {
  const [verdict, reason] = judge(c, run(c.args));
  if (verdict === "WALL") walls++;
  if (verdict === "UNVERIFIED") unverified++;
  console.log(`${verdict.padEnd(10)} telegram ${c.args.join(" ")}\n           ${reason}  (${c.why})`);
}
alive("after");
console.log(`\n${cases.length} cases · ${walls} walls · ${unverified} unverified`);
process.exit(walls || unverified ? 1 : 0);
