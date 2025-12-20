# bot-creator

telegram cli for ai to read/write messages using gramjs.

## setup

```bash
bun install
```

create `.env` file:
```bash
TELEGRAM_APP_ID="your_app_id"
TELEGRAM_APP_HASH="your_app_hash"
```

get credentials from https://my.telegram.org/apps

## login

```bash
bun run login
```

session is saved to `session.txt`.

## usage

```bash
# send a message
bun run cli send <username> <message>

# read messages
bun run cli read <username> [limit]

# list dialogs
bun run cli dialogs [limit]
```

### flags

- `-v, --verbose` - show debug logs

## interactive mode

```bash
bun run cli:interactive
```
