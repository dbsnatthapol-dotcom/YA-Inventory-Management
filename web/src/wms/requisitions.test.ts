import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { buildLedger, monthRange } from './ledger'
import { bomQty, fgOfModel, partsOfModel, resolvePart } from './partCodes'
import type { FgItem, PartMaster } from './types'

const parts: PartMaster[] = [
  { partNo: 'RAT00586/B', name: 'HUB, REAR', type: 'HUB', customerId: 'RE', models: ['K1G'], uamCode: '2011409' },
  { partNo: 'RAT00566/B', name: 'SPOKE 1', type: 'SPOKE', customerId: 'RE', models: ['K1G'] },
  { partNo: 'RAT00999/A', name: 'X', type: null, customerId: 'RE', models: [] },
  { partNo: 'RAT00999/B', name: 'X rev B', type: null, customerId: 'RE', models: [] },
]

describe('part codes', () => {
  it('accepts the customer code with or without revision, or the UAM code', () => {
    expect(resolvePart(parts, 'rat00586/b')?.partNo).toBe('RAT00586/B')
    expect(resolvePart(parts, 'RAT00586')?.partNo).toBe('RAT00586/B')
    expect(resolvePart(parts, '2011409')?.partNo).toBe('RAT00586/B')
    // ไม่มี revision แต่มีหลาย revision ⇒ ไม่เดา
    expect(resolvePart(parts, 'RAT00999')).toBeNull()
    expect(partsOfModel({ parts }, 'K1G').map((p) => p.partNo)).toEqual(['RAT00586/B', 'RAT00566/B'])
  })

  it('fills a requisition from the wheel BOM, not every part of the model', () => {
    const fg: FgItem = { code: 'K1G-RR', name: 'rear', modelCode: 'K1G', active: true, lines: [{ partNo: 'RAT00586/B', qtyPer: 1 }, { partNo: 'RAT00566/B', qtyPer: 9 }] }
    const old: FgItem = { ...fg, code: 'OLD', active: false }
    expect(fgOfModel({ fgItems: [fg, old] }, 'K1G').map((f) => f.code)).toEqual(['K1G-RR'])
    // FM-P-005: 290 วง ⇒ HUB 290, SPOKE 1 = 2,610
    expect(bomQty(fg, 290)).toEqual({ 'RAT00586/B': 290, 'RAT00566/B': 2610 })
  })
})

const sampleLines = [
  { partNo: 'H6906002/B', description: 'BOLT', plQty: 500, countedQty: 500 },
  { partNo: 'RAB00076/A', description: 'BRAKE DISC', plQty: 100, countedQty: 100 },
]

async function stocked() {
  const api = demoWms()
  // รับ 2 เที่ยว (FIFO ต้องตัดเที่ยวแรกก่อน)
  await api.createGrn({ packingList: { refDoc: 'PL-1' }, modelCode: 'TWIN', lines: sampleLines })
  await api.createGrn({ packingList: { refDoc: 'PL-2' }, modelCode: 'TWIN', lines: sampleLines, replacement: true })
  return api
}
const qtyOf = (lpns: Awaited<ReturnType<ReturnType<typeof demoWms>['activeLpns']>>, part: string) =>
  lpns.flatMap((l) => l.items).filter((i) => i.partNo === part).reduce((s, i) => s + i.qty, 0)

