---
name: expert-chat
description: Use when the user wants an interactive group chat with the frontier Claude and GPT models about the current task — "open a chat with the experts", "let's discuss this with the experts", "/expert-chat", "давай початимся с экспертами", "открой чат с экспертами", "обсудим с экспертами". Opens a terminal chat in a new iTerm2 window where both experts answer, argue and check each other's claims against the code while the user joins in; when the user closes it, only the agreed decision comes back to this session. Not for a single quick question that two or three tool calls can answer.
---

# Expert Chat

A chat window with the user, the strongest Claude and the strongest GPT model, both running on the
user's own subscriptions (`claude -p`, `codex exec`). The experts may read the project and search the
web; they cannot change files. They answer the first message blindly, then talk to each other; the
user steers with plain messages, `@claude` / `@gpt`, `/stop`, `/budget N`, `/close` (decision and
return) and `/quit` (leave without a decision). This session gets back only `decision.md`.

Scripts live next to this file: `scripts/` (`$S` below is that directory).

## 1. App ready

`command -v expert-chat` must succeed. If it does not, tell the user to run `./install.sh` in their
expert-chat clone and stop.

## 2. Pick the models

If the user named a model or an effort, use exactly that. Otherwise read both live catalogs (the
Codex one is refreshed by the call; the Claude one by any `claude -p` run, so if its `staleAt` is in
the past run `claude -p --effort low --tools "" "ok"` first):

```bash
codex debug models | jq -r '.models[] | select(.visibility=="list" and .upgrade==null)
  | "\(.slug) | \(.description) | \([.supported_reasoning_levels[].effort]|join(","))"'
jq -r '.catalog.config.models[] | select(.section=="main")
  | "\(.id) | \(.description) | \(.runtime.effort_levels|join(","))"' \
  ~/.claude/cache/model-catalog/*-cc.json
```

The raw Codex catalog is large, never read it unfiltered. From each vendor pick the model the catalog
itself presents as the most capable (judge the description, not list order, `priority` or the CLI
default). It must support the `high` effort. If no model or several fit, ask the user.

## 3. Create the room

```bash
mkdir -p "$TMPDIR/expert-rooms/<project>"
ROOM=$(mktemp -d "$TMPDIR/expert-rooms/<project>/$(date +%Y-%m-%d-%H%M%S)-<slug>-XXXX")
```

`<project>` is the basename of the working directory, `<slug>` a few latin words of the topic.
macOS removes files in `$TMPDIR` that nobody touched for about three days; there is no other cleanup.

Write `$ROOM/brief.md` from `references/brief.md` and `$ROOM/room.json`:

```json
{"topic": "<short topic>", "workdir": "<absolute repo or worktree path>",
 "lang": "<en|ru: the language the user talks to you in>",
 "models": {"claude": "<claude model id>", "codex": "<codex model slug>"}}
```

Optional: `"effort"` (default `high`). Only the question's context goes into the brief.

## 4. Open and wait

```bash
bash "$S/open_room.sh" "$ROOM"
```

It must print `window_id=`. A non-zero exit is a launch error: report it and start no waiter.
Then start one background task; its completion notification is the wait, do not poll:

```bash
bash "$S/wait_done.sh" "$ROOM"   # run in the background
```

Tell the user in one line that the chat is open and where the room is. Do not read the transcript
while the chat runs.

## 5. Report

- `done=closed`: read only `decision.md` and give the user its content in a few lines plus the full
  path of `transcript.md`.
- `done=quit`: the user left without a decision; say so.
- `done=interrupted`: the window was closed; say so and give the transcript path.
- `done=invalid`: report `reason`.
- `done=timeout`: the room is still open or was abandoned after 4 hours; give its path.

Read `transcript.md` only when the user asks what was discussed.
