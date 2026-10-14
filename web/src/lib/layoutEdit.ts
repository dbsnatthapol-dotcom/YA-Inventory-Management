import type { FactoryLayout, Floor, NavNode, Zone, ZoneKind } from '../types/layout'

/**
 * การแก้ผังโดยผู้ใช้ (ย้าย/หมุน/ปรับขนาด/เพิ่ม/ลบ rack และไลน์ประกอบ)
 * เก็บเป็นส่วนต่างจากผังหลัก เพื่อให้ผังหลักจาก Supabase เปลี่ยนได้โดยไม่ทับงานที่แก้ไว้
 */
export type ZonePatch = Partial<Pick<Zone, 'code' | 'name' | 'floorId' | 'x' | 'z' | 'width' | 'depth'>>

export interface LayoutEdits {
  changed: Record<string, ZonePatch>
  added: Zone[]
  removed: string[]
}

export const emptyEdits = (): LayoutEdits => ({ changed: {}, added: [], removed: [] })

/** ประเภทโซนที่ย้ายได้ (บันได ลิฟต์ และเต็นท์เป็นโครงสร้างอาคาร) */
export const EDITABLE_KINDS: ZoneKind[] = ['storage', 'assembly', 'receiving', 'inspection', 'ng', 'utility']
/** โซนที่เดินผ่านไม่ได้ ทางเดินที่ตัดผ่านจะถูกปิด */
export const OBSTACLE_KINDS: ZoneKind[] = ['storage', 'assembly', 'inspection', 'ng', 'utility']
export const SNAP = 0.5
const EPS = 0.05

export const isEditable = (zone: Zone, floor: Floor | undefined) => floor?.area === 'building' && EDITABLE_KINDS.includes(zone.kind)

export const snap = (v: number, step = SNAP) => Math.round(v / step) * step

type Rect = Pick<Zone, 'x' | 'z' | 'width' | 'depth'>

/** จำกัดตำแหน่งให้อยู่ในพื้นชั้น */
export function clampToFloor<T extends Rect>(zone: T, floor: Pick<Floor, 'width' | 'depth'>): T {
  const width = Math.min(zone.width, floor.width)
  const depth = Math.min(zone.depth, floor.depth)
  return {
    ...zone,
    width,
    depth,
    x: Math.min(Math.max(zone.x, 0), floor.width - width),
    z: Math.min(Math.max(zone.z, 0), floor.depth - depth),
  }
}

/** หมุน 90° รอบจุดกึ่งกลาง */
export function rotated<T extends Rect>(zone: T): T {
  return { ...zone, width: zone.depth, depth: zone.width, x: snap(zone.x + (zone.width - zone.depth) / 2), z: snap(zone.z + (zone.depth - zone.width) / 2) }
}

export const pointInRect = (x: number, z: number, r: Rect, pad = -EPS) =>
  x > r.x - pad && x < r.x + r.width + pad && z > r.z - pad && z < r.z + r.depth + pad

/** เส้นตรง a→b ตัดผ่านด้านในของสี่เหลี่ยมหรือไม่ (แตะขอบไม่นับ) — Liang–Barsky */
export function segmentHitsRect(ax: number, az: number, bx: number, bz: number, r: Rect): boolean {
  const [x0, x1, z0, z1] = [r.x + EPS, r.x + r.width - EPS, r.z + EPS, r.z + r.depth - EPS]
  const dx = bx - ax
  const dz = bz - az
  let t0 = 0
  let t1 = 1
  const checks: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dz, az - z0],
    [dz, z1 - az],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false
    } else {
      const t = q / p
      if (p < 0) t0 = Math.max(t0, t)
      else t1 = Math.min(t1, t)
      if (t0 > t1) return false
    }
  }
  return true
}

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.width - EPS && b.x < a.x + a.width - EPS && a.z < b.z + b.depth - EPS && b.z < a.z + a.depth - EPS

export const distanceToRect = (x: number, z: number, r: Rect) =>
  Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.width)), Math.max(r.z - z, 0, z - (r.z + r.depth)))

