import { describe, expect, it } from 'vitest'
import { buildDemoState } from './demoSeed'
import { matchInvoice, matchPart, mockInvoiceReader, suggestZone } from './extraction'
import { availableForMra, bucketBalance, emptyState, InventoryError, moveLot, receiveInvoice } from './ledger'
import { PARTS } from './masterData'
import { dailyStockReport, discrepancyReport, lotTrace } from './reports'

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
    const bearing = rows.find((r) => r.part.partNo === '150324/A')!
    expect(bearing).toMatchObject({ boi: 790, mi3: 0, pendingQc: 400, ngSupplier: 10, balance: 790 })
  })
})
