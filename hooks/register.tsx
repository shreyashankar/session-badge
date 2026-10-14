import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Badge, Progress, TurnHistory } from '../types'

const badge = atom({ plugin: 'session-badge', key: 'badge' } as const, null)
const progress = atom({ plugin: 'session-badge', key: 'progress' } as const, null)
const history = atom({ plugin: 'session-badge', key: 'history' } as const, null)

const MINUTE = 60 * 1000
// Store key for {sessionId: turn count}, kept across sessions and cleanups.
const COUNTS_KEY = 'turn-counts'
// The turn distribution across sessions is recounted this often.
const HISTORY_REFRESH_MS = 2 * 60 * MINUTE

// Counts the prompts the person typed in each saved session transcript and
// prints {sessionId: count}. Tool results, slash command output, interrupts,
// meta rows and subagent rows are not prompts. Streams each file, so the
// large transcripts cost little memory; all of them take about a second.
const COUNT_TURNS_PY = [
  'import glob, json, os',
  'SKIP = ("<command-", "<local-command", "<bash-", "<task-notification", "[Request interrupted", "Caveat:", "<system-reminder")',
  'def is_prompt(rec):',
  '    if rec.get("type") != "user" or rec.get("isMeta") or rec.get("isSidechain"): return False',
  '    c = (rec.get("message") or {}).get("content")',
  '    if isinstance(c, list):',
  '        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c): return False',
  '        c = " ".join(b.get("text", "") for b in c if isinstance(b, dict))',
  '    return isinstance(c, str) and bool(c.strip()) and not c.lstrip().startswith(SKIP)',
  'out = {}',
  'for f in glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")):',
  '    n = 0',
  '    with open(f, errors="ignore") as fh:',
  '        for line in fh:',
  '            if \'"user"\' not in line: continue',
  '            try: rec = json.loads(line)',
  '            except Exception: continue',
  '            if is_prompt(rec): n += 1',
  '    out[os.path.basename(f)[:-6]] = n',
  'print(json.dumps(out))',
].join('\n')

// Distinct, readable colors; the session id picks one.
const PALETTE = [
  '#E8937F', '#6BA3D6', '#7BC89C', '#E8C87A', '#B39DDB',
  '#F48FB1', '#4DD0E1', '#FFB74D', '#A1887F', '#90A4AE',
]

// How many of the person's latest messages the label is based on. Older
// messages are left out so the label follows the current topic.
const RECENT_MESSAGES = 10

const LABEL_PROMPT = `You name a coding agent session so a person juggling many sessions can recognize it at a glance.

Below are the person's latest messages in this session, oldest first, and the session's current label (if any). Summarize what these messages, taken together, are working on: the task they share, not the subject of the last message alone. If they cover two unrelated tasks, name the one most of the recent messages are about.

Keep the current label unless the topic has actually changed. A follow-up, a refinement, a fix or a question about the same thing is the same topic. If the current label still fits, reply with exactly: SAME

Rules:
- The label is 3 to 7 lowercase words. It starts with a verb ending in -ing that says what is being done, followed by the concrete thing from the messages: a file, deck, feature, bug, homework, or document. Examples: "building a session indicator mod", "fixing the hw2 session id", "redesigning the lesson 1 trace slide", "uploading slides to docsend".
- It must read naturally after "This agent is".
- Never use vague words alone such as harness, code, project, task, work, setup, misc, or help.
- Do not repeat the folder name. No emoji, no quotes, no period.

Otherwise reply with exactly one line: the label.`

let isLabeling = false

function colorFor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? '#90A4AE'
}

function folderOf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? cwd
}

