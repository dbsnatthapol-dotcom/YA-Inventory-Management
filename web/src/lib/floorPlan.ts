import type { FactoryLayout, Floor } from '../types/layout'
import { pointInRect } from './layoutEdit'

/** ความกว้างทางเดินรถยก/คนในอาคาร (ม.) */
export const AISLE_WIDTH = 3

/** ข้อมูลผังพื้นของชั้นหนึ่ง (พิกัดภายในชั้น) — ใช้ทั้งตีเส้นพื้น 3D และผัง 2D ในหน้าปรับผัง */
export interface FloorPaint {
  width: number
  depth: number
  /** ทางเดินรถยก/คน (เส้นกึ่งกลาง) */
  aisles: [number, number, number, number][]
  /** พื้นที่ห้ามวางของ ลายเหลือง-ดำ (บันได ลิฟต์) */
  hazards: { x: number; z: number; width: number; depth: number }[]
  /** ทางม้าลายหน้าประตู */
  crossings: { x: number; z: number; width: number; depth: number }[]
  columns: [number, number][]
}

const GRID_NODE = /-r\d+c\d+$/

/** ข้อมูลตีเส้นพื้นของชั้น: ทางเดินจากกราฟทางเดิน (ที่ไม่ถูก rack ขวาง), จุดอันตราย, ทางม้าลาย, เสา */
export function floorPaint(layout: FactoryLayout, floor: Floor): FloorPaint {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const aisles = layout.edges.flatMap((e): [number, number, number, number][] => {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    return e.mode === 'walk' && a && b && a.floorId === floor.id && b.floorId === floor.id ? [[a.x, a.z, b.x, b.z]] : []
  })
  const zones = layout.zones.filter((z) => z.floorId === floor.id)
  const hazards = zones.filter((z) => z.kind === 'stairs' || z.kind === 'lift').map(({ x, z, width, depth }) => ({ x, z, width, depth }))
  const crossings = layout.nodes
    .filter((n) => n.floorId === floor.id && n.id.endsWith('-DOOR'))
    .map((n) => ({ x: n.x - AISLE_WIDTH, z: Math.max(n.z - 3.5, 0), width: AISLE_WIDTH * 2, depth: Math.min(3.5, n.z) }))

  // เสาโครงสร้าง: กึ่งกลางระหว่างทางเดินหลัก และแนวผนัง
  const grid = layout.nodes.filter((n) => n.floorId === floor.id && GRID_NODE.test(n.id))
  const lines = (values: number[], size: number) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    return [0.3, ...sorted.slice(1).map((v, i) => (v + sorted[i]) / 2), size - 0.3]
  }
  const nearAisle = (x: number, z: number) =>
    aisles.some(([ax, az, bx, bz]) => {
      const len2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2))
      return Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))) < AISLE_WIDTH / 2 + 0.4
    })
  const columns: [number, number][] = []
  if (grid.length)
    for (const x of lines(grid.map((n) => n.x), floor.width))
      for (const z of lines(grid.map((n) => n.z), floor.depth)) if (!nearAisle(x, z) && !hazards.some((h) => pointInRect(x, z, h, 0.5))) columns.push([x, z])

  return { width: floor.width, depth: floor.depth, aisles, hazards, crossings, columns }
}

