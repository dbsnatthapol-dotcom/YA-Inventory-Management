import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { palletsFor, planRack } from '../data/warehouse'
import { buildDemoState } from '../inventory/demoSeed'
import { zoneContents } from '../inventory/reports'
import { applyLayoutEdits, clampToFloor, emptyEdits, newZone, rotated, segmentHitsRect, withPatch, withRemoved, zoneIssues } from './layoutEdit'
import { findRoute } from './pathfinding'

const zoneIn = (layout: typeof sampleLayout, id: string) => layout.zones.find((z) => z.id === id)!
const hasEdge = (layout: typeof sampleLayout, a: string, b: string) => layout.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))

describe('layout edits', () => {
  it('closes aisles that run through racks and assembly lines, but keeps every zone reachable', () => {
    const layout = applyLayoutEdits(sampleLayout, emptyEdits())
    // Rack A (x 10–28, z 12–22) ขวางทางเดินแนวตั้ง x = 18 ระหว่างแถว z = 8 กับ 26
    expect(hasEdge(sampleLayout, 'F1-r0c1', 'F1-r1c1')).toBe(true)
    expect(hasEdge(layout, 'F1-r0c1', 'F1-r1c1')).toBe(false)
    // ผังเริ่มต้นไม่ต้องย้ายจุดเข้า-ออก
    expect(layout.zones.map((z) => z.accessNodeId)).toEqual(sampleLayout.zones.map((z) => z.accessNodeId))
    for (const z of layout.zones.filter((z) => z.kind === 'storage' || z.kind === 'tent'))
      expect(findRoute(layout, z.accessNodeId, zoneIn(layout, 'F3-ASM').accessNodeId), z.id).not.toBeNull()
  })

  it('moves a rack, picks the nearest open aisle node and updates the walking route', () => {
    const before = applyLayoutEdits(sampleLayout, emptyEdits())
    const edits = withPatch(emptyEdits(), 'F1-RK-A', { x: 10, z: 66 })
    const after = applyLayoutEdits(sampleLayout, edits)
    const rack = zoneIn(after, 'F1-RK-A')
    expect(rack).toMatchObject({ x: 10, z: 66 })
    // rack ใหม่อยู่ระหว่างแถว z = 62 กับ 80 → จุดเข้าเป็นโหนดบนแถว 62 หรือ 80 ที่ไม่ถูกขวาง
    const node = after.nodes.find((n) => n.id === rack.accessNodeId)!
    expect([62, 80]).toContain(node.z)
    expect(node.x).toBeGreaterThanOrEqual(10)
    expect(node.x).toBeLessThanOrEqual(28)
    // ย้าย rack มาใกล้จุดรับเข้า ⇒ ระยะเดินเก็บของ (put-away) สั้นลง
    const dock = zoneIn(after, 'RCV-01').accessNodeId
    const d0 = findRoute(before, dock, zoneIn(before, 'F1-RK-A').accessNodeId)!.walkDistance
    const d1 = findRoute(after, dock, rack.accessNodeId)!.walkDistance
    expect(d1).toBeLessThan(d0 - 20)
  })

  it('reassigns the access node of a zone whose aisle gets covered by another zone', () => {
    // วาง rack ใหม่ทับโหนดหน้า Rack C (F1-r2c1 ที่ x 18, z 44)
    const extra = { ...newZone('storage', sampleLayout.floors[0], sampleLayout.zones), x: 12, z: 41, width: 13.5, depth: 6 }
    const layout = applyLayoutEdits(sampleLayout, { ...emptyEdits(), added: [extra] })
    expect(zoneIn(layout, 'F1-RK-C').accessNodeId).not.toBe('F1-r2c1')
    expect(zoneIssues(layout, zoneIn(layout, extra.id))).toEqual([])
  })

  it('flags overlaps and keeps zones on the floor', () => {
    const layout = applyLayoutEdits(sampleLayout, withPatch(emptyEdits(), 'F1-RK-B', { x: 20, z: 14 }))
    expect(zoneIssues(layout, zoneIn(layout, 'F1-RK-B')).map((i) => i.text)).toContain('ทับกับ RK-A')
    const floor = sampleLayout.floors[0]
    expect(clampToFloor({ x: 60, z: -3, width: 18, depth: 10 }, floor)).toEqual({ x: floor.width - 18, z: 0, width: 18, depth: 10 })
    expect(rotated({ x: 10, z: 12, width: 18, depth: 10 })).toEqual({ x: 14, z: 8, width: 10, depth: 18 })
  })

  it('treats added zones as their own records and removes base zones by id', () => {
    const z = newZone('assembly', sampleLayout.floors[1], sampleLayout.zones)
    let e = { ...emptyEdits(), added: [z] }
    e = withPatch(e, z.id, { name: 'ไลน์ K1G' })
    expect(e.added[0].name).toBe('ไลน์ K1G')
    expect(withRemoved(e, z.id).added).toEqual([])
    const removed = applyLayoutEdits(sampleLayout, withRemoved(emptyEdits(), 'F1-RK-B'))
    expect(removed.zones.some((x) => x.id === 'F1-RK-B')).toBe(false)
  })

  it('detects segments crossing a rectangle but not ones touching its edge', () => {
    const r = { x: 0, z: 0, width: 10, depth: 10 }
    expect(segmentHitsRect(5, -5, 5, 15, r)).toBe(true)
    expect(segmentHitsRect(0, -5, 0, 15, r)).toBe(false)
    expect(segmentHitsRect(-5, -5, -1, 15, r)).toBe(false)
  })
})

describe('pallet racking', () => {
  it('fits single + double + single rows with aisles into an 18 × 10 m zone', () => {
    const plan = planRack(18, 10)
    expect(plan.rows.map((r) => r.units)).toEqual([1, 2, 1])
    expect(plan.bays).toBe(6)
    expect(plan.slots).toHaveLength(6 * 4 * 2 * 3)
    // หมุนโซนแล้วความจุเท่าเดิม
    expect(planRack(10, 18).slots).toHaveLength(plan.slots.length)
  })

  it('turns zone stock into pallets by part type', () => {
    const s = buildDemoState('2026-10-14')
    const contents = zoneContents(s, 'F1-RK-A')
    const pallets = palletsFor(contents)
    expect(pallets.length).toBeGreaterThan(0)
    expect(pallets.length).toBeLessThan(contents.totalQty)
    expect(new Set(pallets.map((p) => p.model))).toEqual(new Set(contents.models.map((m) => m.model)))
  })
})
