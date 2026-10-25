import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { closingDiffs, pendingAcks, thisMonth } from './closing'
import { buildLedger, monthRange, type LedgerSheet } from './ledger'
import { BOM_HEADERS, PART_HEADERS, planFgImport, planPartImport } from './masterImport'
import { PARTS } from '../inventory/masterData'
import { basePartNo, bomQty, canonCodes, canonPartNo, fgOfModel, partRevision, partsOfModel, resolvePart } from './partCodes'
import type { FgItem, PartMaster, StockClosing } from './types'

const parts: PartMaster[] = [
  { partNo: 'RAT00586', name: 'HUB, REAR', type: 'HUB', customerId: 'RE', models: ['K1G'], uamCode: '2011409', revision: 'B' },
  { partNo: 'RAT00566', name: 'SPOKE 1', type: 'SPOKE', customerId: 'RE', models: ['K1G'] },
  { partNo: 'RAT01088', name: 'RIM', type: 'RIM', customerId: 'RE', models: ['K1G'] },
  // เลขฐานซ้ำแต่เป็นคนละ part (รอยืนยัน) ⇒ ยังแยกด้วย revision
  { partNo: 'RAT00322/A', name: 'TUBE', type: 'TUBE', customerId: 'RE', models: [] },
  { partNo: 'RAT00322/D', name: 'TYRE', type: 'TYRE', customerId: 'RE', models: [] },
]

describe('part codes', () => {
  it('uses the base number: revision /A /B is ignored', () => {
    expect(basePartNo(' rat00586/b')).toBe('RAT00586')
    expect(partRevision('RAJ00268/A/A')).toBe('A/A')
    expect(resolvePart(parts, 'rat00586/b')?.partNo).toBe('RAT00586')
    expect(resolvePart(parts, 'RAT00586/C')?.partNo).toBe('RAT00586')
    expect(resolvePart(parts, 'RAT00586')?.partNo).toBe('RAT00586')
    expect(resolvePart(parts, '2011409')?.partNo).toBe('RAT00586')
    // เลข 0 นำหน้าหาย (เขียนมือ / ต้นฉบับพิมพ์ผิด)
    expect(resolvePart(parts, 'RAT1088/A')?.partNo).toBe('RAT01088')
    // เลขฐานตรงหลาย part ⇒ ไม่เดา · รหัสเต็มยังใช้ได้
    expect(resolvePart(parts, 'RAT00322')).toBeNull()
    expect(resolvePart(parts, 'RAT00322/D')?.partNo).toBe('RAT00322/D')
    expect(canonPartNo(parts, 'NEW1/C')).toBe('NEW1')
    expect(partsOfModel({ parts }, 'K1G').map((p) => p.partNo)).toEqual(['RAT00586', 'RAT01088', 'RAT00566'])
  })

  it('turns source codes into base numbers, keeping clashing bases apart', () => {
    const src = ['RAT00586/B', '150324/A', '150324/A', 'RAT00322/A', 'RAT00322/D']
    const m = canonCodes(src)
    expect(src.map((c) => m.get(c))).toEqual(['RAT00586', '150324', '150324', 'RAT00322/A', 'RAT00322/D'])
  })

  it('master data: confirmed codes RAT01088 and 150324', () => {
    const codes = new Set(PARTS.map((p) => p.partNo))
    expect(codes.has('RAT01088')).toBe(true)
    expect(codes.has('150324')).toBe(true)
    expect([...codes].filter((c) => c.includes('/'))).toEqual(['RAT00322/D', 'RAT00322/A'])
    expect(PARTS.find((p) => p.partNo === '150324')?.revision).toBe('A')
  })

  it('fills a requisition from the wheel BOM, not every part of the model', () => {
    const fg: FgItem = { code: 'K1G-RR', name: 'rear', modelCode: 'K1G', active: true, lines: [{ partNo: 'RAT00586', qtyPer: 1 }, { partNo: 'RAT00566', qtyPer: 9 }] }
    const old: FgItem = { ...fg, code: 'OLD', active: false }
    expect(fgOfModel({ fgItems: [fg, old] }, 'K1G').map((f) => f.code)).toEqual(['K1G-RR'])
    // FM-P-005: 290 วง ⇒ HUB 290, SPOKE 1 = 2,610
    expect(bomQty(fg, 290)).toEqual({ RAT00586: 290, RAT00566: 2610 })
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
    await api.postRequisition({ kind: 'line', docDate: today, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', reqQty: 600, qty: 600 }] })
    const lpns = await api.activeLpns()
    expect(qtyOf(lpns, 'H6906002')).toBe(400)
    // กล่องเที่ยวแรกหมด เหลือเที่ยวสอง
    const bolts = lpns.filter((l) => l.items.some((i) => i.partNo === 'H6906002'))
    expect(bolts).toHaveLength(1)
    await expect(api.postRequisition({ kind: 'line', docDate: today, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 401 }] })).rejects.toThrow(/ไม่พอ/)
    expect(qtyOf(await api.activeLpns(), 'H6906002')).toBe(400)
  })

  it('reconciles FM-P-005 against the day: issues the shortfall and returns the excess', async () => {
    const api = await stocked()
    const d = '2026-10-15'
    await api.postRequisition({ kind: 'line', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 300 }, { partNo: 'RAB00076', qty: 50 }] })
    await api.postRequisition({ kind: 'line', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 200 }] })
    // ใบย่อยวันอื่นไม่ถูกนับ
    await api.postRequisition({ kind: 'line', docDate: '2026-10-14', modelCode: 'TWIN', lines: [{ partNo: 'RAB00076', qty: 10 }] })
    const res = await api.reconcileFm005({ docNo: '292333', docDate: d, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 520 }, { partNo: 'RAB00076', qty: 40 }] })
    expect(res.subs).toBe(2)
    const lpns = await api.activeLpns()
    expect(qtyOf(lpns, 'H6906002')).toBe(1000 - 520)
    expect(qtyOf(lpns, 'RAB00076')).toBe(200 - 10 - 40)
    const reqs = await api.listRequisitions(d, d)
    const fm = reqs.find((r) => r.kind === 'fm005')!
    expect(fm.lines.map((l) => [l.partNo, l.reqQty, l.qty, l.balance])).toEqual([
      ['H6906002', 500, 520, 480],
      ['RAB00076', 50, 40, 150],
    ])
    expect(reqs.filter((r) => r.kind === 'line').every((r) => r.reconciledBy === fm.id)).toBe(true)
    await expect(api.reconcileFm005({ docNo: '292333', docDate: d, modelCode: 'TWIN', lines: [] })).rejects.toThrow(/บันทึกไปแล้ว/)
    // ใบที่กระทบแล้วยกเลิกไม่ได้
    await expect(api.voidRequisition(reqs.find((r) => r.kind === 'line')!.id, 'ผิด')).rejects.toThrow(/กระทบยอด/)
  })

  it('voids a sub requisition by putting the stock back', async () => {
    const api = await stocked()
    const { id } = await api.postRequisition({ kind: 'line', docDate: '2026-10-15', modelCode: 'TWIN', lines: [{ partNo: 'RAB00076', qty: 150 }] })
    expect(qtyOf(await api.activeLpns(), 'RAB00076')).toBe(50)
    await api.voidRequisition(id, 'คีย์ผิด')
    expect(qtyOf(await api.activeLpns(), 'RAB00076')).toBe(200)
  })
})

