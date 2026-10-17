import { describe, expect, it } from 'vitest'
import { box, fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import { COUNT_HISTORY, CYCLE_MAX, MOVE_WINDOW, countAccuracy, firstCounts, planCycleCount } from './cycleCount'
import { demoWms } from './demoApi'
import { addDays, bangkokDay } from './ledger'
import type { CountRow, CycleActivity, MoveRow } from './types'

const TODAY = '2026-10-17'
const locations = fixtureMaster.locations
const count = (day: string, loc: string, itemId: string, system: number, counted: number, hour = 9): CountRow => ({
  at: `${day}T0${hour}:00:00+07:00`,
  day,
  loc,
  itemId,
  partNo: 'P',
  system,
  counted,
  code: '10001',
})
const moves = (loc: string, n: number, day = addDays(TODAY, -2)): MoveRow[] => Array.from({ length: n }, () => ({ day, loc }))
const plan = (activity: Partial<CycleActivity> = {}, lpns = fixtureLpns) => planCycleCount({ today: TODAY, lpns, locations, activity: { counts: [], moves: [], ...activity } })

describe('daily cycle count plan', () => {
  it('counts storage slots that hold stock, busiest first when nothing was counted yet', () => {
    const p = plan({ moves: [...moves('RK-B-02-1', 4), ...moves('RK-A-01-1', 1), ...moves('RK-A-01-1', 9, TODAY)] })
    // MI3 / NG / ช่องที่ไม่รู้จัก / กล่องที่ไม่มีของเหลือ ไม่อยู่ในแผน · ความเคลื่อนไหววันนี้ไม่เปลี่ยนลำดับ
    expect(p.slots.map((s) => [s.code, s.reason])).toEqual([
      ['RK-B-02-1', 'never'],
      ['RK-A-01-1', 'never'],
      ['RK-A-01-2', 'never'],
    ])
    expect([p.stocked, p.target, p.done, p.extra]).toEqual([3, 3, 0, 0])
    expect(p.slots.find((s) => s.code === 'RK-A-01-2')).toMatchObject({ items: 2, counted: 0, done: false, boxes: [{ lpnNo: 'LPN-2', items: 2, counted: 0 }] })
  })

  it('recounts a slot that did not match, skips slots counted this week and adds slots counted outside the plan', () => {
    const p = plan({
      counts: [
        count(addDays(TODAY, -3), 'RK-A-01-2', 'LPN-2-1', 50, 48),
        count(addDays(TODAY, -2), 'RK-A-01-1', 'LPN-1-0', 6000, 6000),
        // นับเพิ่มวันนี้ที่ช่องที่เพิ่งนับไป
        count(TODAY, 'RK-A-01-1', 'LPN-1-0', 6000, 6000),
      ],
    })
    expect(p.slots.map((s) => [s.code, s.reason, s.done])).toEqual([
      ['RK-A-01-2', 'recount', false],
      ['RK-B-02-1', 'never', false],
      ['RK-A-01-1', null, true],
    ])
    expect([p.target, p.done, p.extra]).toEqual([3, 0, 1])
    expect(p.slots[0].lastCounted).toBe(addDays(TODAY, -3))
    // นับครบ 7 วันแล้ว ⇒ ถึงรอบอีกครั้ง
    const later = planCycleCount({ today: addDays(TODAY, 5), lpns: fixtureLpns, locations, activity: { counts: [count(addDays(TODAY, -2), 'RK-A-01-1', 'LPN-1-0', 6000, 6000)], moves: [] } })
    expect(later.slots.find((s) => s.code === 'RK-A-01-1')?.reason).toBe('due')
  })

  it('tracks progress per part in each box and moves finished slots to the end', () => {
    const half = plan({ counts: [count(TODAY, 'RK-A-01-2', 'LPN-2-0', 3000, 3000)] })
    expect(half.slots.find((s) => s.code === 'RK-A-01-2')).toMatchObject({ counted: 1, items: 2, done: false })
    const full = plan({ counts: [count(TODAY, 'RK-A-01-2', 'LPN-2-0', 3000, 3000), count(TODAY, 'RK-A-01-2', 'LPN-2-1', 50, 50)] })
    expect(full.done).toBe(1)
    expect(full.slots.at(-1)).toMatchObject({ code: 'RK-A-01-2', done: true, reason: 'never' })
  })

  it('leaves boxes received today alone and sizes the daily list to cover every slot in about 20 working days', () => {
    const fresh = box('LPN-NEW', 'RK-C-01-1', [['RAT00586', 10]], { createdAt: `${TODAY}T03:00:00Z` })
    expect(plan({}, [...fixtureLpns, fresh]).slots.map((s) => s.code)).not.toContain('RK-C-01-1')
    // คลังจำลองขนาดต่าง ๆ: วันละ 1/20 ของช่องที่มีของ อย่างน้อย 5 สูงสุด 30
    const sized = (n: number) => {
      const locs = Array.from({ length: n }, (_, i) => ({ code: `X-${String(i).padStart(4, '0')}`, zoneId: 'X', kind: 'bin' as const, active: true }))
      return planCycleCount({ today: TODAY, locations: locs, lpns: locs.map((l, i) => box(`L-${i}`, l.code, [['RAT00586', 1]])), activity: { counts: [], moves: [] } }).target
    }
    expect([sized(3), sized(12), sized(120), sized(900)]).toEqual([3, 5, 6, CYCLE_MAX])
  })
})

describe('cycle count on the demo site', () => {
  it('puts the slot that did not match two days ago first and skips slots counted this week', async () => {
    const api = demoWms({ samples: true })
    const today = bangkokDay(new Date().toISOString())
    const [lpns, activity, m] = await Promise.all([api.activeLpns(), api.cycleActivity(addDays(today, -COUNT_HISTORY), addDays(today, -MOVE_WINDOW)), api.master()])
    const p = planCycleCount({ today, lpns, locations: m.locations, activity })
    expect(activity.counts).toHaveLength(6)
    expect([p.target, p.slots[0].reason]).toEqual([5, 'recount'])
    const matched = new Set(activity.counts.filter((c) => c.counted === c.system).map((c) => c.loc))
    expect(p.slots.filter((s) => matched.has(s.code) && !s.done)).toEqual([])
  })
})

describe('stock accuracy', () => {
  it('scores only the first count of each part per day', () => {
    const rows = [
      count('2026-10-15', 'RK-A-01-1', 'A', 100, 100, 8),
      // นับซ้ำหลังเห็นผล ไม่นับเป็นความแม่นยำ
      count('2026-10-15', 'RK-A-01-1', 'A', 100, 90, 9),
      count('2026-10-15', 'RK-A-01-2', 'B', 50, 49),
      count('2026-10-16', 'RK-A-01-1', 'A', 100, 100),
      count('2026-10-01', 'RK-A-01-1', 'A', 100, 100),
    ]
    expect(firstCounts(rows)).toHaveLength(4)
    expect(countAccuracy(rows, '2026-10-15', '2026-10-17')).toEqual({ lines: 3, matched: 2, pct: 66.7 })
    expect(countAccuracy(rows, '2026-10-15', '2026-10-17', (r) => r.itemId === 'A')).toEqual({ lines: 2, matched: 2, pct: 100 })
    expect(countAccuracy([], TODAY, TODAY)).toEqual({ lines: 0, matched: 0, pct: null })
  })
})
