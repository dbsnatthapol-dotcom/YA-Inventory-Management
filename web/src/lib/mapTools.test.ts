import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { palletsFor } from '../data/warehouse'
import { buildDemoState } from '../inventory/demoSeed'
import { zoneContents, zoneTotals } from '../inventory/reports'
import { mapStats } from './mapStats'
import { searchMap } from './search'

const state = buildDemoState('2026-10-14')

describe('map search', () => {
  it('finds a part regardless of slash, case and spaces, on-shelf lots first', () => {
    const hits = searchMap('raj00537b', sampleLayout, state)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.kind === 'lot' && h.lot.partNo === 'RAJ00537/B')).toBe(true)
    const first = hits[0]
    expect(first.kind === 'lot' && first.boi).toBeGreaterThan(0)
  })

  it('finds zones by code and lots by invoice number', () => {
    expect(searchMap('RK-A', sampleLayout, state)[0]).toMatchObject({ kind: 'zone', zone: { id: 'F1-RK-A' } })
    const byInvoice = searchMap('RE-INV-2610-0152', sampleLayout, state)
    expect(byInvoice.length).toBeGreaterThan(0)
    expect(byInvoice.every((h) => h.kind === 'lot' && h.lot.model === 'TWIN')).toBe(true)
    expect(searchMap('x', sampleLayout, state)).toEqual([])
  })
})

describe('pallets and map stats', () => {
  it('splits each lot into pallets whose pieces add up to the lot balance', () => {
    const z = zoneContents(state, 'F1-RK-A')
    const pallets = palletsFor(z)
    for (const item of z.items) {
      const mine = pallets.filter((p) => p.lotId === item.lot.id)
      expect(mine.reduce((s, p) => s + p.qty, 0)).toBe(item.qty)
      expect(mine.every((p) => p.qty > 0)).toBe(true)
    }
  })

  it('summarises stock, rack usage, MI3 queue and NG for the map header', () => {
    const s = mapStats(sampleLayout, state, zoneTotals(state), '2026-10-14')
    expect(s.boiQty).toBeGreaterThan(0)
    expect(s.usedSlots).toBeLessThanOrEqual(s.slots)
    // J1D/J1A/TWIN ที่ยังไม่ผ่านการคัด รวมทุกโซน (Rack E โซนเดียวมี 700)
    expect(s.pendingQcQty).toBeGreaterThanOrEqual(700)
    expect(s.pendingQcLots).toBeGreaterThan(0)
    expect(s.issuedToday).toBe(120 + 4320 + 8640 + 100 + 200)
    expect(s.ngWaitingQty).toBeGreaterThan(0)
  })
})
