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

### messages

```bash
# send a message — chat can be @username, a numeric id, or a name
telegram send @username "hello there"
telegram send 7069934904 "hey"      # by id (for chats with no username)
telegram send "Ben YC" "hello"      # by name (partial, case-insensitive)
telegram send "me" "note to self"   # use "me" for saved messages

# read messages (shows [photo], [video], [file] indicators)
telegram read @username 10

# reply to latest message
telegram reply "John" "hey back!"

# get unread messages (json output with media info)
telegram unread 20

# list dialogs (shows @username and [id: ...] for each chat)
telegram dialogs 10
```

### media (images/videos/files)

```bash
# send a file with optional caption
telegram send-file @username photo.jpg
telegram send-file "me" video.mp4 "check this out!"

# download media from a message
# (use 'read' command to get message IDs)
telegram download @username 12345 ./downloaded.jpg
telegram download "me" 12346  # auto-named file
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
