import type { CommandRunInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { histogram, progressText } from '../hooks/register'

// A /badge command as the person would type it in the terminal.
function badgeCommand(args: string): CommandRunInput {
  return {
    command: 'badge',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  }
}

test('/badge <task> pins the badge and saves it for a resumed session', async ($, on) => {
  const stored = new Map<string, unknown>()

  on('session.id', () => ({ value: 'session-123' }))
  on('session.root', () => ({ value: '/Users/me/projects/evals-course-revamp' }))
  on('store.set', ($, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })

  const reply = await $.command.run(badgeCommand('building the lesson 1 slides'))

  expect(reply).toEqual({
    text: 'Badge pinned: This agent is building the lesson 1 slides in the evals-course-revamp folder.',
  })
  expect(stored.get('badge:session-123')).toEqual(
    expect.objectContaining({
      folder: 'evals-course-revamp',
      task: 'building the lesson 1 slides',
      isPinned: true,
    }),
  )
})

test('/badge with too short a task explains the usage', async $ => {
  const reply = await $.command.run(badgeCommand('x'))

  expect(reply).toEqual({ text: 'Usage: /badge <what the agent is doing>, or /badge auto' })
})

test('the card draws on the terminal', async ($, on) => {
  on('session.id', () => ({ value: 'session-123' }))
  on('session.root', () => ({ value: '/Users/me/projects/evals-course-revamp' }))
  on('store.set', () => ({ value: undefined }))

  await $.command.run(badgeCommand('building the lesson 1 slides'))
  const card = await $.ui.mount({
    plugin: 'session-badge',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 10,
      bodyColumns: 120,
      scroll: { offset: 0, bodyRows: 10 },
      view: {},
    },
  })

  expect(await card.find({ text: /building the lesson 1 slides/ })).toBeTruthy()
})

test('the stats line and histogram place this session in the distribution', () => {
  const past = { counts: [1, 1, 2, 5, 9, 10, 12, 40, 130] }
  const progress = { startedAt: 0, now: 3 * 3600000 + 5 * 60000, turns: 70 }

  expect(progressText(progress, past)).toBe(
    'Running 3h 5m · 70 turns · longer than 89% of your sessions (median 9)',
  )
  expect(progressText(progress, null)).toBe('Running 3h 5m · 70 turns')

  const chart = histogram(past, 70)
  expect(chart.bars).toHaveLength(8)
  expect(chart.current).toBe(5)
})
