#!/usr/bin/env bun
import { execute, report } from "./cli";
import { isTearingDown, shutdown } from "../client/telegram";

const argv = process.argv.slice(2);

// gramjs's update loop can reject with TIMEOUT as the connection is torn down,
// AFTER the command already succeeded. once we're tearing down, that rejection
// is noise — swallowing it keeps the exit code honest so callers don't retry
// and double-send. a TIMEOUT before teardown (e.g. a stuck send) still fails.
process.on("unhandledRejection", (err) => {
  if (isTearingDown()) return;
  process.exit(report(err));
});

// bare `telegram` in a terminal opens the repl; piped or scripted it prints help as before
if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
  const { repl } = await import("./repl");
  await repl();
} else {
  const code = await execute(argv);
  await shutdown();
  // exit explicitly: a gramjs ping still in flight can hold the event loop open after disconnect
  process.exit(code);
}