describe('stock ledger (FM-P-537)', () => {
  it('builds the month sheet: opening, receipts normal/replacement, issues, QC and running stock', async () => {
    const api = await stocked()
    const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })
    const month = day.slice(0, 7)
    await api.postRequisition({ kind: 'line', docNo: 'MRA-01', docDate: day, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 600 }] })
    await api.postRequisition({ kind: 'qc', docDate: day, lines: [{ partNo: 'H6906002', qty: 5 }] })
    const rows = await api.ledgerRows(['H6906002'], monthRange(month).to)
    const [sheet] = buildLedger(rows, [{ partNo: 'H6906002', name: 'BOLT', uamCode: null }], month)
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
    const [later] = buildLedger(rows, [{ partNo: 'H6906002', name: 'BOLT', uamCode: null }], next)
    expect([later.opening, later.lines.length, later.closing]).toEqual([395, 0, 395])
  })
})

describe('month-end close', () => {
  const lastMonth = () => {
    const [y, m] = thisMonth().split('-').map(Number)
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  }

  it('closes an ended month, locks its requisitions and collects Planning / accounting sign-off', async () => {
    const api = await stocked()
    await expect(api.closeMonth('TWIN', thisMonth())).rejects.toThrow(/จบเดือน/)
    const prev = lastMonth()
    await api.closeMonth('TWIN', prev)
    await expect(api.closeMonth('TWIN', prev)).rejects.toThrow(/ปิดยอดไปแล้ว/)
    const [c] = await api.listClosings()
    expect([c.modelCode, c.month, c.status]).toEqual(['TWIN', prev, 'closed'])
    // ใบเบิกลงวันที่ในเดือนที่ปิด ⇒ บันทึกไม่ได้ · Model อื่นไม่กระทบ
    const day = `${prev}-28`
    await expect(api.postRequisition({ kind: 'line', docDate: day, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 1 }] })).rejects.toThrow(/ปิดยอดแล้ว/)
    await api.postRequisition({ kind: 'line', docDate: day, modelCode: 'K1G', lines: [{ partNo: 'H6906002', qty: 1 }] })

    const all = (p: string) => p === 'ledger.ack.planning' || p === 'ledger.ack.account'
    expect(pendingAcks(await api.listClosings(), all)).toHaveLength(1)
    await api.ackClosing(c.id, 'planning')
    await expect(api.ackClosing(c.id, 'planning')).rejects.toThrow(/รับทราบไปแล้ว/)
    expect(pendingAcks(await api.listClosings(), (p) => p === 'ledger.ack.planning')).toHaveLength(0)
    expect(pendingAcks(await api.listClosings(), all)).toHaveLength(1)

    // เปิดเดือน ⇒ แก้ได้ · ปิดใหม่ ⇒ การรับทราบเริ่มใหม่
    await expect(api.reopenMonth(c.id, ' ')).rejects.toThrow(/เหตุผล/)
    await api.reopenMonth(c.id, 'ใบเบิกตกหล่น')
    await api.postRequisition({ kind: 'line', docDate: day, modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 1 }] })
    await api.closeMonth('TWIN', prev)
    const [again] = await api.listClosings()
    expect([again.id, again.status, again.planningAt]).toEqual([c.id, 'closed', null])
  })

  it('flags parts whose balance moved after closing', () => {
    const c = { totals: [{ partNo: 'A', opening: 0, in: 10, out: 0, closing: 10 }, { partNo: 'B', opening: 0, in: 5, out: 0, closing: 5 }] } as StockClosing
    const sheet = (partNo: string, closing: number) => ({ partNo, closing }) as LedgerSheet
    expect(closingDiffs(c, [sheet('A', 10), sheet('B', 3)])).toEqual([{ partNo: 'B', closed: 5, now: 3 }])
  })
})

