import type { FactoryLayout, Floor, NavEdge, NavNode, Zone, ZoneKind } from '../types/layout'
import { buildingOf, toLocal, toSite } from './geometry'

/**
 * การแก้ผังโดยผู้ใช้ (ย้าย/หมุน/ปรับขนาด/เพิ่ม/ลบ rack และไลน์ประกอบ)
 * เก็บเป็นส่วนต่างจากผังหลัก เพื่อให้ผังหลักจาก Supabase เปลี่ยนได้โดยไม่ทับงานที่แก้ไว้
 */
export type ZonePatch = Partial<Pick<Zone, 'code' | 'name' | 'floorId' | 'x' | 'z' | 'width' | 'depth' | 'storage' | 'levels' | 'slotsPerLevel'>>

export interface LayoutEdits {
  changed: Record<string, ZonePatch>
  added: Zone[]
  removed: string[]
}

export const emptyEdits = (): LayoutEdits => ({ changed: {}, added: [], removed: [] })

/** ประเภทโซนที่ย้ายได้ (เต็นท์เป็นโครงสร้างลานนอก แก้ไม่ได้) */
export const EDITABLE_KINDS: ZoneKind[] = ['storage', 'assembly', 'receiving', 'inspection', 'ng', 'utility', 'stairs', 'lift']
/** บันได/ลิฟต์: เชื่อมชั้นกับชั้นถัดไปที่อยู่ตรงกัน */
export const CORE_KINDS: ZoneKind[] = ['stairs', 'lift']
const isCore = (z: Zone) => CORE_KINDS.includes(z.kind)
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

/** ส่วนของทางเดินที่ต้องบันทึกเพิ่มเมื่อย้าย/เพิ่ม/ลบบันไดหรือลิฟต์ */
export interface NavChanges {
  /** จุดเข้าบันได/ลิฟต์ที่สร้างใหม่ (รหัส <โซน>-AC) */
  nodes: NavNode[]
  addEdges: NavEdge[]
  /** ทางเดิน/ทางขึ้น-ลงเดิมของบันได/ลิฟต์ที่ถูกย้ายหรือลบ */
  dropEdges: NavEdge[]
}

/**
 * สร้างผังที่ใช้งานจริง: ใส่การแก้ไข, ปิดทางเดินที่ถูก rack/ไลน์ประกอบขวาง
 * และหาจุดเข้า-ออกใหม่ (โหนดทางเดินที่ใกล้ขอบโซนที่สุด) ให้โซนที่ถูกย้ายหรือจุดเดิมถูกขวาง
 */
export function applyLayoutEdits(base: FactoryLayout, edits: LayoutEdits): FactoryLayout {
  return editLayout(base, edits).layout
}

/**
 * applyLayoutEdits พร้อมส่วนต่างของทางเดิน
 * บันได/ลิฟต์ที่ถูกย้าย เพิ่ม หรือลบ: ตัดทางเดินและทางขึ้น-ลงเดิม สร้างจุดเข้าใหม่ที่ขอบโซน (ต่อกับทางเดินที่ใกล้สุด)
 * แล้วต่อขึ้น-ลงกับบันได/ลิฟต์ที่วางตรงกันในชั้นบน-ล่าง
 */
