import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { storagePlan } from '../data/warehouse'
import { toSite, zoneClearance } from './geometry'
import { findRoute } from './pathfinding'

const { floors, zones, site } = sampleLayout
const boundary = site!.boundary

const insidePolygon = ([x, z]: [number, number], poly: [number, number][]) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < xi + ((z - zi) * (xj - xi)) / (zj - zi)) inside = !inside
  }
  return inside
}

describe('site fit', () => {
  it('keeps every building, including its 1.2 m roof eaves, inside the site boundary', () => {
    const eave = 1.3
    for (const f of floors.filter((f) => f.area === 'building' && !f.mezzanine)) {
      const corners: [number, number][] = [
        [-eave, -eave],
        [f.width + eave, -eave],
        [f.width + eave, f.depth + eave],
        [-eave, f.depth + eave],
      ]
      for (const [x, z] of corners) expect(insidePolygon(toSite(f, x, z), boundary), `${f.id} (${x}, ${z})`).toBe(true)
    }
  })

  it('keeps every building zone inside its floor', () => {
    for (const zone of zones) {
      const floor = floors.find((f) => f.id === zone.floorId)!
      if (floor.area !== 'building') continue
      const inside = zone.x >= 0 && zone.z >= 0 && zone.x + zone.width <= floor.width + 1e-9 && zone.z + zone.depth <= floor.depth + 1e-9
      expect(inside, zone.id).toBe(true)
    }
  })

  it('keeps racks below the floor above them (low shelving on the mezzanine)', () => {
    for (const zone of zones.filter((z) => z.kind === 'storage' && floors.find((f) => f.id === z.floorId)?.area === 'building')) {
      const clearance = zoneClearance(floors, zone)
      expect(storagePlan(zone, clearance).height, zone.id).toBeLessThan(clearance)
    }
    const mezz = zones.find((z) => z.id === 'FBM-RK-G')!
    expect(zoneClearance(floors, mezz)).toBeCloseTo(2.25)
    expect(mezz.storage).toBe('rack')
    expect(storagePlan(mezz, 2.25).levels).toEqual([0, 0.95])
    // พาเลทวางพื้นซ้อนได้แค่ชั้นเดียวใต้ชั้นลอย
    expect(storagePlan({ ...mezz, storage: 'floor', levels: 3 }, 2.25).levels).toEqual([0])
  })

  it('reaches building F floors and the mezzanine from building A', () => {
    for (const target of ['FB1-r0c3', 'FBM-r0c2', 'FB2-r0c5']) {
      const route = findRoute(sampleLayout, 'F1-r5c2', target)
      expect(route, target).not.toBeNull()
    }
    expect(findRoute(sampleLayout, 'F1-r5c2', 'FBM-r0c2')!.floorChanges).toBeGreaterThan(0)
  })
})
