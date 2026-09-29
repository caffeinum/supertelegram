# supertelegram daemon — design

status: **design only, not built.** waiting on a go from aleks.

## why

today every command connects to telegram, does one thing, and disconnects. that costs
2–3s per call (a read by id measured 2.3s in 0.7.0, most of it connect + dialog scan),
and teardown is where the gramjs `TIMEOUT` bug class lives (fixed in 0.6.1 by guarding
the exit code, not by removing the cause). agents poll `unread` because there is no way to
be told about a new message.

a daemon holds the session(s) connected and synced:
- **instant commands**: no per-call connect, a warm entity/dialog cache. target: warm p50 < 300ms.
- **no teardown per call**, so no teardown `TIMEOUT`s.
- **push, not poll**: `telegram watch` streams new messages as they arrive.
- **one shared session** for every agent and script on the machine.
- later, **the base a native ui attaches to** over the same socket.

## fixed decisions (aleks)

1. on demand: the first command starts it, and it exits after an idle timeout. no launchd.
2. one daemon for all accounts. `-a <name>` routes inside it.
3. gramjs, not TDLib.
4. local socket only, owner-only (0600). no MCP, no network listener.
5. sending works exactly as today. no draft mode.

## decisions i made (argue with these)

| decision | choice | why |
|---|---|---|
| wire format | the CLI sends **argv + cwd**; the daemon runs the same dispatch and streams back stdout, stderr and the exit code | the daemon path is byte-identical to the in-process path by construction, so scripts need zero changes |
| versions | **one socket per package version** (`daemon-0.8.0.sock`) | two CLI versions (global vs `bunx @x`) never ping-pong restart each other; the old one idles out |
| idle timeout | **10 min** | an agent polling every 60s keeps it warm; a one-off human command doesn't leave a process behind for long |
| gap recovery | the daemon does its own `updates.getDifference` | gramjs `catchUp()` is an empty `// TODO` (node_modules/telegram/client/updates.js:65), so missed updates are lost on reconnect |
| retry after a crash | reads retry in-process once; **sends never retry** | a retried send is a possible double message to a real person |

## command surface

```
telegram daemon start [--idle 10m|0] [--foreground]   # start if not running (0 = never idle out)
telegram daemon stop                                  # graceful: finish in-flight, close watches, exit
telegram daemon status [--json]                       # pid, version, uptime, idle-in, accounts, clients, watches
telegram watch [chat...] [-a name] [--json] [--outgoing]
```

`watch` prints one line per new message, in the same format as `read`, prefixed with the chat:
`[2026-09-24T20:05:34Z] Covers! [-5078309102] #2742342 Aleks Bykhun (@caffeinum): …`.
`--json` gives NDJSON: `{account, chat:{id,title,type}, message:{…same fields as read --json}}`.
with no chat it watches everything on that account. v1 covers new messages only; edits and
deletes can be added later as `--events`.

`watch` works without the daemon too: it holds an in-process connection, the same way a
command does today. with the daemon, many watchers share one connection.

### routing

in `run.ts`, after argv is parsed and before a command runs:

1. **routable commands**: `list/dialogs/search, read, info, send, send-file, reply, download, unread, whoami, watch`.
   **in-process only**: `login` (needs the TTY for code and password prompts), `config`, `accounts`,
   `switch`, `logout` (file-only), `daemon *`, `--help`, `--version`.
2. **never route** when `TELEGRAM_DAEMON=0`, or when env changes identity:
   `TELEGRAM_SESSION`, `TELEGRAM_APP_ID/HASH`, `SUPERTELEGRAM_HOME` differing from the daemon's. the daemon
   only serves the registry accounts under its own config dir.
