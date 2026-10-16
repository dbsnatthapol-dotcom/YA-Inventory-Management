import type { FactoryLayout, Floor, TravelMode, Zone } from '../types/layout'
import type { RouteResult } from './pathfinding'

export interface RouteStep {
  /** ชั้นที่ขั้นนี้อยู่ (แตะแล้วเปิดผังชั้นนั้น) */
  floorId: string
  text: string
}

export interface Directions {
  steps: RouteStep[]
  /** เส้นทางบนแต่ละชั้น (พิกัดภายในชั้น) สำหรับวาดบนผัง 2D */
  paths: Map<string, [number, number][][]>
}

const floorLabel = (f: Floor | undefined) => f?.name ?? '?'

/** แปลงเส้นทางเป็นขั้นตอนอ่านง่าย: เดินบนชั้นไหนกี่เมตร ขึ้น/ลงบันไดหรือลิฟต์ไปชั้นไหน */
export function routeDirections(layout: Pick<FactoryLayout, 'floors' | 'edges'>, route: RouteResult, from: Zone, to: Zone): Directions {
  const floors = new Map(layout.floors.map((f) => [f.id, f]))
  const modeOf = (a: string, b: string): TravelMode =>
    layout.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))?.mode ?? 'walk'
  const paths = new Map<string, [number, number][][]>()
  const steps: RouteStep[] = [{ floorId: from.floorId, text: `เริ่มที่ ${from.code} (${floorLabel(floors.get(from.floorId))})` }]
  const nodes = route.nodes
  if (!nodes.length) return { steps, paths }

  let run: [number, number][] = [[nodes[0].x, nodes[0].z]]
  let dist = 0
  const flush = (floorId: string) => {
    if (run.length > 1) paths.set(floorId, [...(paths.get(floorId) ?? []), run])
    if (dist >= 1) steps.push({ floorId, text: `เดินบน ${floorLabel(floors.get(floorId))} ประมาณ ${Math.round(dist)} ม.` })
  }
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1]
    const b = nodes[i]
    if (a.floorId === b.floorId) {
      dist += Math.hypot(b.x - a.x, b.z - a.z)
      run.push([b.x, b.z])
      continue
    }
    flush(a.floorId)
    const fa = floors.get(a.floorId)
    const fb = floors.get(b.floorId)
    const mode = modeOf(a.id, b.id)
    const dir = (fb?.elevation ?? 0) > (fa?.elevation ?? 0) ? 'ขึ้น' : 'ลง'
    const text =
      mode === 'stairs' ? `${dir}บันไดไป ${floorLabel(fb)}` : mode === 'lift' ? `${dir}ลิฟต์ไป ${floorLabel(fb)}` : `เดินต่อไป ${floorLabel(fb)}`
    steps.push({ floorId: b.floorId, text })
    run = [[b.x, b.z]]
    dist = 0
  }
  flush(nodes[nodes.length - 1].floorId)
  steps.push({ floorId: to.floorId, text: `ถึง ${to.code} · ${to.name}` })
  return { steps, paths }
}
