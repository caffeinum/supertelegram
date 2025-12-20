# polling skill: message answering loop

## what it does
runs a check-answer-sleep loop where you stay in control between iterations. no background processes - you manually poll, decide, respond, then sleep.

## why this pattern
- you keep control: each iteration returns, letting you think and decide
- no daemon: avoids running detached processes you can't monitor
- flexible: you can use any tool (web fetch, file read, etc) before responding
- simple: just cli commands + sleep, no complex state management

## how to activate
say: "go into polling mode" or "check messages and answer in a loop"

## the loop pattern
```
while true:
  1. check for new messages: `bun run cli unread 10`
  2. for each unread personal message:
     - read the message
     - think about response (can use tools if needed)
     - reply: `bun run cli reply "<chat>" "<message>"`
  3. sleep: `sleep 60`
  4. repeat
```

## commands available
- `bun run cli unread [limit]` - get unread messages as json
- `bun run cli reply <chat> <message>` - reply to a chat by name (partial match)
- `bun run cli dialogs [limit]` - list recent chats
- `bun run cli read <username> [limit]` - read message history

## tips
- ignore system/bot channels (high unread counts like 10000+)
- use partial chat names for reply (e.g., "Паша" matches "Паша СЕО")
- can fetch external data before replying (weather, web, files, etc.)
- sleep for 60 seconds is a good default, adjust as needed

## example session
```
> bun run cli unread 10
[{"chat": "Alice", "unreadCount": 1, "messages": [{"text": "what time is it?"}]}]

> # think: they want the time
> date
Fri Dec 19 22:20:00 PST 2025

> bun run cli reply "Alice" "it's 10:20pm PST!"
sent to Alice: it's 10:20pm PST! (id: 123)

> sleep 60
# ... wait ...

> bun run cli unread 10
# repeat
```
