# supertelegram

telegram cli (gramjs) for humans and agents. owned by the `supertelegram` paw agent — see the `supertelegram-ownership` skill.

## layout
- `src/cli/run.ts` — entry: no args on a tty → `tui`, else `execute(argv)` then exit.
- `src/tui/` — full-screen app (opentui 0.5.12 + react, pinned exact; lazy-imported so one-shot commands stay fast):
  `state.ts` pure state + action reducer · `keys.ts` command registry (keymap, palette entries and help are all generated from it) ·
  `views.tsx` rendering · `app.tsx` effects (telegram, clipboard, open, draft saves) · `gram-source.ts` real telegram · `fake-source.ts` for tests.
- `src/cli/cli.ts` — command specs (flags, help, examples) + dispatch; `execute(argv)` returns an exit code and never exits.
- `src/cli/repl.ts` — interactive shell: tokenizer, tab completion, history. keep-alive clients, so `disconnect()` is a no-op there.
- `src/cli/args.ts` — strict parser: unknown flags error with did-you-mean; `-123` is a positional (chat ids), `--` ends flags.
- `src/cli/chat.ts` — list/read/info/send/send-file/reply/download/unread + shared message row/line rendering. text by default, `--json` everywhere.
- `src/cli/search.ts` — message search: messages.searchGlobal (cursor = base64url of next_rate + last msg id + input peer incl. access hash) or messages.search within --in.
- `src/cli/commands.ts` — login/accounts/switch/whoami/logout/config.
- `src/client/telegram.ts` — clients per account, `resolveIn` (exact/unique title, never guesses), dialog cache, teardown.
- `src/cli/errors.ts` — `CliError` + exit codes (1 runtime, 2 usage, 3 not found, 4 ambiguous).

## eval (the success metric)
`bun evals/replay.ts` replays real transcripts in `evals/transcripts/`: every case must work or fail with an error naming the fix. needs live logged-in accounts (`default`, `caffeinum`). negative control: `ST_CMD="bunx supertelegram@0.6.1" bun evals/replay.ts` must show walls.

## tests
`bun test tests/` — headless tui tests (opentui testRender + FakeSource): frames, key flows, drafts, paste, shortcut↔palette parity. ci runs them before publishing.
in tests, react commits outside act(): sleep a tick after keys and poll frames in real time (`until`), never assert on the frame right after a key.
a lone esc arrives ~25ms late; esc immediately followed by a key arrives as alt+key (handled as esc-then-key in typing modes).

## release
bump `version` in package.json, push main. `.github/workflows/publish.yml` publishes via npm OIDC (no token) and tags `vX.Y.Z`.

## repl testing
drive it through a real tty with `expect`. send keystrokes separately with a pause (`send "rea"; sleep 0.4; send "\t"`): readline treats a tab in the same chunk as other chars as pasted text and inserts it literally.

## gotchas
- eval: a check that greps output for error words must only look at failed runs — search results contain arbitrary text ("network clause" once made a passing case read as a connection failure).
- zsh `echo "$json"` expands `\n` escapes; pipe json to files instead.
- the eval must pin accounts with `-a`: aleks switches the active account, and unpinned cases then silently test something else.
- gramjs's update loop rejects with TIMEOUT during disconnect — `isTearingDown()` keeps that from flipping the exit code.
- every command must `disconnect()` on every path or the process hangs.
- never test-send to real people: use `me`.
- in saved messages telegram sets `out=false` on your own messages; compare the sender with your id.
- expect harnesses must not hardcode the active account in prompts (aleks switches it).
- real terminals send DEL (0x7f) for backspace; the opentui mock sends \b. classify keys by name before treating a byte as text.
- colors: only `C.fg`/`C.bg` (terminal defaults) and palette indexes — opentui's implicit text color is white rgb, invisible on light themes (aleks runs a light cmux theme). the theme-safe test fails on any rgb color or inverse video.
