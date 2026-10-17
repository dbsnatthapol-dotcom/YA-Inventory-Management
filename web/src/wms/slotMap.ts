import { RACK, type StoragePlan } from '../data/warehouse'
import type { FactoryLayout, Zone } from '../types/layout'
import { pad, tentBlocks, zonePlan } from './locations'
import { zoneLocator } from './mapStock'
import type { Lpn, MasterData } from './types'

/** สถานะช่องเก็บบนผังคลัง: ว่าง / มีของ / มีของรอตรวจ MI3 / ปิดใช้ (ชำรุด ห้ามวาง) */
export type SlotStatus = 'empty' | 'stock' | 'hold' | 'blocked'

export const SLOT_STATUS: SlotStatus[] = ['empty', 'stock', 'hold', 'blocked']

export const SLOT_LABEL: Record<SlotStatus, string> = {
  empty: 'ว่าง',
  stock: 'มีของ',
  hold: 'รอตรวจ MI3',
  blocked: 'ปิดใช้',
}

/** กล่อง 1 ป้าย (LPN) ในช่องเก็บ */
export interface SlotBox {
  lpnNo: string
  location: string
  model: string
  qty: number
  /** รอตรวจ MI3 (ยังเบิกไม่ได้) */
  hold: boolean
  items: { partNo: string; name: string; qty: number }[]
  grnNo: string | null
  createdAt: string
}

/** ช่องเก็บ 1 ช่อง = 1 รหัสช่อง (เช่น RK-A-01-2 = ที่วางที่ 1 ชั้น 2) */
export interface Slot {
  code: string
  /** ชั้น (1 = ล่าง) · ช่องพิเศษ/เต็นท์ = 1 */
  level: number
  boxes: SlotBox[]
  qty: number
  /** ปิดใช้จากหลังบ้าน (ถ้ายังมีของอยู่ สถานะยังเป็นมีของ) */
  blocked: boolean
  status: SlotStatus
}

/** ที่วาง 1 จุดบนพื้น (ซ้อนได้หลายชั้น) · เต็นท์ = บล็อก */
export interface Spot {
  /** ลำดับที่วางในโซน (เลขกลางของรหัสช่อง) */
  spot: number
  /** กรอบบนผัง (พิกัดภายในชั้น, มุมซ้ายบน + ขนาด) */
  x: number
  z: number
  w: number
  d: number
  /** แถวพาเลท (หน้า rack) และลำดับในแถว สำหรับมุมมองหน้า rack */
  face: number
  col: number
  /** ช่องแต่ละชั้น: index 0 = ชั้น 1 */
  levels: Slot[]
}

export interface ZoneSlots {
  zoneId: string
  floorId: string
  kind: 'rack' | 'floor' | 'tent' | 'area'
  spots: Spot[]
  /** แถวพาเลท: จำนวนที่วางในแต่ละแถว */
  faces: number[]
  levels: number
  /** ช่องพิเศษที่เพิ่มในหลังบ้าน (ไม่อยู่ในผัง) */
  extra: Slot[]
  /** กล่องในโซนที่ไม่อยู่ในช่องของผัง: จุดรับเข้า / MI3 / NG หรือรหัสช่องที่ผังไม่มีแล้ว */
  loose: SlotBox[]
  counts: Record<SlotStatus, number>
  boxes: number
  qty: number
  holdBoxes: number
}

export interface SlotMap {
  zones: Map<string, ZoneSlots>
  /** ป้ายกล่อง → โซน / ช่องที่อยู่ */
  where: Map<string, { zoneId: string; code: string; spot: number | null; level: number | null }>
  /** กล่องที่รหัสช่องไม่ตรงกับโซนใดบนผัง */
  unknown: SlotBox[]
}

/** ขนาดพาเลท 1 ที่บนผัง: ตามแนวยาว (ครึ่ง bay) × ตามแนวสั้น (ความลึก rack แถวเดี่ยว) */
const SPOT_LONG = RACK.bayLength / RACK.palletsPerBay
const SPOT_SHORT = RACK.singleDepth

/** ที่วางพาเลทตามลำดับเดียวกับรหัสช่อง (แถว → ฝั่ง → bay → พาเลท) ตัดตามจำนวนที่วางต่อชั้น */
export function planSpots(plan: Pick<StoragePlan, 'rows' | 'bays' | 'start' | 'perLevel'>) {
  const out: { u: number; v: number; face: number; col: number }[] = []
  let face = 0
  for (const row of plan.rows)
    for (let unit = 0; unit < row.units; unit++, face++)
      for (let b = 0; b < plan.bays; b++)
        for (let p = 0; p < RACK.palletsPerBay; p++)
          out.push({
            u: plan.start + b * RACK.bayLength + ((p + 0.5) * RACK.bayLength) / RACK.palletsPerBay,
            v: row.offset + (unit + 0.5) * RACK.singleDepth,
            face,
            col: b * RACK.palletsPerBay + p,
          })
  return out.slice(0, plan.perLevel)
}