export function editLayout(base: FactoryLayout, edits: LayoutEdits): { layout: FactoryLayout; nav: NavChanges } {
  const removed = new Set(edits.removed)
  const zones = base.zones
    .filter((z) => !removed.has(z.id))
    .map((z) => (edits.changed[z.id] ? { ...z, ...edits.changed[z.id] } : z))
    .concat(edits.added)
  const added = new Set(edits.added.map((z) => z.id))
  const moved = zones.filter((z) => isCore(z) && (added.has(z.id) || geometryChanged(edits.changed[z.id])))
  const movedIds = new Set(moved.map((z) => z.id))
  const accessId = (z: Zone) => `${z.id}-AC`
  const staleNodes = new Set([
    ...base.zones.filter((z) => isCore(z) && (removed.has(z.id) || movedIds.has(z.id))).map((z) => z.accessNodeId),
    ...moved.map(accessId),
  ])
  const coreNodes = new Set([...base.zones.filter(isCore).map((z) => z.accessNodeId), ...moved.map(accessId)])

  const obstacles = zones.filter((z) => OBSTACLE_KINDS.includes(z.kind))
  const nodesById = new Map(base.nodes.map((n) => [n.id, n]))
  const insideObstacle = (n: NavNode) => obstacles.some((o) => o.floorId === n.floorId && pointInRect(n.x, n.z, o))

  const dropEdges: NavEdge[] = []
  const edges = base.edges.filter((e) => {
    if (staleNodes.has(e.from) || staleNodes.has(e.to)) {
      dropEdges.push(e)
      return false
    }
    if (e.mode !== 'walk') return true
    const a = nodesById.get(e.from)
    const b = nodesById.get(e.to)
    if (!a || !b || a.floorId !== b.floorId) return true
    return !obstacles.some((o) => o.floorId === a.floorId && segmentHitsRect(a.x, a.z, b.x, b.z, o))
  })

  // โหนดที่ยังเดินถึงได้ และไม่ใช่จุดเข้าบันได/ลิฟต์
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const usable = (n: NavNode) => linked.has(n.id) && !coreNodes.has(n.id) && !insideObstacle(n)
  const aisles = base.nodes.filter(usable)

  const newNodes: NavNode[] = []
  const addEdges: NavEdge[] = []
  const resolved = zones.map((zone) => {
    if (movedIds.has(zone.id)) {
      // จุดเข้าใหม่ที่ขอบโซนด้านที่ใกล้ทางเดิน
      const best = nearestAccessNode(zone, aisles.filter((n) => n.floorId === zone.floorId))
      if (!best) return zone
      const round = (v: number) => Math.round(v * 100) / 100
      const node: NavNode = {
        id: accessId(zone),
        floorId: zone.floorId,
        x: round(Math.min(Math.max(best.x, zone.x), zone.x + zone.width)),
        z: round(Math.min(Math.max(best.z, zone.z), zone.z + zone.depth)),
      }
      newNodes.push(node)
      addEdges.push({ from: node.id, to: best.id, mode: 'walk' })
      return { ...zone, accessNodeId: node.id }
    }
    // เต็นท์ และบันได/ลิฟต์ที่ไม่ได้ย้ายใช้จุดเข้า-ออกตามผังหลัก
    if (!EDITABLE_KINDS.includes(zone.kind) || isCore(zone)) return zone
    const current = nodesById.get(zone.accessNodeId)
    const stale = !current || current.floorId !== zone.floorId || !usable(current)
    if (!stale && !added.has(zone.id) && !geometryChanged(edits.changed[zone.id])) return zone
    const best = nearestAccessNode(zone, aisles.filter((n) => n.floorId === zone.floorId))
    return best ? { ...zone, accessNodeId: best.id } : zone
  })

  const seen = new Set(edges.map((e) => `${e.from}|${e.to}`))
  for (const zone of resolved.filter((z) => movedIds.has(z.id) && z.accessNodeId === accessId(z)))
    for (const e of coreLinks(base.floors, resolved, aisles, zone))
      if (!seen.has(`${e.from}|${e.to}`) && !seen.has(`${e.to}|${e.from}`)) {
        seen.add(`${e.from}|${e.to}`)
        addEdges.push(e)
      }

  const replaced = new Set(newNodes.map((n) => n.id))
  return {
    layout: { ...base, zones: resolved, nodes: [...base.nodes.filter((n) => !replaced.has(n.id)), ...newNodes], edges: [...edges, ...addEdges] },
    nav: { nodes: newNodes, addEdges, dropEdges },
  }
}

/**
 * ทางขึ้น-ลงของบันได/ลิฟต์: ต่อกับโซนประเภทเดียวกันที่วางทับจุดกึ่งกลางในชั้นถัดไปด้านบนและด้านล่าง (อาคารเดียวกัน)
 * บันไดใต้ชั้นลอยที่ไม่มีบันไดบนชั้นลอย ⇒ ต่อกับโหนดทางเดินบนชั้นลอยที่ใกล้ที่สุด · ลิฟต์ไม่จอดชั้นลอย
 */
export function coreLinks(floors: Floor[], zones: Zone[], nodes: NavNode[], zone: Zone): NavEdge[] {
  const floor = floors.find((f) => f.id === zone.floorId)
  if (!floor || !zone.accessNodeId) return []
  const center = toSite(floor, zone.x + zone.width / 2, zone.z + zone.depth / 2)
  const covering = floors.filter((f) => {
    if (f.id === floor.id || f.area !== 'building' || buildingOf(f) !== buildingOf(floor) || (zone.kind === 'lift' && f.mezzanine)) return false
    const [lx, lz] = toLocal(f, ...center)
    return lx >= 0 && lx <= f.width && lz >= 0 && lz <= f.depth
  })
  const above = covering.filter((f) => f.elevation > floor.elevation).sort((a, b) => a.elevation - b.elevation)[0]
  const below = covering.filter((f) => f.elevation < floor.elevation).sort((a, b) => b.elevation - a.elevation)[0]
  const out: NavEdge[] = []
  for (const target of [above, below]) {
    if (!target) continue
    const [lx, lz] = toLocal(target, ...center)
    const match = zones.find((z) => z.floorId === target.id && z.kind === zone.kind && z.accessNodeId && pointInRect(lx, lz, z, 0.5))
    let other = match?.accessNodeId
    if (!other && target === above && target.mezzanine && zone.kind === 'stairs')
      other = nearestAccessNode({ x: lx, z: lz, width: 0, depth: 0 }, nodes.filter((n) => n.floorId === target.id))?.id
    if (!other) continue
    out.push(target === above ? { from: zone.accessNodeId, to: other, mode: zone.kind as 'stairs' | 'lift' } : { from: other, to: zone.accessNodeId, mode: zone.kind as 'stairs' | 'lift' })
  }
  return out
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
  if (isCore(zone) && !layout.edges.some((e) => e.mode === zone.kind && (e.from === zone.accessNodeId || e.to === zone.accessNodeId)))
    issues.push({ level: 'warn', text: `ไม่เชื่อมกับชั้นอื่น — วางให้ตรงกับ${zone.kind === 'lift' ? 'ลิฟต์' : 'บันได'}ชั้นบน/ล่าง` })
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
  stairs: { id: 'ST', code: 'ST-N', name: 'บันได', size: [4, 10] },
  lift: { id: 'LF', code: 'LF-N', name: 'ลิฟต์ขนของ', size: [4, 8] },
}

