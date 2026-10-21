import { describe, expect, it } from 'vitest'
import { boxCount, searchStock } from '../components/mobile/stockSearch'
import { sampleLayout } from '../data/factoryLayout'
import type { Lpn, MasterData } from '../wms/types'
import { layoutLocations } from '../wms/locations'
import { routeDirections } from './directions'
import { findRoute } from './pathfinding'

const zone = (id: string) => sampleLayout.zones.find((z) => z.id === id)!
const lpn = (lpnNo: string, location: string, items: [string, number][], hold = false): Lpn => ({
  id: lpnNo,
  lpnNo,
  grnId: null,
  locationCode: location,
  hold,
  status: 'active',
  createdAt: '2026-10-16T00:00:00Z',
  items: items.map(([partNo, qty], i) => ({ id: `${lpnNo}-${i}`, lpnId: lpnNo, grnLineId: 'g', partNo, qty })),
})
const master: Pick<MasterData, 'locations' | 'parts'> = {
  locations: layoutLocations(sampleLayout).map((l) => ({ ...l, active: true })),
  parts: [
    { partNo: '148537/A', name: 'RIM 2.5 X 17', type: 'RIM', customerId: 'RE', models: [] },
    { partNo: '150324/A', name: 'WHEEL BEARING 6203', type: 'BEARING', customerId: 'RE', models: [] },
  ],
}
const lpns = [
  lpn('LPN-2610-000001', 'RK-A-01-1', [['148537/A', 60]]),
  lpn('LPN-2610-000002', 'RK-A-01-2', [['148537/A', 40]]),
  lpn('LPN-2610-000003', 'MI3-QC', [['148537/A', 20]], true),
  lpn('LPN-2610-000004', 'RK-E-03-1', [['150324/A', 500]]),
]

describe('mobile stock search', () => {
  it('finds a box from its label QR link', () => {
    const [hit] = searchStock('https://x.dev/t/lpn-2610-000004', lpns, master, sampleLayout)
    expect(hit).toMatchObject({ kind: 'lpn', title: 'LPN-2610-000004', zoneId: 'F2-RK-E', qty: 500 })
  })

  it('lists every box of a part with its locations and spots the MI3 hold', () => {
    const hits = searchStock('rim 2.5', lpns, master, sampleLayout)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'part', title: '148537/A', qty: 120, zoneId: null })
    expect(hits[0].boxes.map((b) => b.location)).toEqual(['MI3-QC', 'RK-A-01-1', 'RK-A-01-2'])
    expect(hits[0].boxes.find((b) => b.location === 'MI3-QC')?.hold).toBe(true)
  })

  it('shows what is in a slot or a zone, and parts without stock', () => {
    expect(searchStock('RK-A-01-2', lpns, master, sampleLayout)[0]).toMatchObject({ kind: 'place', zoneId: 'F1-RK-A', qty: 40 })
    expect(searchStock('rk-a', lpns, master, sampleLayout)[0]).toMatchObject({ kind: 'place', title: 'RK-A', qty: 100 })
    expect(searchStock('bearing', [], master, sampleLayout)[0]).toMatchObject({ kind: 'part', qty: 0, boxes: [] })
    expect(searchStock('r', lpns, master, sampleLayout)).toEqual([])
  })

  it('finds the boxes of a packing list or one case and counts a mixed case box once', () => {
    const cased = [
      { ...lpn('LPN-2610-000010', 'RCV-01', [['148537/A', 10], ['150324/A', 30]]), plRef: '55035596', caseNo: 'F28' },
      { ...lpn('LPN-2610-000011', 'RK-A-01-1', [['148537/A', 5]]), plRef: '55035596', caseNo: 'F29' },
    ]
    const [pl] = searchStock('55035596', cased, master, sampleLayout)
    expect(pl).toMatchObject({ kind: 'doc', title: 'PL 55035596', subtitle: '2 เคส', qty: 45 })
    expect(pl.boxes).toHaveLength(3)
    expect(boxCount(pl.boxes)).toBe(2)
    expect(searchStock('f29', cased, master, sampleLayout)[0]).toMatchObject({ kind: 'doc', title: 'เคส F29', subtitle: 'PL 55035596', qty: 5 })
    expect(searchStock('55035596 F28', cased, master, sampleLayout)[0]).toMatchObject({ kind: 'doc', title: 'PL 55035596 · เคส F28', qty: 40 })
  })
})

describe('mobile directions', () => {
  it('describes a multi-floor route step by step and draws it per floor', () => {
    const from = zone('RCV-01')
    const to = zone('F2-RK-D')
    const route = findRoute(sampleLayout, from.accessNodeId, to.accessNodeId)!
    const d = routeDirections(sampleLayout, route, from, to)
    expect(d.steps[0].text).toContain('เริ่มที่ RCV-01')
    expect(d.steps.some((s) => /^ขึ้น(บันได|ลิฟต์)ไป อาคาร A ชั้น 2/.test(s.text))).toBe(true)
    expect(d.steps.at(-1)!.text).toContain('ถึง RK-D')
    expect([...d.paths.keys()].sort()).toEqual(['F1', 'F2'])
  })

  it('walks across the link into building F and up the mezzanine stairs', () => {
    const from = zone('RCV-01')
    const to = zone('FBM-RK-G')
    const route = findRoute(sampleLayout, from.accessNodeId, to.accessNodeId)!
    const texts = routeDirections(sampleLayout, route, from, to).steps.map((s) => s.text)
    expect(texts).toContain('เดินต่อไป อาคาร F ชั้น 1')
    expect(texts).toContain('ขึ้นบันไดไป อาคาร F ชั้นลอย')
  })
})
