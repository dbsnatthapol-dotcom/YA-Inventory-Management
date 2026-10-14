import { describe, expect, it } from 'vitest'
import { buildDemoState } from './demoSeed'
import { matchInvoice, matchPart, mockInvoiceReader, suggestZone } from './extraction'
import { availableForMra, bucketBalance, emptyState, InventoryError, moveLot, receiveInvoice } from './ledger'
import { PARTS, STOCK_SHEETS } from './masterData'
import { dailyStockReport, dashboardSummary, discrepancyReport, lotTrace, movementLog, zoneContents } from './reports'

const base = { invoiceDate: '2026-10-14', supplier: 'S', customerId: 'RE', provider: 'mock' as const, receivedBy: 'test' }
const at = '2026-10-14T02:00:00.000Z'

describe('invoice matching', () => {
  it('corrects common OCR confusions (O vs 0) and flags unknown parts', () => {
    expect(matchPart('RAJ0O550/B')).toMatchObject({ status: 'corrected', part: { partNo: 'RAJ00550/B' } })
    expect(matchPart('raj00537/b ')).toMatchObject({ status: 'corrected', part: { partNo: 'RAJ00537/B' } })
    expect(matchPart('ZZZ99999')).toEqual({ status: 'unknown', part: null })
  })

  it('suggests a zone by customer + part type and falls back to the customer default', () => {
    expect(suggestZone(PARTS.find((p) => p.partNo === 'RAJ00537/B')!)).toBe('F1-RK-C')
    expect(suggestZone({ ...PARTS[0], type: 'NEW-TYPE' })).toBe('TENT-D')
  })

  it('reads the mock K1G invoice and matches every line', async () => {
    const lines = matchInvoice(await mockInvoiceReader.read(null, 'k1g'))
    expect(lines.every((l) => l.part)).toBe(true)
    expect(lines.filter((l) => l.status === 'corrected')).toHaveLength(1)
  })
})

describe('receiving', () => {
  it('puts good qty in BOI, damaged in NG and reports shortages', () => {
    const s = receiveInvoice(emptyState(), { ...base, invoiceNo: 'INV-1', model: 'K1G', receivedAt: at }, [
      { partNo: 'RAJ00538/B', invoiceQty: 100, countedQty: 95, damagedQty: 5, zoneId: 'F1-RK-A' },
    ])
    expect(bucketBalance(s, 'INV-1#1', 'BOI')).toBe(90)
    expect(bucketBalance(s, 'INV-1#1', 'NG_SUPPLIER')).toBe(5)
    expect(discrepancyReport(s, s.receipts[0].id).map((d) => [d.type, d.qty])).toEqual([
      ['ขาด', 5],
      ['เสียหาย', 5],
    ])
  })

  it('rejects the same invoice twice', () => {
    const s = receiveInvoice(emptyState(), { ...base, invoiceNo: 'INV-1', model: 'K1G' }, [
      { partNo: 'RAJ00538/B', invoiceQty: 1, countedQty: 1, damagedQty: 0, zoneId: 'F1-RK-A' },
    ])
    expect(() => receiveInvoice(s, { ...base, invoiceNo: 'INV-1', model: 'K1G' }, [])).toThrow(InventoryError)
  })
})

describe('issuing and inspection rules', () => {
  const received = (model: string) =>
    receiveInvoice(emptyState(), { ...base, invoiceNo: 'INV-2', model, receivedAt: at }, [
      { partNo: '150324/A', invoiceQty: 100, countedQty: 100, damagedQty: 0, zoneId: 'F2-RK-E' },
    ])

  it('lets K1G go straight from BOI to MRA', () => {
    const s = moveLot(received('K1G'), { lotId: 'INV-2#1', kind: 'issue_mra', qty: 100, at })
    expect(bucketBalance(s, 'INV-2#1', 'MRA')).toBe(100)
  })

  it('blocks MRA issue for other models until MI3 passes the parts', () => {
    let s = received('J1D')
    expect(availableForMra(s, s.lots[0])).toBe(0)
    expect(() => moveLot(s, { lotId: 'INV-2#1', kind: 'issue_mra', qty: 1, at })).toThrow(/ต้องผ่าน MI3/)
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'to_mi3', qty: 60, at })
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'mi3_pass', qty: 55, at })
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'mi3_ng', qty: 5, to: 'NG_SUPPLIER', at })
    expect(availableForMra(s, s.lots[0])).toBe(55)
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'issue_mra', qty: 55, at })
    expect(() => moveLot(s, { lotId: 'INV-2#1', kind: 'issue_mra', qty: 1, at })).toThrow(InventoryError)
    expect(bucketBalance(s, 'INV-2#1', 'BOI')).toBe(40)
  })

  it('traces NG found in process back to its invoice and returns it', () => {
    let s = moveLot(received('K1G'), { lotId: 'INV-2#1', kind: 'issue_mra', qty: 10, at })
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'ng_in_process', qty: 2, to: 'NG_CUSTOMER', at })
    s = moveLot(s, { lotId: 'INV-2#1', kind: 'return_ng', from: 'NG_CUSTOMER', qty: 2, at })
    const trace = lotTrace(s, 'INV-2#1')
    expect(trace.receipt?.invoiceNo).toBe('INV-2')
    expect(trace.movements.map((m) => m.kind)).toEqual(['receive', 'issue_mra', 'ng_in_process', 'return_ng'])
    expect(() => moveLot(s, { lotId: 'INV-2#1', kind: 'return_ng', from: 'NG_CUSTOMER', qty: 1, at })).toThrow(InventoryError)
  })
})

