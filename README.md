# @caffeinum/telegram-cli

telegram cli for ai to read/write messages using gramjs.

## installation

```bash
npm install -g @caffeinum/telegram-cli
```

## setup

create `.env` file in your current directory:
```bash
TELEGRAM_APP_ID="your_app_id"
TELEGRAM_APP_HASH="your_app_hash"
```

get credentials from https://my.telegram.org/apps

## login

```bash
telegram login
```

session is saved to `session.txt` in current directory.

## usage

```bash
# send a message
telegram send <username> <message>

# read messages
telegram read <username> [limit]

# reply to latest message
telegram reply <username> <message>

# get unread messages (json output)
telegram unread [limit]

# list dialogs
telegram dialogs [limit]
```

### flags

- `-v, --verbose` - show debug logs
- `--help` - show help
- `--version` - show version

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
