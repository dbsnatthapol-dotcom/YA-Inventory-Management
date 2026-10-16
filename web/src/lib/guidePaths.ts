import type { FactoryLayout, Zone } from '../types/layout'
import { distanceToRect } from './layoutEdit'

const MAX_LENGTH = 16

/**
 * เส้นทางเดินตรวจของไกด์ประจำโซน (พิกัดภายในชั้น): เริ่มที่จุดเข้า-ออกของโซน แล้วเดินไปตามทางเดินที่ติดโซนอีก 1–2 ช่วง
 * (เลือกโหนดที่ใกล้ขอบโซนที่สุด จะได้เดินเลียบโซนของตัวเอง) ยาวไม่เกิน 16 ม. — เดินไป-กลับ
 */
export function guidePath(layout: Pick<FactoryLayout, 'nodes' | 'edges'>, zone: Zone): [number, number][] | null {
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]))
  const start = nodes.get(zone.accessNodeId)
  if (!start || start.floorId !== zone.floorId) return null
  const neighbours = (id: string) =>
    layout.edges
      .filter((e) => e.mode === 'walk' && (e.from === id || e.to === id))
      .map((e) => nodes.get(e.from === id ? e.to : e.from))
      .filter((n): n is NonNullable<typeof n> => !!n && n.floorId === zone.floorId)

  const path: [number, number][] = [[start.x, start.z]]
  const seen = new Set([start.id])
  let cur = start
  for (let step = 0; step < 2; step++) {
    const next = neighbours(cur.id)
      .filter((n) => !seen.has(n.id))
      .sort((a, b) => distanceToRect(a.x, a.z, zone) - distanceToRect(b.x, b.z, zone))[0]
    if (!next) break
    seen.add(next.id)
    path.push([next.x, next.z])
    cur = next
  }
  // ไม่มีทางเดินต่อ ⇒ เดินเลียบขอบโซนสั้น ๆ
  if (path.length < 2) path.push([Math.min(start.x + 4, zone.x + zone.width), start.z])

  // ตัดให้ยาวไม่เกิน MAX_LENGTH
  const out: [number, number][] = [path[0]]
  let total = 0
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = out[out.length - 1]
    const [bx, bz] = path[i]
    const len = Math.hypot(bx - ax, bz - az)
    if (total + len >= MAX_LENGTH) {
      const k = (MAX_LENGTH - total) / len
      out.push([ax + (bx - ax) * k, az + (bz - az) * k])
      break
    }
    total += len
    out.push([bx, bz])
  }
  return out
}

/** ตำแหน่งบนเส้นทาง (เดินไป-กลับ) ที่ระยะ s ม. นับจากจุดเริ่ม และทิศที่หัน (เรเดียนรอบแกน y) */
export function alongPingPong(path: [number, number][], s: number): { x: number; z: number; heading: number } {
  const lens = path.slice(1).map(([x, z], i) => Math.hypot(x - path[i][0], z - path[i][1]))
  const total = lens.reduce((a, b) => a + b, 0)
  if (total <= 0) return { x: path[0][0], z: path[0][1], heading: 0 }
  const m = ((s % (2 * total)) + 2 * total) % (2 * total)
  const back = m > total
  let d = back ? 2 * total - m : m
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const [ax, az] = path[i]
      const [bx, bz] = path[i + 1]
      const k = lens[i] ? Math.min(1, d / lens[i]) : 0
      const dx = (bx - ax) * (back ? -1 : 1)
      const dz = (bz - az) * (back ? -1 : 1)
      return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, heading: Math.atan2(dx, dz) }
    }
    d -= lens[i]
  }
  return { x: path[0][0], z: path[0][1], heading: 0 }
}
