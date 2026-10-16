import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { buildDemoState } from '../inventory/demoSeed'
import { zoneTotals } from '../inventory/reports'
import { layoutLocations } from '../wms/locations'
import type { Tx } from '../wms/types'
import { alongPingPong, guidePath } from './guidePaths'
import { applyLayoutEdits, emptyEdits, pointInRect } from './layoutEdit'
import { buildGuides, buildTourSteps, flowsFromTx } from './mapShowcase'
import { mapStats } from './mapStats'

const layout = applyLayoutEdits(sampleLayout, emptyEdits())
const zone = (id: string) => layout.zones.find((z) => z.id === id)!

describe('guide walking paths', () => {
  it('patrols the aisle beside its own zone, never through a rack', () => {
    for (const id of ['F1-RK-A', 'RCV-01', 'F2-ASM', 'FBM-RK-G']) {
      const path = guidePath(layout, zone(id))!
      expect(path.length, id).toBeGreaterThanOrEqual(2)
      const obstacles = layout.zones.filter((z) => z.floorId === zone(id).floorId && z.kind === 'storage')
      for (const [x, z] of path) expect(obstacles.some((o) => pointInRect(x, z, o)), `${id} (${x}, ${z})`).toBe(false)
      const len = path.slice(1).reduce((s, [x, z], i) => s + Math.hypot(x - path[i][0], z - path[i][1]), 0)
      expect(len).toBeLessThanOrEqual(16.01)
    }
  })

  it('walks there and back along the path', () => {
    const path: [number, number][] = [
      [0, 0],
      [10, 0],
    ]
    expect(alongPingPong(path, 4)).toMatchObject({ x: 4, z: 0 })
    expect(alongPingPong(path, 14)).toMatchObject({ x: 6, z: 0 })
    expect(alongPingPong(path, 4).heading).toBeCloseTo(Math.PI / 2)
    expect(alongPingPong(path, 14).heading).toBeCloseTo(-Math.PI / 2)
  })
})

describe('map showcase', () => {
  const state = buildDemoState('2026-10-14')
  const stock = zoneTotals(state)
  const stats = mapStats(layout, state, stock, '2026-10-14')

  it('gives every station a guide with real numbers and the zone head when assigned', () => {
    const guides = buildGuides(layout, stock, [{ zoneId: 'F1-RK-A', staffId: 's', employeeCode: '59037', fullName: 'หัวหน้า A' }], stats)
    expect(guides.get('F1-RK-A')?.who).toBe('หัวหน้าโซน: หัวหน้า A')
    expect(guides.get('RCV-01')?.who).toContain('ผู้ดูแลจุดรับสินค้า')
    expect(guides.get('F1-RK-A')?.lines.join(' ')).toMatch(/ใช้พื้นที่ \d+%/)
    expect(guides.has('F1-STAIRS')).toBe(false)
  })

  it('turns recent stock movements into routes between zones', () => {
    const tx = (kind: Tx['kind'], fromLoc: string | null, toLoc: string | null): Tx =>
      ({ id: `${kind}-${fromLoc}`, kind, fromLoc, toLoc, partNo: 'P-1', lpnNo: 'LPN-1' }) as Tx
    const flows = flowsFromTx(
      [tx('PUT', 'RCV-01', 'RK-A-01-1'), tx('ISSUE', 'RK-B-02-1', null), tx('COUNT', null, null), tx('MOVE', 'RK-A-01-1', 'RK-A-02-1')],
      layoutLocations(layout).map((l) => ({ ...l, active: true })),
      layout,
    )
    expect(flows.map((f) => [f.from, f.to])).toEqual([
      ['RCV-01', 'F1-RK-A'],
      ['F1-RK-B', 'F2-ASM'],
    ])
  })

  it('builds the executive tour from overview to the closing summary', () => {
    const steps = buildTourSteps(layout, stats, stock)
    expect(steps[0].zoneId).toBeNull()
    expect(steps.map((s) => s.zoneId)).toEqual(expect.arrayContaining(['RCV-01', 'F1-MI3', 'F2-ASM']))
    expect(steps.some((s) => s.heatmap)).toBe(true)
    expect(steps.at(-1)!.flow).toBe(true)
  })
})