const geometryChanged = (p: ZonePatch | undefined) =>
  !!p && (p.x !== undefined || p.z !== undefined || p.width !== undefined || p.depth !== undefined || p.floorId !== undefined)

/**
 * สร้างผังที่ใช้งานจริง: ใส่การแก้ไข, ปิดทางเดินที่ถูก rack/ไลน์ประกอบขวาง
 * และหาจุดเข้า-ออกใหม่ (โหนดทางเดินที่ใกล้ขอบโซนที่สุด) ให้โซนที่ถูกย้ายหรือจุดเดิมถูกขวาง
 */
export function applyLayoutEdits(base: FactoryLayout, edits: LayoutEdits): FactoryLayout {
  const removed = new Set(edits.removed)
  const zones = base.zones
    .filter((z) => !removed.has(z.id))
    .map((z) => (edits.changed[z.id] ? { ...z, ...edits.changed[z.id] } : z))
    .concat(edits.added)

  const obstacles = zones.filter((z) => OBSTACLE_KINDS.includes(z.kind))
  const nodesById = new Map(base.nodes.map((n) => [n.id, n]))
  const insideObstacle = (n: NavNode) => obstacles.some((o) => o.floorId === n.floorId && pointInRect(n.x, n.z, o))

  const edges = base.edges.filter((e) => {
    if (e.mode !== 'walk') return true
    const a = nodesById.get(e.from)
    const b = nodesById.get(e.to)
    if (!a || !b || a.floorId !== b.floorId) return true
    return !obstacles.some((o) => o.floorId === a.floorId && segmentHitsRect(a.x, a.z, b.x, b.z, o))
  })

  // โหนดที่ยังเดินถึงได้ และไม่ใช่จุดเข้าบันได/ลิฟต์
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const coreNodes = new Set(zones.filter((z) => z.kind === 'stairs' || z.kind === 'lift').map((z) => z.accessNodeId))
  const usable = (n: NavNode) => linked.has(n.id) && !coreNodes.has(n.id) && !insideObstacle(n)
  const added = new Set(edits.added.map((z) => z.id))

  const resolved = zones.map((zone) => {
    // บันได ลิฟต์ และเต็นท์ใช้จุดเข้า-ออกตามผังหลักเสมอ
    if (!EDITABLE_KINDS.includes(zone.kind)) return zone
    const current = nodesById.get(zone.accessNodeId)
    const stale = !current || current.floorId !== zone.floorId || !usable(current)
    if (!stale && !added.has(zone.id) && !geometryChanged(edits.changed[zone.id])) return zone
    const best = nearestAccessNode(zone, base.nodes.filter((n) => n.floorId === zone.floorId && usable(n)))
    return best ? { ...zone, accessNodeId: best.id } : zone
  })

  return { ...base, zones: resolved, edges }
}

export function nearestAccessNode(zone: Rect, nodes: NavNode[]): NavNode | undefined {
  const cx = zone.x + zone.width / 2
  const cz = zone.z + zone.depth / 2
  let best: NavNode | undefined
  let bestScore = Infinity
  for (const n of nodes) {
    // ระยะถึงขอบโซนเป็นหลัก ใช้ระยะถึงกึ่งกลางตัดสินเมื่อเท่ากัน
    const score = distanceToRect(n.x, n.z, zone) * 1000 + Math.hypot(n.x - cx, n.z - cz)
    if (score < bestScore) {
      bestScore = score
      best = n
    }
  }
  return best
}

export interface ZoneIssue {
  level: 'error' | 'warn'
  text: string
}

