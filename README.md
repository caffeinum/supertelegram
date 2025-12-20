# supertelegram

telegram cli for ai to read/write messages using gramjs.

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
# send a message
telegram send @username "hello there"
telegram send "me" "note to self"  # use "me" for saved messages

# read messages (shows [photo], [video], [file] indicators)
telegram read @username 10

# reply to latest message
telegram reply "John" "hey back!"

# get unread messages (json output with media info)
telegram unread 20

# list dialogs
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

### advanced

**multi-account / custom session location:**
```bash
# use env var
TELEGRAM_SESSION=./custom.txt telegram send @friend "hey"

# or pass flag (todo)
telegram send @friend "hey" --session ./custom.txt
```

**precedence for API credentials:**
1. `TELEGRAM_APP_ID` and `TELEGRAM_APP_HASH` env vars
2. `~/.supertelegram/config.json` (global)
3. `.env` file in current directory (for dev)

**precedence for session file:**
1. `TELEGRAM_SESSION` env var
2. `~/.supertelegram/session.txt` (global default)
3. `./session.txt` (backwards compat)

## development

clone repo and install:
```bash
git clone https://github.com/caffeinum/telegram-cli.git
cd telegram-cli
bun install
```

run locally:
```bash
bun run cli <command>
```
