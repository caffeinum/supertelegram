#!/usr/bin/env bun
import { isKeepAlive, isTearingDown } from "../client/lifecycle";

const argv = process.argv.slice(2);

// the cli's error reporting lives with gramjs; load it only when there is something to report
function exitWith(err: unknown): void {
  void import("./cli").then(({ report }) => process.exit(report(err)));
}

// gramjs's update loop can reject with TIMEOUT as the connection is torn down,
// AFTER the command already succeeded. once we're tearing down, that rejection
// is noise — swallowing it keeps the exit code honest so callers don't retry
// and double-send. a TIMEOUT before teardown (e.g. a stuck send) still fails.
process.on("unhandledRejection", (err) => {
  if (isTearingDown()) return;
  // a long-lived session (tui/shell) survives network hiccups: gramjs reconnects on its own
  if (isKeepAlive()) return;
  exitWith(err);
});

// bare `telegram` in a terminal opens the full-screen ui — straight away, without loading the cli or gramjs first.
// piped or scripted it prints help as before
if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
  const { runTui } = await import("../tui/index");
  try {
    await runTui();
  } catch (err) {
    const { report } = await import("./cli");
    process.exit(report(err));
  }
  process.exit(0);
}

const { execute } = await import("./cli");
const code = await execute(argv);
const { shutdown } = await import("../client/telegram");
await shutdown();
// exit explicitly: a gramjs ping still in flight can hold the event loop open after disconnect
process.exit(code);
