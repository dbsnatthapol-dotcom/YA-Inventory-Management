import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import type { FactoryLayout } from '../types/layout'
import { toSite } from './geometry'
import { findRoute } from './pathfinding'

const zone = (id: string) => sampleLayout.zones.find((z) => z.id === id)!

describe('findRoute', () => {
  it('measures a straight walk on one floor', () => {
    const layout: FactoryLayout = {
      siteName: 't',
      floors: [{ id: 'F', name: 'F', level: 1, elevation: 0, area: 'building', x: 0, z: 0, width: 10, depth: 10 }],
      zones: [],
      nodes: [
        { id: 'a', floorId: 'F', x: 0, z: 0 },
        { id: 'b', floorId: 'F', x: 3, z: 4 },
      ],
      edges: [{ from: 'a', to: 'b', mode: 'walk' }],
    }
    const r = findRoute(layout, 'b', 'a')!
    expect(r.walkDistance).toBe(5)
    expect(r.nodes.map((n) => n.id)).toEqual(['b', 'a'])
  })

  it('routes from ground-floor rack to the 3rd-floor wheel line via stairs when lift is avoided', () => {
    const r = findRoute(sampleLayout, zone('F1-RK-A').accessNodeId, zone('F3-ASM').accessNodeId, { avoid: ['lift'] })!
    expect(r.floorChanges).toBe(2)
    expect(r.liftRides).toBe(0)
    expect(r.stairsDistance).toBe(18) // 2 ชั้น x 4.5 ม. x 2
  })

  it('reaches the outdoor tents through the ground-floor door', () => {
    const r = findRoute(sampleLayout, zone('TENT-C').accessNodeId, zone('F2-ASM').accessNodeId)!
    expect(r.nodes.some((n) => n.id === 'F1-DOOR')).toBe(true)
    expect(r.floorChanges).toBe(1)
  })

  it('keeps distances correct on a rotated building', () => {
    const layout: FactoryLayout = {
      siteName: 't',
      floors: [{ id: 'F', name: 'F', level: 1, elevation: 0, area: 'building', x: 50, z: 50, rotation: 33, width: 10, depth: 10 }],
      zones: [],
      nodes: [
        { id: 'a', floorId: 'F', x: 0, z: 0 },
        { id: 'b', floorId: 'F', x: 3, z: 4 },
      ],
      edges: [{ from: 'a', to: 'b', mode: 'walk' }],
    }
    expect(findRoute(layout, 'a', 'b')!.walkDistance).toBeCloseTo(5)
  })

  it('returns null when no route exists', () => {
    expect(findRoute(sampleLayout, 'F1-r0c0', 'F3-r0c0', { avoid: ['lift', 'stairs'] })).toBeNull()
  })
})

describe('toSite', () => {
  it('rotates local coordinates clockwise around the floor origin', () => {
    const [x, z] = toSite({ x: 10, z: 20, rotation: 90 }, 1, 0)
    expect(x).toBeCloseTo(10)
    expect(z).toBeCloseTo(21)
  })
})
