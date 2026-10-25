import type { FgItem, MasterData, PartMaster } from './types'

const norm = (s: string) => s.trim().toUpperCase()

/** เลขฐานของรหัสลูกค้า: ตัด revision หลัง / ออก ('rat00586/b' → 'RAT00586') */
export const basePartNo = (code: string) => norm(code).split('/')[0]

/** revision ที่พิมพ์มา ('RAT00586/B' → 'B') */
export const partRevision = (code: string) => norm(code).split('/').slice(1).join('/') || null

/** เลขฐานไม่สนเลข 0 นำหน้าตัวเลข ('RAT1088' กับ 'RAT01088' ถือว่าใกล้กัน) */
const loose = (code: string) => basePartNo(code).replace(/(\D)0+(?=\d)/g, '$1')

/**
 * รหัสที่ใช้ในระบบ (ตรงกับ part_canon ฝั่งฐานข้อมูล): ตรงตัว → เลขฐาน → part เดียวที่เลขฐานตรงกัน → เลขฐาน
 * ระบบยึดเลขฐาน (/A /B เป็นแค่ revision) ยกเว้นเลขฐานที่มีหลาย part ยังแยกด้วย revision
 */
export function canonPartNo(parts: Pick<PartMaster, 'partNo'>[], code: string): string {
  const c = norm(code)
  if (!c) return ''
  if (parts.some((p) => p.partNo === c)) return c
  const base = basePartNo(c)
  if (parts.some((p) => p.partNo === base)) return base
  const same = parts.filter((p) => basePartNo(p.partNo) === base)
  return same.length === 1 ? same[0].partNo : base
}

/** แปลงรหัสชุดหนึ่งเป็นเลขฐาน · เลขฐานที่มาจากหลายรหัส (เป็นคนละ part) คงรหัสเต็มไว้ */
export function canonCodes(codes: string[]): Map<string, string> {
  const byBase = new Map<string, Set<string>>()
  for (const c of codes) byBase.set(basePartNo(c), (byBase.get(basePartNo(c)) ?? new Set()).add(norm(c)))
  return new Map(codes.map((c) => [c, byBase.get(basePartNo(c))!.size > 1 ? norm(c) : basePartNo(c)]))
}

/**
 * หา part จากรหัสที่พนักงานพิมพ์/สแกน: รหัสลูกค้ามีหรือไม่มี revision (RAT00586/B, RAT00586) หรือรหัส UAM (2011409)
 * สุดท้ายลองแบบไม่สนเลข 0 นำหน้า (RAT1088 → RAT01088) · ตรงหลาย part ⇒ ไม่เดา (คืน null)
 */
export function resolvePart(parts: PartMaster[], code: string): PartMaster | null {
  const c = norm(code)
  if (!c) return null
  const canon = canonPartNo(parts, c)
  const exact = parts.find((p) => p.partNo === canon)
  if (exact) return exact
  const uam = parts.find((p) => p.uamCode && norm(p.uamCode) === c)
  if (uam) return uam
  const fuzzy = parts.filter((p) => loose(p.partNo) === loose(c))
  return fuzzy.length === 1 ? fuzzy[0] : null
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

/**
 * ยอดในคลังต่อ part: total = ทั้งหมด (รวมรอ MI3 และพื้นที่ NG), available = พร้อมเบิกเข้าไลน์
 * (ไม่รวมรอ MI3 และกล่องในพื้นที่กัก NG · กติกาเดียวกับ wms_issue_fifo)
 */
export function stockByPart(lpns: { status: string; hold: boolean; locationCode: string; items: { partNo: string; qty: number }[] }[], isNgLoc: (code: string) => boolean = () => false) {
  const map = new Map<string, { total: number; available: number }>()
  for (const l of lpns) {
    if (l.status !== 'active') continue
    const usable = !l.hold && !isNgLoc(l.locationCode)
    for (const i of l.items) {
      const cur = map.get(i.partNo) ?? { total: 0, available: 0 }
      cur.total += i.qty
      if (usable) cur.available += i.qty
      map.set(i.partNo, cur)
    }
  }
  return map
}
