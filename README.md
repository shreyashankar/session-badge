# session-badge

A Claude Code mod that shows a badge above the prompt in each session. The badge says what the agent is working on and which folder the session is in, for example "This agent is fixing the hw2 session id in the evals folder." Each session gets its own color, so you can tell many sessions apart at a glance.

The badge also shows how long the session has run, how many prompts it has had, and how that count compares to your other sessions.

## Install

Type this at the Claude Code prompt in a terminal:

```
/plugin install session-badge --marketplace shreyashankar/session-badge
```

Answer `y` to add the marketplace, then press Enter to pick the user scope.

## Use

The label updates after each turn. To set the label yourself:

```
/badge writing the lesson 1 slides
```

To go back to automatic labels, run `/badge auto`. To see the current label, run `/badge`.

## What the mod reads

- To write the label, the mod sends your last 10 messages in the session to Claude Haiku.
- To compare sessions, the mod counts the prompts in your saved transcripts under `~/.claude/projects` with a local `python3` script. Only the counts are kept.
