/** What the badge shows: what the agent is doing, the folder it works in, and a color. */
export type Badge = {
  /** The last segment of the session's working directory, e.g. "evals-course-revamp". */
  folder: string
  /** What the agent is doing, starting with an -ing verb, e.g. "building a session indicator mod". */
  task: string
  /** A hex color picked from the session id, so each session keeps its own color. */
  color: string
  /** Set with /badge <task>; automatic relabeling stops while pinned. */
  isPinned: boolean
}

/** How long this session has run and how many prompts it has had. */
export type Progress = {
  /** When the session first launched, in `$.clock.now()` milliseconds. */
  startedAt: number
  /** The latest clock reading; a timer moves it every minute so the card redraws. */
  now: number
  /** Prompts the person has sent in this session. */
  turns: number
}

/** Prompt counts of the person's other sessions, read from their transcripts. */
export type TurnHistory = {
  /** One entry per other session with at least one prompt, sorted ascending. */
  counts: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'session-badge': { badge: Badge | null; progress: Progress | null; history: TurnHistory | null }
  }
}
