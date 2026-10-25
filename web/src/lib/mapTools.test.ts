import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { palletsFor } from '../data/warehouse'
import { buildZoneStock, NO_ACTIVITY, todayActivity, zoneLocator } from '../wms/mapStock'
import type { Grn, Requisition, Tx } from '../wms/types'
import { fixtureLpns, fixtureMaster } from './mapFixture'
import { mapStats } from './mapStats'

const stock = buildZoneStock(fixtureLpns, fixtureMaster, sampleLayout)

describe('map stock from warehouse boxes', () => {
  it('maps slot codes, zone codes and unknown slots of a zone onto the map', () => {
    const zoneOf = zoneLocator(fixtureMaster, sampleLayout)
    expect(['RK-A-01-1', 'MI3-QC', 'NG-HOLD', 'RK-A-99-9', 'RCV-01'].map(zoneOf)).toEqual(['F1-RK-A', 'F1-MI3', 'F1-NG', 'F1-RK-A', 'RCV-01'])
    expect(zoneOf('NOWHERE-9')).toBeNull()
  })

  it('shows one pallet per box label, with totals, models and the MI3 hold per zone', () => {
    const rkA = stock.get('F1-RK-A')!
    expect(rkA.totalQty).toBe(9050)
    expect(rkA.models).toEqual([{ model: 'K1G', qty: 9050 }])
    expect(palletsFor(rkA).map((p) => [p.lpnNo, p.qty])).toEqual([
      ['LPN-1', 6000],
      ['LPN-2', 3050],
    ])
    const mi3 = stock.get('F1-MI3')!
    expect([mi3.pendingQcQty, mi3.models[0].model, palletsFor(mi3)[0].hold]).toEqual([60, 'J1A', true])
    // ไม่มีโซนของกล่องที่หมด / ไม่ active / ช่องที่ไม่รู้จัก
    expect([...stock.keys()].sort()).toEqual(['F1-MI3', 'F1-NG', 'F1-RK-A', 'F1-RK-B'])
  })

  it('summarises good stock, boxes, rack usage, MI3 queue and NG for the map header', () => {
    const s = mapStats(sampleLayout, stock, NO_ACTIVITY)
    expect(s.boiQty).toBe(9050 + 200)
    // กล่องของดีเท่านั้น (นิยามเดียวกับหน้าภาพรวม) · ที่เหลืออยู่ในองค์ประกอบสต็อก
    expect(s.pallets).toBe(3)
    expect(s.mix).toEqual({ ready: { boxes: 3, qty: 9250 }, putaway: { boxes: 0, qty: 0 }, mi3: { boxes: 1, qty: 60 }, ng: { boxes: 1, qty: 20 } })
    expect([s.pendingQcQty, s.pendingQcBoxes, s.ngWaitingQty]).toEqual([60, 1, 20])
    expect(s.usedSlots).toBe(3)
    expect(s.usedSlots).toBeLessThanOrEqual(s.slots)
  })

  it("counts today's line issues (sub requisitions + FM-P-005 difference), GRNs and MI3 NG in Thai time", () => {
    const req = (kind: Requisition['kind'], docDate: string, lines: [number, number | null][], status: Requisition['status'] = 'posted') =>
      ({ kind, docDate, status, lines: lines.map(([qty, reqQty]) => ({ partNo: 'P', qty, reqQty, balance: null })) }) as Requisition
    const reqs = [
      req('line', '2026-10-14', [
        [100, 100],
        [50, 50],
      ]),
      req('line', '2026-10-13', [[999, 999]]),
      req('line', '2026-10-14', [[777, 777]], 'void'),
      req('fm005', '2026-10-14', [[300, 150]]),
      req('qc', '2026-10-14', [[10, 10]]),
    ]
    const grn = (receivedAt: string, grnNo = 'GRN-2610-0001', status: Grn['status'] = 'active') => ({ receivedAt, grnNo, status }) as Grn
    // ใบที่ยกเลิก และเอกสารกล่องจากการตรวจนับ (CNT-) ไม่นับ (C3)
    const grns = [grn('2026-10-14T03:00:00Z'), grn('2026-10-13T20:00:00Z'), grn('2026-10-13T03:00:00Z'), grn('2026-10-14T05:00:00Z', 'GRN-2610-0009', 'void'), grn('2026-10-14T06:00:00Z', 'CNT-2610-0001')]
    const tx = [
      { kind: 'QI', ngQty: 5, createdAt: '2026-10-14T04:00:00Z' },
      { kind: 'QI', ngQty: 3, createdAt: '2026-10-13T04:00:00Z' },
      // เสียหายตอนตรวจรับ → กล่อง NG (นับรวมกับ NG ของ MI3) · รับเข้าช่องปกติไม่นับ
      { kind: 'RECEIVE', qty: 4, toLoc: 'NG-HOLD', createdAt: '2026-10-14T03:00:00Z' },
      { kind: 'RECEIVE', qty: 90, toLoc: 'RCV-01', createdAt: '2026-10-14T03:00:00Z' },
    ] as unknown as Tx[]
    expect(todayActivity(reqs, grns, tx, '2026-10-14', (c) => c === 'NG-HOLD')).toEqual({ issuedToday: 300, receiptsToday: 2, ngFoundToday: 9 })
  })
})
