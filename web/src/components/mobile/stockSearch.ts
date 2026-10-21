import type { FactoryLayout } from '../../types/layout'
import { lpnFromScan } from '../../wms/logic'
import { zoneLocator } from '../../wms/mapStock'
import { basePartNo } from '../../wms/partCodes'
import type { Lpn, MasterData } from '../../wms/types'

export interface StockBox {
  lpnNo: string
  partNo: string
  qty: number
  location: string
  zoneId: string | null
  hold: boolean
  caseNo?: string | null
}

export interface StockHit {
  kind: 'lpn' | 'part' | 'place' | 'doc'
  key: string
  title: string
  subtitle?: string
  /** โซนที่จะเปิดบนผัง (ของอยู่หลายโซน = ไม่มี) */
  zoneId: string | null
  qty: number
  boxes: StockBox[]
}

const MAX_PLACES = 10
const MAX_PARTS = 20

/** จำนวนกล่องจริง (กล่องรวมหลาย part มีหลายแถวใน boxes) */
export const boxCount = (boxes: StockBox[]) => new Set(boxes.map((b) => b.lpnNo)).size

/**
 * ค้นของในคลังจากกล่องที่ยัง active: เลขป้าย (หรือข้อความจาก QR) → กล่องนั้น,
 * รหัสช่อง/โซน → ของในที่นั้น, Part No./ชื่อ part → ทุกกล่องที่มี part นั้น
 */
export function searchStock(query: string, lpns: Lpn[], master: Pick<MasterData, 'locations' | 'parts'>, layout: Pick<FactoryLayout, 'zones'>): StockHit[] {
  const t = query.trim().toUpperCase()
  if (t.length < 2) return []
  const zoneByLoc = new Map(master.locations.map((l) => [l.code, l.zoneId]))
  const zoneOf = zoneLocator(master, layout)
  const zoneName = (id: string | null) => layout.zones.find((z) => z.id === id)?.name
  const boxes: StockBox[] = lpns.flatMap((l) =>
    l.items.filter((i) => i.qty > 0).map((i) => ({ lpnNo: l.lpnNo, partNo: i.partNo, qty: i.qty, location: l.locationCode, zoneId: zoneOf(l.locationCode), hold: l.hold, caseNo: l.caseNo ?? null })),
  )
  const sum = (list: StockBox[]) => list.reduce((s, b) => s + b.qty, 0)
  const hits: StockHit[] = []

  // 1) ป้ายกล่อง
  const lpn = lpns.find((l) => l.lpnNo === lpnFromScan(t))
  if (lpn) {
    const own = boxes.filter((b) => b.lpnNo === lpn.lpnNo)
    const zoneId = zoneOf(lpn.locationCode)
    hits.push({ kind: 'lpn', key: lpn.lpnNo, title: lpn.lpnNo, subtitle: `อยู่ที่ ${lpn.locationCode}${zoneName(zoneId) ? ` · ${zoneName(zoneId)}` : ''}`, zoneId, qty: sum(own), boxes: own })
    return hits
  }

  // 2) เลข Packing List และ/หรือเลขเคส (ป้ายของผู้ส่งที่ติดมากับของ) เช่น "4957872317", "P-12", "4957872317 P-12"
  const [first, second] = t.split(/\s+/)
  const byDoc = lpns.filter((l) =>
    second ? l.plRef?.toUpperCase() === first && l.caseNo?.toUpperCase() === second : l.plRef?.toUpperCase() === first || l.caseNo?.toUpperCase() === first,
  )
  if (byDoc.length) {
    const nos = new Set(byDoc.map((l) => l.lpnNo))
    const own = boxes.filter((b) => nos.has(b.lpnNo)).sort((a, b) => a.location.localeCompare(b.location))
    const zones = new Set(own.map((b) => b.zoneId))
    const isPl = !second && byDoc.some((l) => l.plRef?.toUpperCase() === first)
    const cases = new Set(byDoc.map((l) => l.caseNo).filter(Boolean)).size
    const refs = [...new Set(byDoc.map((l) => l.plRef).filter(Boolean))]
    hits.push({
      kind: 'doc',
      key: t,
      title: second ? `PL ${first} · เคส ${second}` : isPl ? `PL ${first}` : `เคส ${first}`,
      subtitle: second ? undefined : isPl ? (cases ? `${cases} เคส` : undefined) : refs.length ? `PL ${refs.join(', ')}` : undefined,
      zoneId: zones.size === 1 ? [...zones][0] : null,
      qty: sum(own),
      boxes: own,
    })
  }

  // 3) ช่องเก็บ หรือโซน
  if (zoneByLoc.has(t) && !layout.zones.some((z) => z.code === t)) {
    const own = boxes.filter((b) => b.location === t)
    const zoneId = zoneOf(t)
    hits.push({ kind: 'place', key: t, title: t, subtitle: zoneName(zoneId), zoneId, qty: sum(own), boxes: own })
  } else {
    // รหัสโซนขึ้นต้นด้วยคำค้น หรือชื่อโซนมีคำค้น (เช่น "เต็นท์ยาง")
    for (const z of layout.zones.filter((z) => z.code.toUpperCase().startsWith(t) || z.name.toUpperCase().includes(t)).slice(0, MAX_PLACES)) {
      const own = boxes.filter((b) => b.zoneId === z.id)
      if (own.length || z.code.toUpperCase() === t) hits.push({ kind: 'place', key: z.id, title: z.code, subtitle: z.name, zoneId: z.id, qty: sum(own), boxes: own })
    }
  }

  // 4) Part (มีของก่อน แล้วตามด้วย part ใน Master ที่ยังไม่มีของ)
  const names = new Map(master.parts.map((p) => [p.partNo, p.name]))
  const uams = new Map(master.parts.map((p) => [p.partNo, p.uamCode ?? '']))
  const partNos = new Set([...boxes.map((b) => b.partNo), ...master.parts.map((p) => p.partNo)])
  // พิมพ์มาพร้อม revision (RAT00586/B) ก็หาเจอ · ค้นด้วยรหัส UAM ได้
  const base = basePartNo(t)
  const parts = [...partNos]
    .filter((p) => p.toUpperCase().includes(t) || (base && p.toUpperCase().includes(base)) || (names.get(p) ?? '').toUpperCase().includes(t) || uams.get(p) === t)
    .map((p) => ({ partNo: p, own: boxes.filter((b) => b.partNo === p) }))
    .sort((a, b) => b.own.length - a.own.length || a.partNo.localeCompare(b.partNo))
    .slice(0, MAX_PARTS)
  for (const { partNo, own } of parts) {
    const zones = new Set(own.map((b) => b.zoneId))
    hits.push({
      kind: 'part',
      key: partNo,
      title: partNo,
      subtitle: names.get(partNo),
      zoneId: zones.size === 1 ? [...zones][0] : null,
      qty: sum(own),
      boxes: [...own].sort((a, b) => a.location.localeCompare(b.location)),
    })
  }
  return hits
}