const statusOf = (boxes: SlotBox[], blocked: boolean): SlotStatus =>
  boxes.length ? (boxes.some((b) => b.hold) ? 'hold' : 'stock') : blocked ? 'blocked' : 'empty'

const zoneKind = (zone: Zone, plan: StoragePlan | null): ZoneSlots['kind'] =>
  zone.kind === 'tent' ? 'tent' : zone.kind === 'storage' ? (plan?.type === 'rack' ? 'rack' : 'floor') : 'area'

/**
 * ผังคลังรายช่อง: ช่องตามผัง (ที่วาง × ชั้น / บล็อกเต็นท์) + สถานะจากกล่องที่อยู่จริงและช่องที่ปิดในหลังบ้าน
 * รหัสช่องตรงกับ layoutLocations (RK-A-01-1, TENT-T-01) — ผังเป็นเจ้าของจำนวนช่อง หลังบ้านปิด/เพิ่มช่องพิเศษ
 */
export function buildSlotMap(layout: Pick<FactoryLayout, 'zones' | 'floors'>, lpns: Lpn[], master: Pick<MasterData, 'locations' | 'parts'>): SlotMap {
  const parts = new Map(master.parts.map((p) => [p.partNo, p]))
  const locs = new Map(master.locations.map((l) => [l.code, l]))

  // กล่องที่ยังมีของ แยกตามรหัสช่อง (เข้าก่อนอยู่บน)
  const at = new Map<string, SlotBox[]>()
  for (const l of lpns) {
    if (l.status !== 'active') continue
    const items = l.items.filter((i) => i.qty > 0).map((i) => ({ partNo: i.partNo, name: parts.get(i.partNo)?.name ?? '', qty: i.qty }))
    if (!items.length) continue
    const box: SlotBox = {
      lpnNo: l.lpnNo,
      location: l.locationCode,
      model: l.modelCode || parts.get(items[0].partNo)?.models[0] || '–',
      qty: items.reduce((s, i) => s + i.qty, 0),
      hold: l.hold,
      items,
      grnNo: l.grnNo ?? null,
      createdAt: l.createdAt,
    }
    at.set(l.locationCode, [...(at.get(l.locationCode) ?? []), box])
  }
  for (const list of at.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lpnNo.localeCompare(b.lpnNo))

  const used = new Set<string>()
  const where: SlotMap['where'] = new Map()
  const slot = (zoneId: string, code: string, level: number, spot: number | null): Slot => {
    used.add(code)
    const loc = locs.get(code)
    const blocked = !!loc && (loc.blocked === true || !loc.active)
    const boxes = at.get(code) ?? []
    for (const b of boxes) where.set(b.lpnNo, { zoneId, code, spot, level: spot === null ? null : level })
    return { code, level, boxes, qty: boxes.reduce((s, b) => s + b.qty, 0), blocked, status: statusOf(boxes, blocked) }
  }

  const zones = new Map<string, ZoneSlots>()
  for (const zone of layout.zones) {
    const plan = zone.kind === 'storage' ? zonePlan(layout, zone) : null
    const spots: Spot[] = []
    let levels = 1
    if (plan) {
      levels = plan.levels.length
      const alongX = zone.width >= zone.depth
      planSpots(plan).forEach((s, i) => {
        const [cx, cz] = alongX ? [zone.x + s.u, zone.z + s.v] : [zone.x + s.v, zone.z + s.u]
        const [w, d] = alongX ? [SPOT_LONG, SPOT_SHORT] : [SPOT_SHORT, SPOT_LONG]
        const n = i + 1
        spots.push({
          spot: n,
          x: cx - w / 2,
          z: cz - d / 2,
          w,
          d,
          face: s.face,
          col: s.col,
          levels: Array.from({ length: levels }, (_, l) => slot(zone.id, `${zone.code}-${pad(n)}-${l + 1}`, l + 1, n)),
        })
      })
    } else if (zone.kind === 'tent') {
      const blocks = tentBlocks(zone)
      const alongX = zone.width >= zone.depth
      const seg = Math.max(zone.width, zone.depth) / blocks
      for (let b = 1; b <= blocks; b++) {
        const off = (b - 1) * seg
        spots.push({
          spot: b,
          ...(alongX ? { x: zone.x + off, z: zone.z, w: seg, d: zone.depth } : { x: zone.x, z: zone.z + off, w: zone.width, d: seg }),
          face: 0,
          col: b - 1,
          levels: [slot(zone.id, `${zone.code}-${pad(b)}`, 1, b)],
        })
      }
    }
    const faces: number[] = []
    for (const s of spots) faces[s.face] = (faces[s.face] ?? 0) + 1
    zones.set(zone.id, {
      zoneId: zone.id,
      floorId: zone.floorId,
      kind: zoneKind(zone, plan),
      spots,
      faces,
      levels,
      extra: [],
      loose: [],
      counts: { empty: 0, stock: 0, hold: 0, blocked: 0 },
      boxes: 0,
      qty: 0,
      holdBoxes: 0,
    })
  }

  // ช่องพิเศษจากหลังบ้าน (ช่องจุดรับเข้า / MI3 / NG ที่ชื่อเดียวกับโซน นับเป็นกล่องในพื้นที่)
  const zoneCodes = new Set(layout.zones.map((z) => z.code))
  for (const loc of master.locations) {
    const zs = zones.get(loc.zoneId)
    // ช่องที่ผังไม่มีแล้ว (ไม่ใช่ช่องพิเศษ): ของที่ยังค้างอยู่แสดงเป็นกล่องนอกช่อง
    if (!zs || !loc.manual || used.has(loc.code) || zoneCodes.has(loc.code)) continue
    zs.extra.push(slot(zs.zoneId, loc.code, 1, null))
  }
  for (const zs of zones.values()) zs.extra.sort((a, b) => a.code.localeCompare(b.code))

  // กล่องนอกช่องของผัง → โซนตามรหัสช่อง / รหัสโซน
  const zoneOf = zoneLocator(master, layout)
  const unknown: SlotBox[] = []
  for (const [code, boxes] of at) {
    if (used.has(code)) continue
    const zs = zones.get(zoneOf(code) ?? '')
    for (const b of boxes) {
      if (zs) {
        zs.loose.push(b)
        where.set(b.lpnNo, { zoneId: zs.zoneId, code, spot: null, level: null })
      } else unknown.push(b)
    }
  }

  for (const zs of zones.values()) {
    const all = [...zs.spots.flatMap((s) => s.levels), ...zs.extra]
    for (const s of all) zs.counts[s.status]++
    const boxes = [...all.flatMap((s) => s.boxes), ...zs.loose]
    zs.boxes = boxes.length
    zs.qty = boxes.reduce((s, b) => s + b.qty, 0)
    zs.holdBoxes = boxes.filter((b) => b.hold).length
  }
  return { zones, where, unknown }
}

