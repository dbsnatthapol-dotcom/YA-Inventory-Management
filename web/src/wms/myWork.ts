import { bangkokDay } from './ledger'
import { fmt } from './logic'
import type { Lpn, StorageLoc } from './types'

export interface WorkBox {
  lpnNo: string
  loc: string
  /** part × จำนวน */
  summary: string
  qty: number
  /** วันตั้งแต่รับเข้า */
  days: number
  model: string | null
}

export interface WorkQueues {
  /** ไม่ติด MI3 แล้ว แต่ยังอยู่จุดรับของ / พื้นที่ MI3 → จัดเก็บเข้าช่อง */
  putaway: WorkBox[]
  /** รอผลตรวจ MI3 */
  qi: WorkBox[]
  /** อยู่พื้นที่กัก NG → เบิก NG / ส่งคืน */
  ng: WorkBox[]
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/** งานที่ต้องทำกับกล่องในคลังตอนนี้ (เก่าสุดก่อน) */
export function workQueues(lpns: Lpn[], locations: StorageLoc[], today: string): WorkQueues {
  const kind = new Map(locations.map((l) => [l.code, l.kind]))
  const box = (l: Lpn): WorkBox => {
    const items = l.items.filter((i) => i.qty > 0)
    return {
      lpnNo: l.lpnNo,
      loc: l.locationCode,
      summary: items.map((i) => `${i.partNo} × ${fmt(i.qty)}`).join(' · '),
      qty: items.reduce((s, i) => s + i.qty, 0),
      days: Math.max(0, daysBetween(bangkokDay(l.createdAt), today)),
      model: l.modelCode ?? null,
    }
  }
  const active = lpns.filter((l) => l.status === 'active')
  const oldest = (a: WorkBox, b: WorkBox) => b.days - a.days || a.lpnNo.localeCompare(b.lpnNo)
  const at = (l: Lpn, ...kinds: StorageLoc['kind'][]) => kinds.includes(kind.get(l.locationCode) as StorageLoc['kind'])
  return {
    putaway: active.filter((l) => !l.hold && at(l, 'staging', 'hold')).map(box).sort(oldest),
    qi: active.filter((l) => l.hold).map(box).sort(oldest),
    ng: active.filter((l) => !l.hold && at(l, 'ng')).map(box).sort(oldest),
  }
}
