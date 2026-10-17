import { addDays, bangkokDay } from './ledger'
import type { CountRow, CycleActivity, Lpn, StorageLoc } from './types'

/** นับครบทุกช่องที่มีของภายในราว 20 วันทำงาน (ประมาณ 1 เดือน) */
export const CYCLE_ROUND_DAYS = 20
export const CYCLE_MIN = 5
export const CYCLE_MAX = 30
/** นับแล้วไม่ต้องนับซ้ำภายในกี่วัน (ยกเว้นครั้งก่อนไม่ตรง) */
export const RECOUNT_AFTER = 7
/** ดูความเคลื่อนไหวย้อนหลังกี่วัน */
export const MOVE_WINDOW = 14
/** เข้า-ออกตั้งแต่กี่ครั้งในช่วงนั้น = เคลื่อนไหวบ่อย */
export const BUSY_MOVES = 3
/** ดึงประวัติการนับย้อนหลังกี่วัน */
export const COUNT_HISTORY = 90
/** เป้าความแม่นยำสต็อก (%) */
export const ACCURACY_TARGET = 98

export type CycleReason = 'recount' | 'never' | 'busy' | 'due'

export const CYCLE_REASON: Record<CycleReason, string> = {
  recount: 'ครั้งก่อนไม่ตรง',
  never: 'ยังไม่เคยนับ',
  busy: 'เคลื่อนไหวบ่อย',
  due: 'ถึงรอบนับ',
}

export interface CycleBox {
  lpnNo: string
  /** part ในกล่องที่ต้องนับ */
  items: number
  /** part ที่นับแล้ววันนี้ */
  counted: number
}

export interface CycleSlot {
  code: string
  zoneId: string
  /** null = ไม่อยู่ในแผนวันนี้ แต่มีคนนับเพิ่ม */
  reason: CycleReason | null
  boxes: CycleBox[]
  items: number
  counted: number
  done: boolean
  /** นับครั้งล่าสุดก่อนวันนี้ */
  lastCounted: string | null
  moves: number
}

export interface CyclePlan {
  day: string
  /** จำนวนช่องที่ควรนับวันนี้ */
  target: number
  /** ช่องในแผนที่ยังไม่ครบ (เรียงตามลำดับที่ควรนับ) → ช่องที่นับครบแล้ว → ช่องที่นับเพิ่ม */
  slots: CycleSlot[]
  done: number
  extra: number
  /** ช่องที่มีของ (ที่มาของการสุ่มนับ) */
  stocked: number
}