// Takes the first line, drops anything before the first letter (a stray
// emoji or bullet), quotes and a trailing period.
function parseTask(text: string): string | undefined {
  const line = text.trim().split('\n')[0] ?? ''
  const task = line
    .replace(/^[^a-zA-Z]+/, '')
    .replace(/["'.]+$/g, '')
    .trim()
    .toLowerCase()
  return task.length >= 3 && task.length <= 80 ? task : undefined
}

// Badges saved by earlier versions may hold a placeholder or a label that is
// not verb-first; both get relabeled.
function isNamed(b: Badge | null): boolean {
  return !!b && !!b.task && b.task !== 'new session'
}

function isVerbFirst(b: Badge | null): boolean {
  return !!b && /^[a-z]+ing\b/.test(b.task)
}

function badgeText(b: Badge): string {
  return isNamed(b)
    ? `This agent is ${b.task} in the ${b.folder} folder.`
    : `This agent is in the ${b.folder} folder.`
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / MINUTE))
  const days = Math.floor(minutes / (24 * 60))
  const hours = Math.floor((minutes % (24 * 60)) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] ?? 0 : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
}

// "Running 3h 12m · 65 turns · longer than 84% of your sessions (median 9)"
export function progressText(p: Progress, past: TurnHistory | null): string {
  const parts = [`Running ${formatDuration(p.now - p.startedAt)}`, `${p.turns} ${p.turns === 1 ? 'turn' : 'turns'}`]
  if (past && past.counts.length > 0) {
    const shorter = past.counts.filter(n => n < p.turns).length
    const percent = Math.round((100 * shorter) / past.counts.length)
    parts.push(`longer than ${percent}% of your sessions (median ${median(past.counts)})`)
  }
  return parts.join(' · ')
}

// Turn-count buckets for the card's histogram, and the bar characters.
const BUCKETS: readonly [number, number][] = [
  [1, 1], [2, 3], [4, 10], [11, 25], [26, 50], [51, 100], [101, 200], [201, Infinity],
]
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']

// One bar per bucket, scaled to the fullest bucket, and which bucket this
// session falls in (-1 before its first prompt).
export function histogram(past: TurnHistory, turns: number): { bars: string[]; current: number } {
  const sizes = BUCKETS.map(([lo, hi]) => past.counts.filter(n => n >= lo && n <= hi).length)
  const most = Math.max(1, ...sizes)
  const bars = sizes.map(size => BARS[Math.round((size / most) * (BARS.length - 1))] ?? '▁')
  const current = BUCKETS.findIndex(([lo, hi]) => turns >= lo && turns <= hi)
  return { bars, current }
}

async function refreshProgress($: EngineInterface): Promise<void> {
  const [usage, turns, now] = await Promise.all([$.session.usage(), $.session.turns(), $.clock.now()])
  await update($, progress, () => ({ startedAt: usage.startedAt, now, turns }))
}

async function refreshHistory($: EngineInterface): Promise<void> {
  const ran = await $.process
    .run(['python3', '-c', COUNT_TURNS_PY], { timeoutMs: 60000 })
    .catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return
  const own = await $.session.id()
  // Claude Code deletes transcripts after cleanupPeriodDays (30 by default),
  // so every count seen is kept in the store and merged with the transcripts
  // still on disk; the history then reaches back past the cleanup.
  const kept = ((await $.store.get(COUNTS_KEY)) ?? {}) as Record<string, number>
  const onDisk = JSON.parse(ran.stdout) as Record<string, number>
  const byId: Record<string, number> = { ...kept }
  for (const [id, n] of Object.entries(onDisk)) byId[id] = Math.max(n, byId[id] ?? 0)
  await $.store.set(COUNTS_KEY, byId)
  const counts = Object.entries(byId)
    .filter(([id, n]) => id !== own && n > 0)
    .map(([, n]) => n)
    .sort((a, b) => a - b)
  await update($, history, () => ({ counts }))
}

async function storeKey($: EngineInterface): Promise<string> {
  return `badge:${await $.session.id()}`
}

// Saves the badge, so a resumed session keeps it.
async function publish($: EngineInterface, next: Badge): Promise<void> {
  await update($, badge, () => next)
  await $.store.set(await storeKey($), next)
}