3. connect to `daemon-<version>.sock`. **refused or missing** → spawn the daemon detached
   (`process.execPath` + this package's `run.ts daemon run`, logs to `~/.supertelegram/daemon.log`),
   wait up to 3s for the socket, then route.
4. **spawn fails or times out** → run in-process, which is today's behaviour, byte for byte.
   nothing is printed, because a warning on stderr could break a script that treats stderr as failure.
   `daemon status` shows why the last spawn failed.

`login` and `logout` finish by sending `reload <account>`, so the daemon drops its cached client.
the daemon also checks the session file's mtime on each request, which covers edits made
outside the CLI.

## socket, protocol, permissions

- **path**: `$SUPERTELEGRAM_HOME/run/daemon-<version>.sock` (default home `~/.supertelegram`). `run/`
  is created 0700 and the socket chmodded 0600. the path stays well under macOS's 104-byte
  `sun_path` limit.
- **auth**: filesystem permissions only. threat model: any process running as the same uid can already
  read `accounts/*.txt` and act as the user, so the socket grants nothing new. there is no token.
  no network listener exists to leak.
- **protocol**: newline-delimited JSON, one request per connection.
  ```
  → {"v":1,"hello":{"cli":"0.8.0"},"argv":["read","-5078309102","-n","5"],"cwd":"/Users/aleks"}
  ← {"t":"out","d":"[2026-…] #2742342 …\n"}   (0..n)
  ← {"t":"err","d":"…"}                        (0..n)
  ← {"t":"exit","code":0}                      (exactly one, last)
  ```
  control requests use the same socket: `{"v":1,"ctl":"status"|"stop"|"reload","account":"…"}`.
  a `v` mismatch gets `{"t":"exit","code":70,"proto":2}`, and the CLI falls back to in-process.
- **paths**: the daemon resolves every file argument (send-file, download) against the request's `cwd`.
  it runs as the same user, so file access is identical.
- **single instance per version**: `run/daemon-<version>.lock`, created with `O_EXCL` and holding the pid.
  on startup:
  - lock exists and its pid is alive → exit 0, since another daemon won the race
  - pid is dead → remove the lock and retry
  - once holding the lock: if the socket file exists, probe-connect → refused means stale → unlink → listen

  N CLIs racing a cold start all spawn, one wins, the rest exit, and every CLI connects to the winner.

## idle timeout

- default 10 min. set it with `telegram config set daemonIdle 30m`, `TELEGRAM_DAEMON_IDLE`, or `daemon start --idle`. `0` never idles out.
- **activity** = a request in flight, or **an open `watch` stream**. a watcher keeps the daemon alive
  until it disconnects. the idle clock starts when the last request or watcher ends.
- **per account**: an account with no request and no watcher for the idle period gets disconnected,
  but the daemon stays up for the others.
- on idle: stop accepting connections, disconnect all clients, remove the socket and lock, exit 0.

## multi-account

- **lazy**: an account's client connects on its first request (`-a name`, or the registry's current account,
  which is re-read from `accounts.json` on every request so `switch` takes effect immediately). it stays
  connected until that account goes idle.
- **isolation**: each account has its own `TelegramClient`, dialog cache and update state. a broken session
  (`AUTH_KEY_UNREGISTERED`, revoked, or a corrupt file) fails **only that account's requests**, with the same
  error as today: `account "x" is not logged in. run: telegram login x`. the client is dropped, so the next
  request retries cleanly. other accounts keep working.
- **dialog cache**: filled on first use. it is marked stale on any new-message update for that account,
  and refetched lazily. no TTL is needed, because updates tell us when the order changed.
- a session opened by the daemon and by an in-process CLI at the same time is fine: each connection gets
  its own MTProto session id under the same auth key.

## watch and missed updates

gramjs has no catch-up. the daemon records `updates.getState` (pts/qts/date) per account.
after every reconnect (`UpdateConnectionState` → connected) it calls `updates.getDifference` and
emits the recovered messages to watchers before the live ones.
- **private chats and basic groups**: covered by the common pts.
- **channels and supergroups**: each has its own pts. v1 does a cheaper fallback: after a reconnect it
  compares each dialog's top message id with the last one seen, and fetches the gap with
  `getMessages(minId)`. real `channels.getChannelDifference` per watched channel is v2.
- if the watcher's own socket to the daemon drops (for example the daemon restarted), the watch client
  reconnects and passes `since` (last message id per chat), so the daemon backfills from history.
  anything it can't backfill is reported on stderr as a gap with the time range. it never fails silently.

## failure modes

