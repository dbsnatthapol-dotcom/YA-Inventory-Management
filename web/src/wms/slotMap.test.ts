import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { box, fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import type { FactoryLayout, Zone } from '../types/layout'
import { layoutLocations, tentBlocks, zonePlan } from './locations'
import { buildSlotMap, findSlot, planSpots, spotAt, sumCounts } from './slotMap'

const map = buildSlotMap(sampleLayout, fixtureLpns, fixtureMaster)
const zoneById = (id: string) => sampleLayout.zones.find((z) => z.id === id)!

describe('warehouse plan: one cell per pallet slot', () => {
  it('generates exactly the slot codes of the layout (spot × level, tent blocks)', () => {
    for (const zone of sampleLayout.zones.filter((z) => z.kind === 'storage' || z.kind === 'tent')) {
      const zs = map.zones.get(zone.id)!
      const codes = zs.spots.flatMap((s) => s.levels.map((l) => l.code)).sort()
      const expected = layoutLocations(sampleLayout, [zone]).map((l) => l.code).sort()
      expect(codes, zone.code).toEqual(expected)
    }
  })

  it('puts every spot where the 3D model puts its pallet, inside the zone', () => {
    const zone = zoneById('F1-RK-A')
    const plan = zonePlan(sampleLayout, zone)
    const zs = map.zones.get(zone.id)!
    expect(zs.kind).toBe('floor')
    expect(zs.spots).toHaveLength(plan.perLevel)
    expect(zs.levels).toBe(plan.levels.length)
    // ระดับล่างของแผน 3D = จุดกึ่งกลางของช่องบนผัง (โซนแนวนอน: u ตามแกน x)
    zs.spots.forEach((s, i) => {
      expect(s.x + s.w / 2).toBeCloseTo(zone.x + plan.slots[i].u)
      expect(s.z + s.d / 2).toBeCloseTo(zone.z + plan.slots[i].v)
      expect(s.x).toBeGreaterThanOrEqual(zone.x)
      expect(s.z).toBeGreaterThanOrEqual(zone.z)
      expect(s.x + s.w).toBeLessThanOrEqual(zone.x + zone.width + 1e-9)
      expect(s.z + s.d).toBeLessThanOrEqual(zone.z + zone.depth + 1e-9)
    })
    // แถวพาเลท: แถวเดี่ยว + แถวคู่ (2 ฝั่ง) + แถวเดี่ยว = 4 แถว × 12 ที่
    expect(zs.faces).toEqual([12, 12, 12, 12])
  })

  it('turns spots for zones deeper than wide and trims to the spots per level', () => {
    const tall: Zone = { ...zoneById('F1-RK-A'), id: 'T', code: 'RK-T', width: 10, depth: 18, slotsPerLevel: 30 }
    const layout: FactoryLayout = { ...sampleLayout, zones: [tall] }
    const zs = buildSlotMap(layout, [], { locations: [], parts: [] }).zones.get('T')!
    const plan = zonePlan(layout, tall)
    expect(zs.spots).toHaveLength(30)
    expect(zs.faces).toEqual([12, 12, 6])
    expect([zs.spots[0].w, zs.spots[0].d]).toEqual([1.1, 1.35])
    zs.spots.forEach((s, i) => {
      expect(s.x + s.w / 2).toBeCloseTo(tall.x + plan.slots[i].v)
      expect(s.z + s.d / 2).toBeCloseTo(tall.z + plan.slots[i].u)
    })
    expect(planSpots(plan)).toHaveLength(30)
  })

  it('splits tents into blocks along the long side', () => {
    const zone = zoneById('TENT-T')
    const zs = map.zones.get(zone.id)!
    expect(zs.spots).toHaveLength(tentBlocks(zone))
    expect(zs.spots.reduce((s, b) => s + b.w, 0)).toBeCloseTo(zone.width)
    expect(zs.spots.every((b) => b.d === zone.depth && b.levels.length === 1)).toBe(true)
    const deep = map.zones.get('TENT-D')!
    expect(deep.spots.reduce((s, b) => s + b.d, 0)).toBeCloseTo(zoneById('TENT-D').depth)
  })
})

describe('slot status from boxes and back-office flags', () => {
  it('shows which slot holds which box, FIFO, with qty and model', () => {
    const rkA = map.zones.get('F1-RK-A')!
    const s1 = findSlot(rkA, 'RK-A-01-1')!
    expect([s1.slot.status, s1.slot.qty, s1.slot.boxes[0].lpnNo, s1.slot.boxes[0].model, s1.spot?.spot]).toEqual(['stock', 6000, 'LPN-1', 'K1G', 1])
    const s2 = findSlot(rkA, 'RK-A-01-2')!.slot
    expect([s2.level, s2.qty, s2.boxes[0].items.map((i) => i.partNo)]).toEqual([2, 3050, ['RAT00566', 'RAT00586']])
    // กล่องหมด / ไม่ active ไม่ทำให้ช่องมีของ
    expect(findSlot(rkA, 'RK-A-02-1')!.slot.status).toBe('empty')
    expect(findSlot(rkA, 'RK-A-03-1')!.slot.status).toBe('empty')
    expect(map.where.get('LPN-2')).toEqual({ zoneId: 'F1-RK-A', code: 'RK-A-01-2', spot: 1, level: 2 })
    expect([rkA.counts.stock, rkA.boxes, rkA.qty]).toEqual([2, 2, 9050])
  })

  it('keeps MI3 / NG / receiving boxes as boxes in the area and flags MI3 holds', () => {
    const mi3 = map.zones.get('F1-MI3')!
    expect(mi3.kind).toBe('area')
    expect(mi3.spots).toEqual([])
    expect(mi3.loose.map((b) => [b.lpnNo, b.hold])).toEqual([['LPN-4', true]])
    expect(mi3.holdBoxes).toBe(1)
    expect(map.where.get('LPN-5')).toEqual({ zoneId: 'F1-NG', code: 'NG-HOLD', spot: null, level: null })
    expect(map.unknown.map((b) => b.lpnNo)).toEqual(['LPN-8'])
  })

  it('marks blocked slots, keeps stock visible in a blocked slot, lists special slots and orphan codes', () => {
    const master = {
      ...fixtureMaster,
      locations: [
        ...fixtureMaster.locations.map((l) => (l.code === 'RK-A-05-1' || l.code === 'RK-A-06-1' ? { ...l, active: false, blocked: true } : l)),
        { code: 'RK-A-99-1', zoneId: 'F1-RK-A', kind: 'bin' as const, active: true, manual: true },
      ],
    }
    const lpns = [
      box('B-1', 'RK-A-06-1', [['RAT00566', 10]]),
      box('B-2', 'RK-A-99-1', [['RAT00566', 20]], { hold: true }),
      // ช่องที่ผังไม่มี (ไม่ใช่ช่องพิเศษ) → กล่องนอกช่องของโซน
      box('B-3', 'RK-A-77-1', [['RAT00566', 30]]),
    ]
    const rkA = buildSlotMap(sampleLayout, lpns, master).zones.get('F1-RK-A')!
    expect(findSlot(rkA, 'RK-A-05-1')!.slot.status).toBe('blocked')
    const stillThere = findSlot(rkA, 'RK-A-06-1')!.slot
    expect([stillThere.status, stillThere.blocked]).toEqual(['stock', true])
    expect(rkA.extra.map((s) => [s.code, s.status])).toEqual([['RK-A-99-1', 'hold']])
    expect(rkA.loose.map((b) => b.lpnNo)).toEqual(['B-3'])
    expect(rkA.counts.blocked).toBe(1)
    expect([rkA.boxes, rkA.holdBoxes, rkA.qty]).toEqual([3, 1, 60])
  })

  it('finds the spot under a tap and sums a floor', () => {
    const rkA = map.zones.get('F1-RK-A')!
    const s = rkA.spots[5]
    expect(spotAt(rkA, s.x + s.w / 2, s.z + s.d / 2)?.spot).toBe(6)
    expect(spotAt(rkA, s.x - 0.05, s.z + s.d / 2)).not.toBeNull()
    // กลางทางเดินในโซน: ไม่มีที่วาง
    const zone = zoneById('F1-RK-A')
    expect(spotAt(rkA, zone.x + zone.width / 2, zone.z + 2.5)).toBeNull()
    const f1 = sumCounts([...map.zones.values()].filter((z) => z.floorId === 'F1'))
    expect(f1.counts.stock).toBe(3)
    expect(f1.boxes).toBe(5)
    expect(f1.slots).toBe(f1.counts.empty + f1.counts.stock + f1.counts.hold + f1.counts.blocked)
  })
})
