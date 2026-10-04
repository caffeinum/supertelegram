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

### full-screen app

run `telegram` (or `bunx supertelegram`) with no arguments in a terminal:

```
 supertelegram 7 unread chats · 214 loaded                              default   ? help
▌● Covers!                    3 mnk: 8qcK… address                             14:02
 ● Kate                       1 look at this                                   13:47
 ⌃ Saved Messages               you: note to self                              12:10
 NORMAL  j/k move · enter open · / filter · gu next unread · gs search · ctrl-k commands
```

two views: the **chat list** (unread counts, muted, drafts ✎, last message) and the **chat**,
drawn like an AI chat transcript — `⏺ name` for others, `> ` for you, replies quoted,
`▣ photo` for media, day separators — with a `>` prompt at the bottom. new messages
arrive live.

it's modal like vim, so letters never land in a message by accident:

| | keys |
|---|---|
| move / scroll | `j` `k` (the view scrolls only near the edge) · `ctrl-d` `ctrl-u` half a page · `gg` (loads older) `G` |
| open / back | `enter` · `h` / `esc` |
| write | `i` (or `enter` in a chat) · `enter` sends · `alt-enter` newline · `esc` keeps the draft |
| reply / media / copy | `r` reply · `f` forward (pick a chat, newest first) · `v` show image / video preview inline · `V` full screen · `t` transcribe a voice message or video note · `o` open (file → its app, link → browser, location → maps) · `gx` open link · `y` copy text |
| image | `ctrl-v` pastes the clipboard image (or drag a file in) as an attachment chip |
| go to | `gc` chat… · `gs` search everywhere · `gu` next unread · `gi` chat list · `gm` saved messages · `ga` account |
| forums | a forum group opens on its topics (`/` filters them) · `enter` opens a topic · `h` back to the topics — messages, drafts and sends stay inside the topic |
| folders | `tab` / `shift-tab` next/prev folder · `gf` folder… — opens on your default folder (the first in telegram's order) |
| everything | `ctrl-k` or `:` — command palette with every feature and its shortcut · `?` help |
| quit | `ctrl-c ctrl-c` or `:q` — drafts are kept per chat (`~/.supertelegram/drafts.json`) |

- startup is instant: the last chat list (and folders) is cached in `~/.supertelegram/cache/<account>.json`
  (owner-only; it holds chat titles and last-message previews), drawn in about half a second, then refreshed live
- your telegram folders show as tabs with unread badges; chats a folder names that are older than your
  recent list fill in in the background
- chats open instantly: the top of the list and the chats around your cursor are preloaded (never marked read), and so are your other accounts, so `ga` is instant too
- images draw with unicode blocks by default (works everywhere); in the full-screen viewer `p` switches to kitty / sixel
  if your terminal draws those (`telegram config set images kitty`)
- transcription uses telegram's own speech-to-text: telegram premium, or the few free trials it gives otherwise
- opening a chat marks it read; moving through the list never does
- a draft belongs to its chat: switching chats, incoming messages or reordering can't send it elsewhere
- a failed send puts the text back in the prompt and is never retried
- `alt-1..9` opens pinned chats (needs "option as meta" in your terminal)
- ⌘ shortcuts don't reach terminal apps; to use ⌘k, map it to ctrl-k in your terminal
  (ghostty: `keybind = super+k=text:\x0b`; iterm2: send hex code `0x0b`)

### interactive shell

the line-based shell lives on as `telegram shell`: the same commands without the `telegram`
prefix, tab completion for commands/flags/accounts/chats/paths, persistent history.

### find a chat

chats are addressed by `@username`, numeric id, or title. ids come from `list`.

```bash
telegram list                     # 100 most recent chats: title, @username, [id], type, unread
telegram list covers              # chats whose title/@username contains "covers"
telegram list -n 20 --offset 20   # page through
telegram info -5078309102         # group details + members (names, @usernames, ids, roles)
telegram info -1001364634660 -q aleks   # search members of a big group
telegram info @username           # a person's profile
```

a title must match exactly one chat — if it matches several you get the list of
ids and exit code 4, never a guess. if the chat isn't in this account, the error
tells you which of your other accounts has it and the exact command to run.

### search messages

```bash
telegram search "sol address"                     # message text across all your chats (+ chats whose name matches)
telegram search адрес --in Covers!                # inside one chat (@username, id, or title)
telegram search deploy --in -1001364634660 --from @caffeinum   # only one person's messages (needs --in)
telegram search invoice -n 20 --json
```

results show newest last, as `[date] Chat [id] #msg-id sender: text`. pages end with a
`more:` line: `--cursor <token>` across all chats, `--before <msg-id>` inside one.
at most 100 per page (telegram's limit).

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
telegram transcribe @username 2745950   # speech-to-text for a voice message / video note
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