| failure | what the CLI does |
|---|---|
| daemon dies mid-request (socket closes before `exit`) | **read-only commands**: rerun in-process once, same output. **send/send-file/reply**: exit 1 with `daemon died mid-send; the message may or may not have been sent. check: telegram read <chat> -n 3`. never retry automatically |
| stale socket (file exists, nothing listening) | connect is refused → the daemon it spawns unlinks the file and binds |
| stale lock (pid dead) | removed on the next spawn |
| hung daemon (connects, but no first byte within 5s) | fall back in-process for this call. `daemon status` reports `unresponsive`. `daemon stop` kills the pid from the lock (SIGTERM, then SIGKILL after 5s) |
| CLI and daemon versions differ | can't happen, because the socket name includes the version. two versions just means two daemons, and the unused one idles out |
| protocol mismatch (same version, future `v`) | exit code 70 → in-process fallback |
| telegram connection drops | gramjs auto-reconnects. requests wait up to their normal timeout. watchers get the recovered gap (see above) |
| flood wait | the same as in-process: gramjs sleeps under its threshold. the daemon doesn't hide it; the request just takes longer |

## compatibility: zero changes for existing callers

- same argv, same stdout bytes, same stderr, same exit codes (0/1/2/3/4), and `unread` stays JSON. this is
  guaranteed structurally, because the daemon runs the same dispatch with stdout/stderr redirected into the frame stream.
- the one refactor it needs: commands currently call `console.log` and `disconnect()` directly. they get a
  small `Ctx { out, err, client(account) }`. in-process, `out` is stdout and `disconnect` runs at the end.
  in the daemon, `out` is the frame and the client is shared and never disconnected per request.
  exit codes stay where they are: commands throw `CliError`, and only `run.ts` calls `process.exit`
  (checked: there's none inside `src/cli/chat.ts` or `commands.ts`). the daemon maps a throw to the `exit` frame the same way.
- `TELEGRAM_DAEMON=0` is the escape hatch. `skills/polling` needs no changes, and can move from polling to `watch` later.

## test plan

1. **equivalence (the gate)**: run `evals/replay.ts` in three modes (`TELEGRAM_DAEMON=0`, cold daemon auto-start,
   warm daemon) and diff stdout, stderr and exit codes per case. they must be identical, with timings excluded.
   **negative control**: inject a one-byte difference into the daemon's out path, and the diff must fail.
2. **races**: start 8 CLIs at once against a cold daemon → exactly 1 daemon pid, all 8 succeed.
3. **stale state**: leave a socket file with no listener, and a lock file with a dead pid → the next command succeeds and both are replaced.
4. **crash**: `kill -9` the daemon during `read` → the CLI exits 0 with the correct output (in-process rerun).
   during `send me …` → exit 1 with the "may or may not" message, and the count of messages in `me` rises by at most one.
5. **idle**: `--idle 5s` → exits about 5s after the last request. an open `watch` → still alive at 30s. after it closes → exits within 5s.
6. **multi-account**: in an isolated `SUPERTELEGRAM_HOME` holding **copies** of the real sessions, corrupt one copy
   → its requests fail with the login hint, and the other account keeps working in the same daemon pid.
7. **watch**: `send me x` in-process → `watch -a default me` prints it within 2s. drop the network for 30s
   (in the test, force-close the client's connection), send during the gap → the message appears after reconnect, marked as recovered.
8. **versions**: two package versions side by side → two sockets, each reports its own version, and neither restarts the other.
9. **latency**: record p50/p95 for read-by-id, list and send, cold and warm. success = warm p50 < 300ms (in-process today: ~2.3s).

tests 2–8 need `SUPERTELEGRAM_HOME` (config dir override), which doesn't exist yet. it's a small addition, and useful on its own.

## size

| piece | ~lines |
|---|---|
| `Ctx` refactor of commands (output sink + client provider, `disconnect` moved out of commands) | 150 |
| `SUPERTELEGRAM_HOME` override | 20 |
| daemon server: socket, lock, idle, account pool, reload, status | 300 |
| client router: detect, spawn, frame I/O, fallback, crash semantics | 150 |
| `watch` + gap recovery (getDifference + channel top-message fallback) | 200 |
| tests + eval modes | 300 |
| **total** | **~1100** |

about 2–3 days of agent work, eval included. it ships as the next minor behind nothing: routing is on by default,
because the fallback is today's behaviour. if the equivalence gate fails in any mode, it doesn't ship.

## not doing

- launchd/systemd, auto-start at login (decision 1)
- a network listener, MCP, HTTP, websocket to the daemon (decision 4)
- TDLib (decision 3)
- a draft or confirm step for sends (decision 5)
- windows named pipes. on windows the router always falls back to in-process
