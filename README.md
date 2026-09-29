# supertelegram

telegram cli for ai to read/write messages using gramjs.

> **warning:** don't use this to send spam or abuse the telegram api. your account can get banned.

## installation

```bash
npm install -g supertelegram
```

## quick start

just run login and follow the prompts:

```bash
telegram login
```

if you don't have API credentials configured, it will:
1. prompt you to get them from https://my.telegram.org/apps
2. ask for your app_id and app_hash
3. save them to `~/.supertelegram/config.json`
4. continue with telegram phone/code login
5. save session to `~/.supertelegram/session.txt`

that's it! now you're ready to use telegram from the cli.

## usage

### interactive shell

run `telegram` (or `bunx supertelegram`) with no arguments in a terminal:

```
$ telegram
supertelegram v0.8.0 — type a command without "telegram" (list, read, send, ...). tab completes, ↑ for history, "help", ctrl-d to quit.
telegram:default> read Cov⇥          → read Covers!
telegram:default> read Covers! -n 5
telegram:default> send me "note"
```

- the same commands and flags as the cli, without the `telegram` prefix (a pasted `telegram ...` works too)
- **tab** completes commands, flags, account names after `-a`, chat titles/@usernames/ids (from the account on that line), and file paths for `send-file` / `download`
- **↑/↓** history, kept in `~/.supertelegram/repl_history` (0600)
- connections stay open between commands, so repeated commands skip the connect
- quoting is `'...'`, `"..."` and `\` escapes; `!`, `$` and `*` are plain characters (no shell history expansion)
- `login` runs as its own process so its prompts work. `exit`, `quit` or ctrl-d to leave

piped or scripted (`telegram < /dev/null`, or from an agent), no arguments still just prints help.

### find a chat

chats are addressed by `@username`, numeric id, or title. ids come from `list`.

```bash
telegram list                     # 100 most recent chats: title, @username, [id], type, unread
telegram list covers              # chats whose title/@username contains "covers" (alias: search)
telegram list -n 20 --offset 20   # page through
telegram info -5078309102         # group details + members (names, @usernames, ids, roles)
telegram info -1001364634660 -q aleks   # search members of a big group
telegram info @username           # a person's profile
```

a title must match exactly one chat — if it matches several you get the list of
ids and exit code 4, never a guess. if the chat isn't in this account, the error
tells you which of your other accounts has it and the exact command to run.

### messages

```bash
telegram read @username           # last 100 messages, newest last, with names and #ids
telegram read -5078309102 -n 20   # by id, 20 messages
telegram read Covers --before 2742267   # page back (the output prints the next command)
telegram read Covers --after 2742267    # page forward

telegram send @username "hello there"
telegram send -5078309102 "hi all"      # by id (groups have negative ids)
telegram send me "note to self"         # saved messages
telegram send me -- "- starts with a dash"

telegram reply "John" "hey back!"       # send + mark the chat read
telegram unread -n 50                   # unread messages as json
```

every command takes `--json` for machine-readable output, and `--help` for its own
flags. positional limits (`read @x 5`, `dialogs 20`) still work.

exit codes: `0` ok · `1` runtime error · `2` usage · `3` chat/message not found · `4` ambiguous chat

### media (images/videos/files)

```bash
telegram send-file @username photo.jpg "check this out!"
telegram download @username 12345 ./downloaded.jpg   # ids are the #numbers from read
telegram download me 12346                           # auto-named, never overwrites
```

### config

manually set API credentials (optional):
```bash
telegram config set appId "12345678"
telegram config set appHash "abc123..."
```

### flags

- `-v, --verbose` - show debug logs
- `--help` - show help
- `--version` - show version

### multiple accounts

log in to as many accounts as you want, each stored under a name, and switch
between them:

```bash
# log into named accounts (prompts phone/code the first time)
telegram login personal
telegram login work

# see them (* marks the active one)
telegram accounts
# * work — @yourworkhandle
#   personal — @yourhandle

# switch the active account (all later commands use it)
telegram switch personal
telegram whoami            # personal — @yourhandle

# or run a single command as another account without switching
telegram -a work send @boss "on it"

# remove an account
telegram logout work
```

sessions live in `~/.supertelegram/accounts/<name>.txt`; the active account is
tracked in `~/.supertelegram/accounts.json`. API credentials (appId/appHash)
are shared across accounts. upgrading from an older version? your existing
login is migrated automatically into an account named `default`.

### advanced

**custom session location (one-off / scripting):**
```bash
TELEGRAM_SESSION=./custom.txt telegram send @friend "hey"
```

**precedence for API credentials:**
1. `TELEGRAM_APP_ID` and `TELEGRAM_APP_HASH` env vars
2. `~/.supertelegram/config.json` (global)
3. `.env` file in current directory (for dev)

**precedence for session file:**
1. `--account <name>` flag
2. `TELEGRAM_SESSION` env var
3. active account (`~/.supertelegram/accounts/<name>.txt`)
4. `./session.txt` (backwards compat)
5. `~/.supertelegram/session.txt` (legacy default)

## websocket transport (blocked mtproto)

some networks (cloud sandboxes, agent runtimes, corporate proxies) let tcp reach
telegram DC ips but kill the raw mtproto handshake — login dies with
`Not connected` on `ReqPqMulti`. switch to the same wss path web telegram uses:

```bash
TELEGRAM_WSS=1 telegram login
# or persist it
telegram config set wss true
```

this talks to `*.web.telegram.org/apiws` over tls 443 with the obfuscated
transport. login, messages and media all work; only the transport changes.
needs bun or node >= 22 (native WebSocket).

## development

clone repo and install:
```bash
git clone https://github.com/caffeinum/supertelegram.git
cd supertelegram
bun install
```

run locally:
```bash
bun run cli <command>
```