export type NewZoneKind = 'storage' | 'assembly' | 'inspection' | 'ng' | 'utility' | 'stairs' | 'lift'

/** สร้างโซนใหม่ วางในช่องว่างแรกที่ไม่ทับโซนอื่น (ไล่จากด้านหลังอาคาร) */
export function newZone(kind: NewZoneKind, floor: Floor, zones: Zone[]): Zone {
  const meta = KIND_PREFIX[kind]!
  const core = CORE_KINDS.includes(kind)
  let n = 1
  // บันได/ลิฟต์ใช้เลขเดียวกันทุกชั้น (F1-ST-U1 ↔ F2-ST-U1) เพื่อวางให้ตรงกันได้
  while (zones.some((z) => (core ? z.id.endsWith(`-${meta.id}-U${n}`) : z.id === `${floor.id}-${meta.id}-U${n}` || z.code === `${meta.code}${n}`))) n++
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
    code: core ? `${floor.id}-${meta.id}-U${n}` : `${meta.code}${n}`,
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

/** รหัสของโซนคู่กันในชั้นอื่น: F1-STAIRS → F2-STAIRS, F1-ST-U1 → F2-ST-U1 */
const onFloor = (value: string, from: string, to: string) => (value.startsWith(`${from}-`) ? `${to}-${value.slice(from.length + 1)}` : `${to}-${value}`)

/**
 * วางบันได/ลิฟต์ตัวนี้ให้ตรงกันทุกชั้นเต็มของอาคาร (ไม่รวมชั้นลอย):
 * ย้ายตัวคู่กันที่มีอยู่แล้ว หรือสร้างใหม่ถ้ายังไม่มี
 */
export function withCopiesOnFloors(edits: LayoutEdits, layout: FactoryLayout, id: string): LayoutEdits {
  const zone = layout.zones.find((z) => z.id === id)
  const floor = layout.floors.find((f) => f.id === zone?.floorId)
  if (!zone || !floor) return edits
  let next = edits
  for (const g of layout.floors) {
    if (g.id === floor.id || g.area !== 'building' || g.mezzanine || buildingOf(g) !== buildingOf(floor)) continue
    const [lx, lz] = toLocal(g, ...toSite(floor, zone.x, zone.z))
    const rect = clampToFloor({ x: snap(lx), z: snap(lz), width: zone.width, depth: zone.depth }, g)
    const otherId = onFloor(zone.id, floor.id, g.id)
    if (layout.zones.some((z) => z.id === otherId)) next = withPatch(next, otherId, rect)
    else if (next.removed.includes(otherId)) next = withPatch({ ...next, removed: next.removed.filter((r) => r !== otherId) }, otherId, { ...rect, floorId: g.id })
    else next = { ...next, added: [...next.added, { ...zone, ...rect, id: otherId, code: onFloor(zone.code, floor.id, g.id), floorId: g.id, accessNodeId: '' }] }
  }
  return next
}

const ZONE_FIELDS = ['code', 'name', 'floorId', 'kind', 'x', 'z', 'width', 'depth', 'accessNodeId', 'storage', 'levels', 'slotsPerLevel'] as const

/** สิ่งที่ต้องบันทึกลงฐานข้อมูลกลาง: โซนที่เพิ่ม/เปลี่ยน (รวมจุดเข้า-ออกที่คำนวณใหม่), โซนที่ลบ และทางเดินของบันได/ลิฟต์ */
export interface LayoutSave extends NavChanges {
  zones: Zone[]
  removed: string[]
}

export function layoutChanges(base: FactoryLayout, edits: LayoutEdits): LayoutSave {
  const { layout, nav } = editLayout(base, edits)
  const before = new Map(base.zones.map((z) => [z.id, z]))
  const zones = layout.zones.filter((z) => {
    const b = before.get(z.id)
    return !b || ZONE_FIELDS.some((k) => (b[k] ?? null) !== (z[k] ?? null))
  })
  return { zones, removed: edits.removed.filter((id) => before.has(id)), ...nav }
}

export const editCount = (e: LayoutEdits) => Object.keys(e.changed).length + e.added.length + e.removed.length