async function relabel($: EngineInterface): Promise<void> {
  if (isLabeling) return
  const current = await read($, badge)
  if (current?.isPinned) return
  isLabeling = true
  try {
    const said = (await $.session.messages())
      .filter(m => m.role === 'user' && m.text.trim())
      .map(m => m.text.trim().slice(0, 400))
    if (said.length === 0) return
    const picked = said.slice(-RECENT_MESSAGES)
    const folder = current?.folder ?? folderOf(await $.session.root())
    const known = current && isNamed(current) && isVerbFirst(current) ? current.task : '(none)'
    const reply = await $.model.complete({
      model: 'haiku',
      prompt: `${LABEL_PROMPT}\n\nFolder: ${folder}\nCurrent label: ${known}\n\nMessages:\n${picked.map((t, i) => `${i + 1}. ${t}`).join('\n')}`,
      maxTokens: 40,
    })
    if (!reply.isAnswered) return
    if (reply.text.trim().toUpperCase().startsWith('SAME')) return
    const task = parseTask(reply.text)
    if (!task) return
    const color = current?.color ?? colorFor(await $.session.id())
    await publish($, { folder, color, task, isPinned: false })
  } finally {
    isLabeling = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'badge',
      description: "Show or set what this session's badge says: /badge <task>, or /badge auto",
    })

    const saved = (await $.store.get(await storeKey($))) as Badge | undefined
    const start: Badge = saved ?? {
      folder: folderOf(await $.session.root()),
      task: '',
      color: colorFor(await $.session.id()),
      isPinned: false,
    }
    await publish($, start)
    // The badge lives in the band alone; clear a status line an older version pinned.
    $.ui.status(undefined)
    await refreshProgress($)
    const started = await next(e)
    // A session that already has a conversation (resumed, or the mod loaded
    // mid-session) gets its label now instead of after the next turn.
    if ((await $.session.turns()) > 0) void relabel($)

    // The elapsed time moves every minute; the distribution is recounted
    // now and every couple of hours. Both timers stop when the module reloads.
    $.clock.every(MINUTE, () => {
      void update($, progress, p => (p ? { ...p, now: p.now + MINUTE } : p))
    })
    void refreshHistory($)
    $.clock.every(HISTORY_REFRESH_MS, () => {
      void refreshHistory($)
    })

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await refreshProgress($)
    // Checked after every turn; relabel keeps the label unless the topic
    // changed, and skips a pinned badge and a call already in flight.
    void relabel($)

    return result
  })

  on('command.run', { command: 'badge' }, async ($, e) => {
    const current = await read($, badge)
    const args = e.args.trim()
    if (!args) {
      return { text: current ? `${badgeText(current)}${current.isPinned ? ' (pinned)' : ''}` : 'No badge yet.' }
    }
    if (args === 'auto') {
      if (current) await publish($, { ...current, isPinned: false })
      void relabel($)
      return { text: 'Badge set to relabel automatically.' }
    }
    const task = parseTask(args)
    if (!task) return { text: 'Usage: /badge <what the agent is doing>, or /badge auto' }
    const pinned: Badge = {
      folder: current?.folder ?? folderOf(await $.session.root()),
      color: current?.color ?? colorFor(await $.session.id()),
      task,
      isPinned: true,
    }
    await publish($, pinned)
    return { text: `Badge pinned: ${badgeText(pinned)}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, badge)
    if (!current || e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const p = await read($, progress)
    const past = await read($, history)
    const chart = p && past && past.counts.length > 0 ? histogram(past, p.turns) : null

    return (
      <Box borderStyle="round" borderColor={current.color} paddingX={1} alignSelf="flex-start" flexDirection="column">
        <Text dimColor>
          {'This agent is '}
          {isNamed(current) ? <Text color={current.color} bold>{`${current.task} `}</Text> : null}
          {'in the '}
          <Text color={current.color}>{current.folder}</Text>
          {' folder.'}
        </Text>
        {p ? <Text dimColor>{progressText(p, past)}</Text> : null}
        {chart ? (
          <Text dimColor>
            {'turns per session  1 '}
            {chart.bars.map((bar, i) =>
              i === chart.current ? (
                <Text key={`bar-${i}`} color={current.color} bold>{bar}</Text>
              ) : (
                bar
              ),
            )}
            {' 500'}
          </Text>
        ) : null}
      </Box>
    )
  })
}