describe('master import from Excel', () => {
  const master = {
    parts,
    models: [{ code: 'K1G', customerId: 'RE', requiresInspection: false }],
    fgItems: [{ code: '2019333', name: 'K1G rear', modelCode: 'K1G', active: true, lines: [{ partNo: 'RAT00586', qtyPer: 1 }] }],
  }

  it('checks every part row: base number, UAM code clashes, unknown models', () => {
    const plan = planPartImport(
      [
        PART_HEADERS,
        ['rat00586/B', '2011409', '', '', 'K1G'],
        ['RAT00566', '2011410', '', '', ''],
        ['NEW1/C', '2099999', 'NEW PART', 'bolt', 'K1G'],
        [],
        ['RAT01088', '2011409', '', '', 'XYZ'],
        ['RAT00566', '', '', '', ''],
      ],
      master,
    )
    // RAT00566 อยู่ 2 แถว ⇒ ผิดทั้งคู่ · รหัส UAM 2011409 ซ้ำแถว 2 กับ 6 ⇒ ผิดทั้งคู่
    expect(plan.map((p) => [p.row, p.part.partNo, p.status])).toEqual([
      [2, 'RAT00586', 'error'],
      [3, 'RAT00566', 'error'],
      [4, 'NEW1', 'new'],
      [6, 'RAT01088', 'error'],
      [7, 'RAT00566', 'error'],
    ])
    expect(plan[2].part).toMatchObject({ type: 'BOLT', revision: 'C', models: ['K1G'] })
    expect(plan[0].messages).toEqual(['รหัส UAM ซ้ำกับแถว 6'])
    expect(plan[3].messages.join()).toMatch(/Model XYZ.*2011409 เป็นของ RAT00586/)
    expect(plan[4].messages).toEqual(['ซ้ำกับแถว 3'])
  })

  it('groups BOM rows into wheel sets and accepts part or UAM codes', () => {
    const plan = planFgImport(
      [
        BOM_HEADERS,
        ['2019333', 'K1G rear', 'K1G', '2011409', '1'],
        ['2019333', '', '', 'RAT00566/B', '9'],
        ['2019400', 'K1G front', 'K1G', 'RAT01088', '1'],
        ['2019400', '', '', 'NOPE', '2'],
        ['2019401', 'same as before?', 'K1G', 'RAT00586', '0'],
      ],
      master,
    )
    expect(plan.map((g) => [g.fg.code, g.status, g.fg.lines.map((l) => `${l.partNo}×${l.qtyPer}`).join(' ')])).toEqual([
      ['2019333', 'update', 'RAT00586×1 RAT00566×9'],
      ['2019400', 'error', 'RAT01088×1'],
      ['2019401', 'error', ''],
    ])
    expect(plan[1].messages).toEqual(['แถว 5: ไม่พบ part "NOPE" ใน Master'])
  })
})
