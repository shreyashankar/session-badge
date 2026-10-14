# session-badge

session-badge is a Claude Code mod. The mod shows a badge above the prompt in each session.

The badge shows:

- The task of the agent, for example "fixing the hw2 session id".
- The folder of the session.
- The run time of the session.
- The number of prompts in the session.
- A comparison of this number with the number of prompts in your other sessions.

Each session has a different color. The color helps you identify each session.

## Install

1. Open Claude Code in a terminal.
2. Type this command at the prompt:

   ```
   /plugin install session-badge --marketplace shreyashankar/session-badge
   ```

3. Type `y` to add the marketplace.
4. Push Enter to select the user scope.

## Use

The mod updates the task label after each turn.

To set the task label manually, type `/badge` and the task. Example:

```
/badge writing the lesson 1 slides
```

The mod does not change a label that you set manually.

To start the automatic labels again, type `/badge auto`.

To show the current label, type `/badge`.

## Data that the mod reads

- The mod sends your last 10 messages in the session to Claude Haiku. Claude Haiku writes the task label.
- The mod counts the prompts in your saved transcripts in `~/.claude/projects`. A local `python3` script does this count. The mod keeps only the counts.
