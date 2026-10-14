import type { Floor } from '../types/layout'

export const toRadians = (deg = 0) => (deg * Math.PI) / 180

/** แปลงพิกัดภายในชั้นเป็นพิกัด site */
export function toSite(floor: Pick<Floor, 'x' | 'z' | 'rotation'>, x: number, z: number): [number, number] {
  const a = toRadians(floor.rotation)
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  return [floor.x + x * cos - z * sin, floor.z + x * sin + z * cos]
}
