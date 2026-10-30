import { describe, it, expect } from 'vitest'
import { buildDayBlocks, findSlotsOf, toActiveMinutes, type DayBounds } from '../../src/sessions/blocks'
import type { EventRow } from '../../src/db/types'

const DAY: DayBounds = {
  startMs: Date.parse('2026-10-28T00:00:00.000Z'),
  endMs: Date.parse('2026-10-29T00:00:00.000Z'),
}
const IDLE_MS = 30 * 60 * 1000
const CLI = 1
const VSCODE = 2
const SITE = 3

let nextId = 1
/** An event at `HH:MM` on the test day, in a project (null: no project). */
function event(time: string, projectId: number | null, overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: nextId++,
    captured_at: `2026-10-28T${time}:00.000Z`,
    command: 'ls',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 100,
    repo_name: null,
    branch: null,
    category: 'files',
    metadata: null,
    source: null,
    file_path: null,
    project_id: projectId,
    ...overrides,
  }
}

describe('buildDayBlocks', () => {
  it('keeps interleaved work in several repos as one block, with a thread per project and one for the rest', () => {
    // The shape of session 183: cli and vscode work interleaved, landing-page saves in between, a couple of
    // events outside any repo — all one stretch of work
    const events = [
      event('12:09', CLI),
      event('12:15', VSCODE),
      event('12:20', CLI),
      event('12:31', SITE),
      event('12:40', null),
      event('12:55', VSCODE),
      event('13:10', CLI),
      event('13:20', null),
      event('13:48', CLI),
    ]

    const { blocks } = buildDayBlocks(events, IDLE_MS, DAY)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({
      startedAt: '2026-10-28T12:09:00.000Z',
      endedAt: '2026-10-28T13:48:00.000Z',
      eventCount: 9,
    })
    expect(blocks[0].threads.map((thread) => [thread.projectId, thread.eventIds.length, thread.startedAt])).toEqual([
      [CLI, 4, '2026-10-28T12:09:00.000Z'],
      [VSCODE, 2, '2026-10-28T12:15:00.000Z'],
      [SITE, 1, '2026-10-28T12:31:00.000Z'],
      [null, 2, '2026-10-28T12:40:00.000Z'],
    ])
  })

  it('splits blocks on an idle gap, and never on a repo switch', () => {
    const events = [event('09:00', CLI), event('09:02', VSCODE), event('09:04', CLI), event('10:30', CLI)]

    const { blocks } = buildDayBlocks(events, IDLE_MS, DAY)

    expect(blocks.map((block) => block.eventCount)).toEqual([3, 1])
    expect(blocks[0].threads.map((thread) => thread.projectId)).toEqual([CLI, VSCODE])
  })

  it("counts a block's time as its distinct slots, never the sum of its threads' times", () => {
    // Both projects are active in the same three slots
    const events = [
      event('10:00', CLI),
      event('10:01', VSCODE),
      event('10:05', CLI),
      event('10:06', VSCODE),
      event('10:10', CLI),
      event('10:11', VSCODE),
    ]

    const [block] = buildDayBlocks(events, IDLE_MS, DAY).blocks

    expect(block.threads.map((thread) => thread.activeSlots)).toEqual([3, 3])
    expect(block.activeSlots).toBe(3)
    expect(toActiveMinutes(block.activeSlots)).toBe(15)
  })

  it("counts a long-running first event's earlier slots in both the block's and its thread's time", () => {
    // A 30-minute build that finished at 10:30 started at 10:00, before the block's first captured time
    const events = [event('10:30', CLI, { duration_ms: 30 * 60 * 1000 }), event('10:32', CLI)]

    const [block] = buildDayBlocks(events, IDLE_MS, DAY).blocks

    expect(block.startedAt).toBe('2026-10-28T10:30:00.000Z')
    expect(block.activeSlots).toBe(7)
    expect(block.threads[0].activeSlots).toBe(7)
  })

  it('counts events per slot and project', () => {
    const events = [event('10:00', CLI), event('10:03', CLI), event('10:04', null)]

    expect(buildDayBlocks(events, IDLE_MS, DAY).slots).toEqual([
      { slotStart: '2026-10-28T10:00:00.000Z', projectId: CLI, eventCount: 2 },
      { slotStart: '2026-10-28T10:00:00.000Z', projectId: null, eventCount: 1 },
    ])
  })

  it('has no blocks for a day with no events', () => {
    expect(buildDayBlocks([], IDLE_MS, DAY)).toEqual({ blocks: [], slots: [] })
  })
})

describe('findSlotsOf', () => {
  it('puts a short event in the slot of its captured time', () => {
    expect(findSlotsOf(event('10:07', CLI), DAY)).toEqual([Date.parse('2026-10-28T10:05:00.000Z')])
  })

  it('spreads a 30-minute build over every slot from its start to its end', () => {
    const slots = findSlotsOf(event('10:32', CLI, { duration_ms: 30 * 60 * 1000 }), DAY)

    expect(slots).toHaveLength(7)
    expect(new Date(slots[0]).toISOString()).toBe('2026-10-28T10:00:00.000Z')
    expect(new Date(slots[6]).toISOString()).toBe('2026-10-28T10:30:00.000Z')
  })

  it('clamps a long event that started before midnight to the day', () => {
    const slots = findSlotsOf(event('00:10', CLI, { duration_ms: 60 * 60 * 1000 }), DAY)

    expect(new Date(slots[0]).toISOString()).toBe('2026-10-28T00:00:00.000Z')
    expect(slots).toHaveLength(3)
  })
})
