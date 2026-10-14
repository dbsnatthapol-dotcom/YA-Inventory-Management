import type { FactoryLayout, NavNode, TravelMode } from '../types/layout'

/** สมมติฐานความเร็ว — ปรับให้ตรงกับการจับเวลาจริงหน้างาน */
export const TRAVEL_ASSUMPTIONS = {
  walkSpeed: 1.0, // m/s (เดินพร้อมรถเข็น/ถือของ)
  stairsSpeed: 0.4, // m/s ตามความยาวขั้นบันได
  stairsRunFactor: 2.0, // ระยะเดินบนบันได ≈ 2 เท่าของความสูง (รวมชานพัก)
  liftWaitSeconds: 45, // เวลารอลิฟต์โดยเฉลี่ย
  liftSpeed: 0.5, // m/s แนวดิ่ง
}

export interface RouteOptions {
  /** time = เร็วที่สุด, distance = เดินน้อยที่สุด */
  optimize?: 'time' | 'distance'
  /** โหมดที่ห้ามใช้ เช่น ['lift'] ถ้าลิฟต์ไม่อนุญาตให้คนขึ้น */
  avoid?: TravelMode[]
  assumptions?: typeof TRAVEL_ASSUMPTIONS
}

export interface RouteResult {
  nodes: NavNode[]
  /** ระยะเดินทั้งหมด (พื้นราบ + บันได) เมตร */
  walkDistance: number
  stairsDistance: number
  liftRides: number
  timeSeconds: number
  floorChanges: number
}

interface Arc {
  to: string
  walk: number
  stairs: number
  lift: number
  time: number
}

function buildGraph(layout: FactoryLayout, opts: Required<RouteOptions>) {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const elevation = new Map(layout.floors.map((f) => [f.id, f.elevation]))
  const a = opts.assumptions
  const adj = new Map<string, Arc[]>()

  for (const e of layout.edges) {
    if (opts.avoid.includes(e.mode)) continue
    const from = nodes.get(e.from)
    const to = nodes.get(e.to)
    if (!from || !to) throw new Error(`Edge ${e.from} → ${e.to} อ้างถึงโหนดที่ไม่มีอยู่`)

    const horizontal = Math.hypot(to.x - from.x, to.z - from.z)
    const vertical = Math.abs((elevation.get(to.floorId) ?? 0) - (elevation.get(from.floorId) ?? 0))
    let arc: Omit<Arc, 'to'>
    if (e.mode === 'walk') {
      arc = { walk: horizontal, stairs: 0, lift: 0, time: horizontal / a.walkSpeed }
    } else if (e.mode === 'stairs') {
      const len = horizontal + vertical * a.stairsRunFactor
      arc = { walk: len, stairs: len, lift: 0, time: len / a.stairsSpeed }
    } else {
      arc = { walk: horizontal, stairs: 0, lift: 1, time: a.liftWaitSeconds + vertical / a.liftSpeed }
    }
    for (const [x, y] of [[e.from, e.to], [e.to, e.from]]) {
      if (!adj.has(x)) adj.set(x, [])
      adj.get(x)!.push({ to: y, ...arc })
    }
  }
  return { nodes, adj, elevation }
}

/** หาเส้นทางสั้นที่สุดด้วย Dijkstra ระหว่างโหนดทางเดิน 2 จุด */
export function findRoute(
  layout: FactoryLayout,
  fromNodeId: string,
  toNodeId: string,
  options: RouteOptions = {},
): RouteResult | null {
  const opts: Required<RouteOptions> = {
    optimize: options.optimize ?? 'time',
    avoid: options.avoid ?? [],
    assumptions: options.assumptions ?? TRAVEL_ASSUMPTIONS,
  }
  const { nodes, adj, elevation } = buildGraph(layout, opts)
  if (!nodes.has(fromNodeId) || !nodes.has(toNodeId)) return null

  const cost = (arc: Arc) => (opts.optimize === 'time' ? arc.time : arc.walk)
  const dist = new Map<string, number>([[fromNodeId, 0]])
  const prev = new Map<string, { id: string; arc: Arc }>()
  const done = new Set<string>()

  // กราฟมีขนาดเล็ก (หลักร้อยโหนด) จึงใช้การสแกนหาค่าน้อยสุดแทน priority queue ได้
  while (true) {
    let current: string | null = null
    for (const [id, d] of dist) {
      if (!done.has(id) && (current === null || d < dist.get(current)!)) current = id
    }
    if (current === null || current === toNodeId) break
    done.add(current)
    for (const arc of adj.get(current) ?? []) {
      const next = dist.get(current)! + cost(arc)
      if (next < (dist.get(arc.to) ?? Infinity)) {
        dist.set(arc.to, next)
        prev.set(arc.to, { id: current, arc })
      }
    }
  }
  if (!dist.has(toNodeId)) return null

  const path: NavNode[] = [nodes.get(toNodeId)!]
  const result: RouteResult = { nodes: path, walkDistance: 0, stairsDistance: 0, liftRides: 0, timeSeconds: 0, floorChanges: 0 }
  for (let id = toNodeId; prev.has(id); ) {
    const { id: before, arc } = prev.get(id)!
    result.walkDistance += arc.walk
    result.stairsDistance += arc.stairs
    result.liftRides += arc.lift
    result.timeSeconds += arc.time
    if (elevation.get(nodes.get(before)!.floorId) !== elevation.get(nodes.get(id)!.floorId)) result.floorChanges++
    path.unshift(nodes.get(before)!)
    id = before
  }
  return result
}