describe('daily stock report', () => {
  it('splits flows by Bangkok day and keeps balances consistent', () => {
    const s = buildDemoState('2026-10-14')
    const rows = dailyStockReport(s, '2026-10-14')
    const rimFront = rows.find((r) => r.part.partNo === 'RAJ00537/B')!
    expect(rimFront).toMatchObject({ invoiceQty: 0, actualReceive: 0, mraIssued: 120, boi: 177, ngCustomer: 2, ngSupplier: 3 })
    const yesterday = dailyStockReport(s, '2026-10-13').find((r) => r.part.partNo === 'RAJ00537/B')!
    expect(yesterday).toMatchObject({ invoiceQty: 300, actualReceive: 297, mraIssued: 0, balance: 297 })
    // ใบรายงาน J1D นับเฉพาะ lot ของ invoice J1D/J1D4
    const j1d = STOCK_SHEETS.find((sh) => sh.id === 'RE-J1D')!
    const bearingJ1D = dailyStockReport(s, '2026-10-14', j1d).find((r) => r.part.partNo === '150324/A')!
    expect(bearingJ1D).toMatchObject({ boi: 590, mi3: 0, mraIssued: 200, pendingQc: 400, ngSupplier: 10, balance: 590 })
    // ภาพรวมทุก Model รวม lot ของ TWIN ที่อยู่ระหว่างตรวจ MI3 ด้วย
    expect(rows.find((r) => r.part.partNo === '150324/A')).toMatchObject({ boi: 590, mi3: 240, balance: 830 })
  })
})

describe('multi-model master', () => {
  it('merges shared parts across model sheets into one part', () => {
    expect(STOCK_SHEETS.map((sh) => sh.id)).toEqual(['RE-K1G', 'RE-J1D', 'RE-J1A', 'RE-J1C', 'RE-TWIN', 'RE-P4'])
    expect(PARTS.filter((p) => p.partNo === '150324/A')).toHaveLength(1)
    expect(PARTS.find((p) => p.partNo === '150324/A')!.models).toEqual(['K1G', 'J1D', 'J1D4', 'J1A', 'J1C', 'TWIN', 'P4M', 'P4D'])
    expect(new Set(PARTS.map((p) => p.partNo)).size).toBe(PARTS.length)
  })
})

describe('dashboard and movement log', () => {
  const s = buildDemoState('2026-10-14')

  it('summarises today by Bangkok day', () => {
    const d = dashboardSummary(s, '2026-10-14')
    expect(d.receipts).toBe(2)
    expect(d.issuedQty).toBe(120 + 4320 + 8640 + 100 + 200)
    expect(d.ngFoundQty).toBe(2 + 10 + 2)
    expect(d.hourly.reduce((a, h) => a + h.issued, 0)).toBe(d.issuedQty)
    expect(d.byModel.map((m) => m.model)).toEqual(['J1A', 'J1D', 'K1G', 'TWIN'])
  })

  it('tags every movement back to lot, invoice and model, newest first', () => {
    const log = movementLog(s, { from: '2026-10-14', to: '2026-10-14' })
    expect(log[0].movement.kind).toBe('issue_mra')
    expect(log.every((r) => r.receipt?.invoiceNo === r.lot.invoiceNo)).toBe(true)
    expect(movementLog(s, { q: 'RE-INV-2610-0152' }).every((r) => r.lot.model === 'TWIN')).toBe(true)
    expect(movementLog(s, { model: 'J1A', kind: 'mi3_ng' })).toHaveLength(1)
  })
})

describe('zone contents', () => {
  it('lists what is stored in a zone by model and lot', () => {
    const s = buildDemoState('2026-10-14')
    // Rack E ชั้น 2 เก็บลูกปืน/วาล์ว: ลูกปืน J1D (เหลือ 590) และวาล์ว J1A 300 · ลูกปืน TWIN อยู่ระหว่างตรวจ MI3 จึงไม่อยู่ในชั้นวาง
    const z = zoneContents(s, 'F2-RK-E')
    expect(z.models).toEqual([
      { model: 'J1D', qty: 590 },
      { model: 'J1A', qty: 300 },
    ])
    expect(z.totalQty).toBe(890)
    expect(z.pendingQcQty).toBe(400 + 300)
  })
})