/** ตรวจโซนหลังแก้: ทับโซนอื่น / ล้นพื้น / ไม่มีทางเดินเข้าถึง */
export function zoneIssues(layout: FactoryLayout, zone: Zone): ZoneIssue[] {
  const issues: ZoneIssue[] = []
  const floor = layout.floors.find((f) => f.id === zone.floorId)
  if (floor && (zone.x < 0 || zone.z < 0 || zone.x + zone.width > floor.width + EPS || zone.z + zone.depth > floor.depth + EPS))
    issues.push({ level: 'error', text: 'เกินขอบพื้นชั้น' })
  const overlaps = layout.zones.filter((z) => z.id !== zone.id && z.floorId === zone.floorId && rectsOverlap(z, zone))
  if (overlaps.length) issues.push({ level: 'error', text: `ทับกับ ${overlaps.map((z) => z.code).join(', ')}` })
  const access = layout.nodes.find((n) => n.id === zone.accessNodeId)
  if (!access || access.floorId !== zone.floorId) issues.push({ level: 'error', text: 'ไม่มีทางเดินเข้าถึง' })
  else {
    const gap = distanceToRect(access.x, access.z, zone)
    if (gap > 6) issues.push({ level: 'warn', text: `ห่างทางเดินหลัก ${gap.toFixed(1)} ม.` })
  }
  return issues
}

const KIND_PREFIX: Partial<Record<ZoneKind, { id: string; code: string; name: string; size: [number, number] }>> = {
  storage: { id: 'RK', code: 'RK-N', name: 'Rack ใหม่', size: [13.5, 6.1] },
  assembly: { id: 'ASM', code: 'ASM-N', name: 'ไลน์ประกอบใหม่', size: [24, 8] },
  inspection: { id: 'QC', code: 'QC-N', name: 'พื้นที่ตรวจ QC', size: [9, 7] },
  ng: { id: 'NG', code: 'NG-N', name: 'พื้นที่กัก NG', size: [8, 6] },
  utility: { id: 'UT', code: 'UT-N', name: 'ที่ชาร์จรถยก / พาเลทเปล่า', size: [9, 6] },
}

export type NewZoneKind = 'storage' | 'assembly' | 'inspection' | 'ng' | 'utility'

/** สร้างโซนใหม่ วางในช่องว่างแรกที่ไม่ทับโซนอื่น (ไล่จากด้านหลังอาคาร) */
export function newZone(kind: NewZoneKind, floor: Floor, zones: Zone[]): Zone {
  const meta = KIND_PREFIX[kind]!
  let n = 1
  while (zones.some((z) => z.id === `${floor.id}-${meta.id}-U${n}` || z.code === `${meta.code}${n}`)) n++
  const [width, depth] = meta.size
  const others = zones.filter((z) => z.floorId === floor.id)
  let spot = { x: snap((floor.width - width) / 2), z: snap((floor.depth - depth) / 2) }
  search: for (let z = 1; z + depth <= floor.depth - 1; z += 1)
    for (let x = 1; x + width <= floor.width - 1; x += 1)
      if (!others.some((o) => rectsOverlap(o, { x: x - 1, z: z - 1, width: width + 2, depth: depth + 2 }))) {
        spot = { x, z }
        break search
      }
  return {
    id: `${floor.id}-${meta.id}-U${n}`,
    code: `${meta.code}${n}`,
    name: `${meta.name} ${n}`,
    floorId: floor.id,
    kind,
    ...spot,
    width,
    depth,
    accessNodeId: '',
    ...(kind === 'storage' ? { stores: ['Component'] } : {}),
  }
}

/** รวมการแก้ไขใหม่เข้ากับของเดิม (โซนที่เพิ่มเองแก้ในรายการ added โดยตรง) */
export function withPatch(edits: LayoutEdits, id: string, patch: ZonePatch): LayoutEdits {
  if (edits.added.some((z) => z.id === id)) return { ...edits, added: edits.added.map((z) => (z.id === id ? { ...z, ...patch } : z)) }
  return { ...edits, changed: { ...edits.changed, [id]: { ...edits.changed[id], ...patch } } }
}

export function withRemoved(edits: LayoutEdits, id: string): LayoutEdits {
  if (edits.added.some((z) => z.id === id)) return { ...edits, added: edits.added.filter((z) => z.id !== id) }
  const changed = { ...edits.changed }
  delete changed[id]
  return { ...edits, changed, removed: [...new Set([...edits.removed, id])] }
}

export const editCount = (e: LayoutEdits) => Object.keys(e.changed).length + e.added.length + e.removed.length
