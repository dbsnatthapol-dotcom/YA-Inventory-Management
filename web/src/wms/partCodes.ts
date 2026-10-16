import type { FgItem, MasterData, PartMaster } from './types'

const norm = (s: string) => s.trim().toUpperCase()

/**
 * หา part จากรหัสที่พนักงานพิมพ์/สแกน: รหัสลูกค้าเต็ม (RAT00586/B), รหัสลูกค้าไม่มี revision (RAT00586 ตามที่เขียนใน FM-P-005)
 * หรือรหัสภายใน UAM (2011409) · ไม่มี revision แต่ตรงหลาย revision ⇒ ไม่เดา (คืน null)
 */
export function resolvePart(parts: PartMaster[], code: string): PartMaster | null {
  const c = norm(code)
  if (!c) return null
  const exact = parts.find((p) => norm(p.partNo) === c)
  if (exact) return exact
  const uam = parts.find((p) => p.uamCode && norm(p.uamCode) === c)
  if (uam) return uam
  if (!c.includes('/')) {
    const base = parts.filter((p) => norm(p.partNo).split('/')[0] === c)
    if (base.length === 1) return base[0]
  }
  return null
}

/** ลำดับกลุ่ม part ในใบเบิก (ตามลำดับประกอบวงล้อ) */
const TYPE_ORDER = ['HUB', 'RIM', 'ALLOY RIM', 'CAST', 'SPACER', 'SEAL', 'BEARING', 'SPOKE', 'NIPPLE', 'DISC', 'BOLT', 'VALVE', 'RIM TAPE', 'TYRE', 'TUBE', 'RUBBER', 'STICKER']
const typeRank = (t: string | null) => {
  const i = TYPE_ORDER.indexOf(t ?? '')
  return i < 0 ? TYPE_ORDER.length : i
}

/** part ของ Model เรียงตามกลุ่ม แล้วตามรหัส */
export const partsOfModel = (master: Pick<MasterData, 'parts'>, model: string) =>
  master.parts.filter((p) => p.models.includes(model)).sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.partNo.localeCompare(b.partNo))

/** ชุดวงล้อ (FG) ที่ใช้งานของ Model */
export const fgOfModel = (master: Pick<MasterData, 'fgItems'>, model: string) => master.fgItems.filter((f) => f.active && f.modelCode === model)

/** จำนวนเบิกต่อ part จากจำนวนวง × BOM */
export const bomQty = (fg: FgItem, wheels: number) => Object.fromEntries(fg.lines.map((l) => [l.partNo, Math.round(wheels * l.qtyPer)]))

/** ยอดในคลังต่อ part: total = ทั้งหมด (รวมรอ MI3), available = พร้อมเบิก */
export function stockByPart(lpns: { status: string; hold: boolean; items: { partNo: string; qty: number }[] }[]) {
  const map = new Map<string, { total: number; available: number }>()
  for (const l of lpns) {
    if (l.status !== 'active') continue
    for (const i of l.items) {
      const cur = map.get(i.partNo) ?? { total: 0, available: 0 }
      cur.total += i.qty
      if (!l.hold) cur.available += i.qty
      map.set(i.partNo, cur)
    }
  }
  return map
}