/** นับครั้งแรกของแต่ละรายการในแต่ละวัน (นับซ้ำหลังเห็นผลไม่นำมาคิดความแม่นยำ) */
export function firstCounts(rows: CountRow[]) {
  const seen = new Set<string>()
  return [...rows]
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((r) => {
      const k = `${r.itemId ?? `${r.loc}|${r.partNo}`}|${r.day}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

export interface Accuracy {
  lines: number
  matched: number
  /** % ทศนิยม 1 ตำแหน่ง · null = ยังไม่มีการนับ */
  pct: number | null
}

/** ความแม่นยำสต็อก = รายการที่นับครั้งแรกแล้วตรงกับระบบ ÷ รายการที่นับทั้งหมด ในช่วง from–to */
export function countAccuracy(rows: CountRow[], from: string, to: string, keep: (r: CountRow) => boolean = () => true): Accuracy {
  const lines = firstCounts(rows).filter((r) => r.day >= from && r.day <= to && keep(r))
  const matched = lines.filter((r) => r.counted === r.system).length
  return { lines: lines.length, matched, pct: lines.length ? Math.round((matched / lines.length) * 1000) / 10 : null }
}

const RANK: Record<CycleReason, number> = { recount: 0, never: 1, busy: 2, due: 2 }
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/**
 * แผนนับวันนี้: เลือกช่องที่มีของ วันละ ~1/20 ของทั้งหมด (5–30 ช่อง)
 * ลำดับ: ครั้งก่อนไม่ตรง → ยังไม่เคยนับ → เข้า-ออกบ่อย → นับนานที่สุด
 * คิดจากข้อมูลก่อนวันนี้เท่านั้น ทุกเครื่องจึงเห็นรายการเดียวกันทั้งวัน · ช่องที่มีแต่กล่องรับเข้าวันนี้ยังไม่ต้องนับ
 */
export function planCycleCount({ today, lpns, locations, activity, perDay }: { today: string; lpns: Lpn[]; locations: StorageLoc[]; activity: CycleActivity; perDay?: number }): CyclePlan {
  const storage = new Map(locations.filter((l) => l.active && (l.kind === 'bin' || l.kind === 'floor')).map((l) => [l.code, l]))
  const bySlot = new Map<string, Lpn[]>()
  for (const l of lpns)
    if (l.status === 'active' && storage.has(l.locationCode) && l.items.some((i) => i.qty > 0)) bySlot.set(l.locationCode, [...(bySlot.get(l.locationCode) ?? []), l])

  const first = firstCounts(activity.counts)
  const countedToday = new Set(first.filter((r) => r.day === today && r.itemId).map((r) => r.itemId!))
  const touchedToday = new Set(first.filter((r) => r.day === today && r.loc).map((r) => r.loc!))
  const last = new Map<string, { day: string; mismatch: boolean }>()
  for (const r of first) {
    if (!r.loc || r.day >= today) continue
    const cur = last.get(r.loc)
    const miss = r.counted !== r.system
    if (!cur || r.day > cur.day) last.set(r.loc, { day: r.day, mismatch: miss })
    else if (r.day === cur.day && miss) cur.mismatch = true
  }
  const moveFrom = addDays(today, -MOVE_WINDOW)
  const moves = new Map<string, number>()
  for (const m of activity.moves) if (m.day >= moveFrom && m.day < today) moves.set(m.loc, (moves.get(m.loc) ?? 0) + 1)

  const reasonOf = (code: string): CycleReason => {
    const l = last.get(code)
    return l?.mismatch ? 'recount' : !l ? 'never' : (moves.get(code) ?? 0) >= BUSY_MOVES ? 'busy' : 'due'
  }
  const slotOf = (code: string, reason: CycleReason | null): CycleSlot => {
    const boxes = (bySlot.get(code) ?? []).map((l) => {
      const items = l.items.filter((i) => i.qty > 0)
      return { lpnNo: l.lpnNo, items: items.length, counted: items.filter((i) => countedToday.has(i.id)).length }
    })
    const items = boxes.reduce((s, b) => s + b.items, 0)
    const counted = boxes.reduce((s, b) => s + b.counted, 0)
    return { code, zoneId: storage.get(code)!.zoneId, reason, boxes, items, counted, done: counted >= items, lastCounted: last.get(code)?.day ?? null, moves: moves.get(code) ?? 0 }
  }

  // ช่องที่มีของมาก่อนวันนี้ (กล่องรับเข้าวันนี้เพิ่งนับตอนรับ)
  const pool = [...bySlot].filter(([, boxes]) => boxes.some((b) => bangkokDay(b.createdAt) < today)).map(([code]) => code)
  const target = Math.min(pool.length, perDay ?? Math.min(CYCLE_MAX, Math.max(CYCLE_MIN, Math.ceil(pool.length / CYCLE_ROUND_DAYS))))
  const due = pool.filter((code) => {
    const l = last.get(code)
    return !l || l.mismatch || daysBetween(l.day, today) >= RECOUNT_AFTER
  })
  const planned = due
    .map((code) => ({ code, reason: reasonOf(code) }))
    .sort((a, b) => RANK[a.reason] - RANK[b.reason] || (moves.get(b.code) ?? 0) - (moves.get(a.code) ?? 0) || (last.get(a.code)?.day ?? '').localeCompare(last.get(b.code)?.day ?? '') || a.code.localeCompare(b.code))
    .slice(0, target)
    .map((p) => slotOf(p.code, p.reason))
  const inPlan = new Set(planned.map((s) => s.code))
  const extras = [...touchedToday].filter((c) => !inPlan.has(c) && bySlot.has(c)).sort().map((c) => slotOf(c, null))

  return {
    day: today,
    target,
    slots: [...planned.filter((s) => !s.done), ...planned.filter((s) => s.done), ...extras],
    done: planned.filter((s) => s.done).length,
    extra: extras.length,
    stocked: pool.length,
  }
}
