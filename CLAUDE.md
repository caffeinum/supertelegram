# supertelegram

telegram cli (gramjs) for humans and agents. owned by the `supertelegram` paw agent — see the `supertelegram-ownership` skill.

## layout
- `src/cli/run.ts` — command specs (flags, help, examples) + dispatch. per-command `--help` is generated from the spec.
- `src/cli/args.ts` — strict parser: unknown flags error with did-you-mean; `-123` is a positional (chat ids), `--` ends flags.
- `src/cli/chat.ts` — list/read/info/send/send-file/reply/download/unread. text by default, `--json` everywhere.
- `src/cli/commands.ts` — login/accounts/switch/whoami/logout/config.
- `src/client/telegram.ts` — clients per account, `resolveIn` (exact/unique title, never guesses), dialog cache, teardown.
- `src/cli/errors.ts` — `CliError` + exit codes (1 runtime, 2 usage, 3 not found, 4 ambiguous).

## eval (the success metric)
`bun evals/replay.ts` replays real transcripts in `evals/transcripts/`: every case must work or fail with an error naming the fix. needs live logged-in accounts (`default`, `caffeinum`). negative control: `ST_CMD="bunx supertelegram@0.6.1" bun evals/replay.ts` must show walls.

## release
bump `version` in package.json, push main. `.github/workflows/publish.yml` publishes via npm OIDC (no token) and tags `vX.Y.Z`.

## gotchas
- gramjs's update loop rejects with TIMEOUT during disconnect — `isTearingDown()` keeps that from flipping the exit code.
- every command must `disconnect()` on every path or the process hangs.
- never test-send to real people: use `me`.
