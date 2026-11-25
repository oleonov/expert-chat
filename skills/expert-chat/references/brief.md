# Chat brief template

Write `<roomDir>/brief.md` in this shape. It is the first message of the chat, from the user, to both
experts. Facts and pointers only: the experts read the code themselves. No hypothesis of your own (an
expert handed a hypothesis tends to confirm it), no keys, seeds, tokens or unrelated private files: the
brief is sent to OpenAI and Anthropic.

Write it in the language the user talks to you in.

```
## Task
<what we want to understand or decide, in one or two sentences>

## Where to look
- Working directory: <absolute path of the repo or worktree>
- <file:line, commit, PR, issue, log excerpt>

## Facts
- <observed facts, each with its source>

## Constraints
- <requirements and project rules the answer must respect>
```