describe('line requisitions', () => {
  it('cuts stock first-in-first-out and refuses to go below zero', async () => {
    const api = await stocked()
    const today = '2026-10-15'
    await api.postRequisition({ kind: 'line', docDate: today, modelCode: 'TWIN', lines: [{ partNo: 'H6906002/B', reqQty: 600, qty: 600 }] })
    const lpns = await api.activeLpns()
    expect(qtyOf(lpns, 'H6906002/B')).toBe(400)
    // กล่องเที่ยวแรกหมด เหลือเที่ยวสอง
    const bolts = lpns.filter((l) => l.items.some((i) => i.partNo === 'H6906002/B'))
    expect(bolts).toHaveLength(1)
    await expect(api.postRequisition({ kind: 'line', docDate: today, lines: [{ partNo: 'H6906002/B', qty: 401 }] })).rejects.toThrow(/ไม่พอ/)
    expect(qtyOf(await api.activeLpns(), 'H6906002/B')).toBe(400)
  })

  it('reconciles FM-P-005 against the day: issues the shortfall and returns the excess', async () => {
    const api = await stocked()
    const d = '2026-10-15'
    await api.postRequisition({ kind: 'line', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002/B', qty: 300 }, { partNo: 'RAB00076/A', qty: 50 }] })
    await api.postRequisition({ kind: 'line', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002/B', qty: 200 }] })
    // ใบย่อยวันอื่นไม่ถูกนับ
    await api.postRequisition({ kind: 'line', docDate: '2026-10-14', modelCode: 'TWIN', lines: [{ partNo: 'RAB00076/A', qty: 10 }] })
    const res = await api.reconcileFm005({ docNo: '292333', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002/B', qty: 520 }, { partNo: 'RAB00076/A', qty: 40 }] })
    expect(res.subs).toBe(2)
    const lpns = await api.activeLpns()
    expect(qtyOf(lpns, 'H6906002/B')).toBe(1000 - 520)
    expect(qtyOf(lpns, 'RAB00076/A')).toBe(200 - 10 - 40)
    const reqs = await api.listRequisitions(d, d)
    const fm = reqs.find((r) => r.kind === 'fm005')!
    expect(fm.lines.map((l) => [l.partNo, l.reqQty, l.qty, l.balance])).toEqual([
      ['H6906002/B', 500, 520, 480],
      ['RAB00076/A', 50, 40, 150],
    ])
    expect(reqs.filter((r) => r.kind === 'line').every((r) => r.reconciledBy === fm.id)).toBe(true)
    await expect(api.reconcileFm005({ docNo: '292333', docDate: d, modelCode: 'TWIN', lines: [] })).rejects.toThrow(/บันทึกไปแล้ว/)
    // ใบที่กระทบแล้วยกเลิกไม่ได้
    await expect(api.voidRequisition(reqs.find((r) => r.kind === 'line')!.id, 'ผิด')).rejects.toThrow(/กระทบยอด/)
  })

  it('voids a sub requisition by putting the stock back', async () => {
    const api = await stocked()
    const { id } = await api.postRequisition({ kind: 'line', docDate: '2026-10-15', modelCode: 'TWIN', lines: [{ partNo: 'RAB00076/A', qty: 150 }] })
    expect(qtyOf(await api.activeLpns(), 'RAB00076/A')).toBe(50)
    await api.voidRequisition(id, 'คีย์ผิด')
    expect(qtyOf(await api.activeLpns(), 'RAB00076/A')).toBe(200)
  })
})

describe('stock ledger (FM-P-537)', () => {
  it('builds the month sheet: opening, receipts normal/replacement, issues, QC and running stock', async () => {
    const api = await stocked()
    const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
    await api.postRequisition({ kind: 'line', docNo: 'MRA-01', docDate: '2026-10-15', modelCode: 'TWIN', lines: [{ partNo: 'H6906002/B', qty: 600 }] })
    await api.postRequisition({ kind: 'qc', docDate: '2026-10-15', lines: [{ partNo: 'H6906002/B', qty: 5 }] })
    const rows = await api.ledgerRows(['H6906002/B'], monthRange(month).to)
    const [sheet] = buildLedger(rows, [{ partNo: 'H6906002/B', name: 'BOLT', uamCode: null }], month)
    expect(sheet.opening).toBe(0)
    expect(sheet.lines.map((l) => [l.recv, l.recvRep, l.issue, l.qc, l.stock])).toEqual([
      [500, 0, 0, 0, 500],
      [0, 500, 0, 0, 1000],
      // เบิก FIFO 2 กล่อง รวมเป็นบรรทัดเดียว อ้างเลขใบเบิกบนเอกสาร
      [0, 0, 600, 0, 400],
      [0, 0, 0, 5, 395],
    ])
    expect(sheet.lines[2].docNo).toBe('MRA-01')
    expect([sheet.totalIn, sheet.totalOut, sheet.closing]).toEqual([1000, 605, 395])
    // เดือนถัดไป: ยกมา = คงเหลือ
    const [y, m] = month.split('-').map(Number)
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
    const [later] = buildLedger(rows, [{ partNo: 'H6906002/B', name: 'BOLT', uamCode: null }], next)
    expect([later.opening, later.lines.length, later.closing]).toEqual([395, 0, 395])
  })
})
