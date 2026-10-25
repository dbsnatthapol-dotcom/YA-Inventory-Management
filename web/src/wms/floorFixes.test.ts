import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import { buildDashboard } from './dashboard'
import { demoWms } from './demoApi'
import { partsOffInvoice } from './invoiceLines'
import { reconcile } from './logic'
import { stockByPart } from './partCodes'
import { goodOf, stockMix, stockPartOf } from './stockMix'
import type { InvoiceView } from './types'

// ชุดหน้าคลัง B4–B7 C1 C2 (กติกาเดียวกับ migration 0024)

describe('B7 scan put-away / move only to a real, open slot', () => {
  it('refuses unknown and blocked slots, accepts a real one typed in lower case', async () => {
    const api = demoWms()
    const { grnId } = await api.createGrn({ packingList: { refDoc: 'PL-B7' }, modelCode: 'K1G', lines: [{ partNo: 'RAT00586', description: 'HUB', plQty: 10, countedQty: 10 }] })
    const [box] = (await api.grnDetail(grnId))!.lpns
    await expect(api.scanMove(box.id, 'RK-C-01-11', 'PUT')).rejects.toThrow('ไม่พบช่อง RK-C-01-11')
    const master = await api.master()
    const [slot, broken] = master.locations.filter((l) => l.kind === 'bin' && l.active && !l.blocked)
    // ปิดใช้จากหลังบ้าน (ชำรุด)
    await api.upsertLocation({ ...broken, active: false })
    await expect(api.scanMove(box.id, broken.code, 'PUT')).rejects.toThrow('ปิดใช้อยู่')
    await api.scanMove(box.id, ` ${slot.code.toLowerCase()} `, 'PUT')
    expect((await api.grnDetail(grnId))!.lpns[0].locationCode).toBe(slot.code)
  })
})

describe('B6 invoice reconcile with the same part on two lines', () => {
  const view = (received: number): InvoiceView => ({
    invoice: { id: 'i', invoiceNo: 'INV-B6', customerId: 'RE', poNo: null, docDate: null, movementType: null, status: 'open', statusNote: null, statusAt: null, imagePaths: [], createdAt: '' },
    lines: [
      { lineNo: 1, partNo: 'HUB', description: 'HUB', qty: 50 },
      { lineNo: 2, partNo: 'HUB', description: 'HUB', qty: 50 },
      { lineNo: 3, partNo: 'RIM', description: 'RIM', qty: 30 },
    ],
    grns: [],
    received: [
      { partNo: 'HUB', qty: received },
      { partNo: 'RIM', qty: 30 },
    ],
  })
  it('fills the lines in order instead of piling everything on the first line', () => {
    expect(reconcile(view(100)).map((r) => [r.lineNo, r.receivedQty, r.diff])).toEqual([
      [1, 50, 0],
      [2, 50, 0],
      [3, 30, 0],
    ])
    // ขาด 10: บรรทัดสุดท้ายของ part ขาด · เกิน 10: บรรทัดสุดท้ายรับส่วนเกิน
    expect(reconcile(view(90)).map((r) => r.diff)).toEqual([0, -10, 0])
    expect(reconcile(view(110)).map((r) => r.diff)).toEqual([0, 10, 0])
    expect(reconcile(view(30)).map((r) => [r.receivedQty, r.diff])).toEqual([
      [30, -20],
      [0, -50],
      [30, 0],
    ])
  })

  it('stores the whole-part invoice qty on every case line of the GRN', async () => {
    const api = demoWms()
    const { grnId } = await api.createGrn({
      invoice: { invoiceNo: 'INV-B6', lines: [{ lineNo: 1, partNo: 'RAT00586', description: 'HUB', qty: 50 }, { lineNo: 2, partNo: 'RAT00586', description: 'HUB', qty: 50 }] },
      packingList: { refDoc: 'PL-B6' },
      modelCode: 'K1G',
      lines: [
        { partNo: 'RAT00586', description: 'HUB', plQty: 50, countedQty: 50, caseNo: 'C1' },
        { partNo: 'RAT00586', description: 'HUB', plQty: 50, countedQty: 50, caseNo: 'C2' },
      ],
    })
    const lines = (await api.grnDetail(grnId))!.lines
    expect(lines.map((l) => l.invoiceQty)).toEqual([100, 100])
    // B5 ใบ GRN เทียบราย part: 50 + 50 = 100 ไม่ฟ้อง
    expect(partsOffInvoice(lines)).toEqual([])
  })
})

describe('B5 the printed GRN compares per part, not per case', () => {
  it('flags a part only when all of its cases together miss the invoice', () => {
    const line = (partNo: string, countedQty: number, invoiceQty: number | null) => ({ partNo, countedQty, invoiceQty })
    expect(partsOffInvoice([line('A', 50, 100), line('A', 50, 100), line('B', 9, 10), line('C', 5, null)])).toEqual(['B'])
  })
})

describe('B4 every open check sheet is listed', () => {
  it('puts open sheets first and keeps them even past the closed ones', async () => {
    const api = demoWms()
    const checks = await api.listChecks()
    const firstClosed = checks.findIndex((c) => c.status !== 'open')
    expect(firstClosed === -1 || checks.slice(firstClosed).every((c) => c.status !== 'open')).toBe(true)
  })
})

describe('C1 one stock definition on every page', () => {
  it('splits boxes into in-slot / waiting put-away / MI3 / NG', () => {
    expect([stockPartOf(true, 'storage'), stockPartOf(false, 'ng'), stockPartOf(false, 'receiving'), stockPartOf(false, 'inspection'), stockPartOf(false, 'storage'), stockPartOf(false, undefined)]).toEqual([
      'mi3',
      'ng',
      'putaway',
      'putaway',
      'ready',
      'ready',
    ])
    const mix = stockMix([
      { part: 'ready', qty: 10 },
      { part: 'putaway', qty: 5 },
      { part: 'mi3', qty: 7 },
    ])
    expect(goodOf(mix)).toEqual({ boxes: 2, qty: 15 })
  })

  it('makes the dashboard good stock equal to in-slot + waiting put-away', () => {
    const d = buildDashboard({
      today: '2026-10-17',
      period: 'today',
      model: null,
      layout: sampleLayout,
      master: { ...fixtureMaster, models: [{ code: 'K1G', customerId: 'RE', requiresInspection: false }] },
      lpns: fixtureLpns,
      reqs: [],
      activity: { receipts: [], qi: [], counts: [] },
      pending: { adjustments: 0, countSheets: 0 },
      closings: [],
    })
    const good = goodOf(d.kpi.mix)
    expect([good.qty, good.boxes]).toEqual([d.kpi.onHand, d.kpi.boxes])
    expect([d.kpi.mix.mi3.boxes, d.kpi.mix.mi3.qty]).toEqual([d.kpi.holdBoxes, d.kpi.holdQty])
    expect(d.kpi.mix.ng.qty).toBe(d.kpi.ngWaitQty)
  })
})

describe('C2 issue page "available" leaves out the NG area', () => {
  it('counts only boxes a line requisition can take', () => {
    const box = (locationCode: string, qty: number, hold = false) => ({ status: 'active', hold, locationCode, items: [{ partNo: 'P', qty }] })
    const stock = stockByPart([box('RK-A-01-1', 10), box('NG-HOLD', 5), box('MI3-QC', 3, true)], (c) => c === 'NG-HOLD')
    expect(stock.get('P')).toEqual({ total: 18, available: 10 })
  })
})