/** ที่วางบนผังที่จุด (x, z) อยู่ (เผื่อขอบ 0.15 ม. สำหรับแตะบนมือถือ) */
export function spotAt(zs: ZoneSlots, x: number, z: number, slack = 0.15): Spot | null {
  let best: Spot | null = null
  let bestDist = Infinity
  for (const s of zs.spots) {
    const dx = Math.max(s.x - x, 0, x - (s.x + s.w))
    const dz = Math.max(s.z - z, 0, z - (s.z + s.d))
    const dist = Math.hypot(dx, dz)
    if (dist <= slack && dist < bestDist) {
      best = s
      bestDist = dist
    }
  }
  return best
}

/** หาช่องจากรหัส (ในที่วางของผัง หรือช่องพิเศษ) */
export function findSlot(zs: ZoneSlots, code: string): { slot: Slot; spot: Spot | null } | null {
  for (const s of zs.spots) {
    const hit = s.levels.find((l) => l.code === code)
    if (hit) return { slot: hit, spot: s }
  }
  const extra = zs.extra.find((l) => l.code === code)
  return extra ? { slot: extra, spot: null } : null
}

/** รวมสถานะช่องของหลายโซน (เช่น ทั้งชั้น) */
export function sumCounts(list: ZoneSlots[]) {
  const counts: Record<SlotStatus, number> = { empty: 0, stock: 0, hold: 0, blocked: 0 }
  for (const zs of list) for (const k of SLOT_STATUS) counts[k] += zs.counts[k]
  return {
    counts,
    slots: SLOT_STATUS.reduce((s, k) => s + counts[k], 0),
    boxes: list.reduce((s, z) => s + z.boxes, 0),
    qty: list.reduce((s, z) => s + z.qty, 0),
  }
}
