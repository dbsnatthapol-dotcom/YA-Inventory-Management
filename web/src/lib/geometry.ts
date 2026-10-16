import type { Floor, Zone } from '../types/layout'

export const toRadians = (deg = 0) => (deg * Math.PI) / 180

/** แปลงพิกัดภายในชั้นเป็นพิกัด site */
export function toSite(floor: Pick<Floor, 'x' | 'z' | 'rotation'>, x: number, z: number): [number, number] {
  const a = toRadians(floor.rotation)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [floor.x + x * cos - z * sin, floor.z + x * sin + z * cos]
}

/** แปลงพิกัด site เป็นพิกัดภายในชั้น */
export function toLocal(floor: Pick<Floor, 'x' | 'z' | 'rotation'>, x: number, z: number): [number, number] {
  const a = toRadians(floor.rotation)
  const dx = x - floor.x
  const dz = z - floor.z
  return [dx * Math.cos(a) + dz * Math.sin(a), -dx * Math.sin(a) + dz * Math.cos(a)]
}

/** อาคารของชั้น (ข้อมูลเก่าไม่มีค่า = อาคาร A) */
export const buildingOf = (floor: Pick<Floor, 'building'>) => floor.building ?? 'A'

/**
 * ระยะจากพื้นของโซนถึงพื้นชั้นถัดไปที่อยู่เหนือโซน (อาคารเดียวกัน) — ใช้จำกัดความสูง rack/บันได
 * ชั้นบนสุดไม่มีพื้นทับ ⇒ Infinity
 */
export function zoneClearance(floors: Floor[], zone: Pick<Zone, 'floorId' | 'x' | 'z' | 'width' | 'depth'>): number {
  const floor = floors.find((f) => f.id === zone.floorId)
  if (!floor || floor.area !== 'building') return Infinity
  const points: [number, number][] = [
    [zone.x + 0.2, zone.z + 0.2],
    [zone.x + zone.width - 0.2, zone.z + 0.2],
    [zone.x + 0.2, zone.z + zone.depth - 0.2],
    [zone.x + zone.width - 0.2, zone.z + zone.depth - 0.2],
    [zone.x + zone.width / 2, zone.z + zone.depth / 2],
  ]
  let best = Infinity
  for (const f of floors) {
    if (f.area !== 'building' || buildingOf(f) !== buildingOf(floor) || f.elevation <= floor.elevation) continue
    const covers = points.some(([x, z]) => {
      const [lx, lz] = toLocal(f, ...toSite(floor, x, z))
      return lx >= 0 && lx <= f.width && lz >= 0 && lz <= f.depth
    })
    if (covers) best = Math.min(best, f.elevation - floor.elevation)
  }
  return best
}
