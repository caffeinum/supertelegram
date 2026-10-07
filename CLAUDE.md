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
- scrolling: opentui frame callbacks run before layout; anything reading positions (scrolloff, prepend anchoring, half-page) runs as a post-process fn (`useCursorScroll` in views.tsx).
- account switching: effects that call telegram wait for an in-flight switch (`switching` in app.tsx), so a warmed account shown early can't send as the old one.
- opentui's renderer sets `global.window = {}`; gramjs decides browser-vs-node once when `telegram/platform` first loads. `src/tui/index.tsx` imports `telegram/platform` first — never move it (0.13.0 shipped offline). tests/platform.test.ts guards it.
- live smoke checks must prove connectivity (a live message arriving), not just that chats are on screen — the cached list draws even when offline.
- live updates get lost sometimes (gramjs catchUp is a no-op; 3/8 probes on startup): the app resyncs list + open chat every 30s and on terminal focus.
- the tui sends console output to `~/.supertelegram/tui.log` (opentui's console overlay is off).
- startup: bare `telegram` (tty) imports only the tui — no cli, no gramjs — and draws from `~/.supertelegram/cache/<account>.json`; `LazySource` loads gramjs + connects behind the first frame (~0.45–0.5s to a full frame vs ~0.95s). keep gramjs imports out of the tui's first-frame modules; `src/client/lifecycle.ts` holds the flags run.ts needs without gramjs.
- folders: `GetDialogFilters` peers can be InputPeerChat, which gramjs's getPeerId rejects — use `inputPeerId`. folder-only chats come from `GetPeerDialogs`, which is rate-limited (back-to-back batches drew a ~10s flood wait): loaded in the background, spaced 2s. gramjs's Dialog constructor crashes on a chat with no top message.
- images: test with tests/fixtures/gradient.png — a hand-made 1×1 png decoded to nothing and image tests passed without drawing. assert pixels (`drawsPixels`).
- kitty graphics drew blank in aleks's cmux; blocks is the default image protocol.
- test files import `telegram/platform` first (renderers set global.window; gramjs loaded after them takes the browser path).
- transcription: messages.TranscribeAudio answers pending first; poll until done (src/client/transcribe.ts). premium only (caffeinum has it, default doesn't). never print transcripts while testing — they're aleks's private messages.
- forums: a conversation is chat or chat#topic (`convId`); drafts, history cache and sends key on it. topic of a message = replyTo.forumTopic → replyToTopId ?? replyToMsgId; none = General (1). sending into a topic = replyTo the topic root (+ topMsgId when replying inside it). topics page 100 at a time (aleks's "ai" forum has ~147).
- never send test messages into the "ai" forum — aleks's agents live there.
- downloads must keep the file extension (`defaultFileName`), or `open` hands a jpeg to TextEdit.
- opentui's parser mangles esc + multi-byte utf-8 (option+letter on a non-latin layout with option-as-alt): an empty key "\x1b\uFFFD" then a fake alt+ctrl-key from the second byte (option+і → alt+v). handleKey swallows the pair and shows a hint; aleks's ghostty config has macos-option-as-alt = true.
- real terminals send DEL (0x7f) for backspace; the opentui mock sends \b. classify keys by name before treating a byte as text.
- colors: only `C.fg`/`C.bg` (terminal defaults) and palette indexes — opentui's implicit text color is white rgb, invisible on light themes (aleks runs a light cmux theme). the theme-safe test fails on any rgb color or inverse video.
- small screens: a fixed-height box whose text wraps draws over the row above (the input hint rendered as "enter-to-write" over the rule). fit() single-line text to cols; multi-row boxes compute wrapped rows (Prompt uses wrapMode="char" so the count is exact). the header sheds hints, then the brand, when narrow. tests in "small terminal".
