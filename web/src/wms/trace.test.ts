import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { bangkokDay } from './ledger'
import { boxPlace, docOptions, loadTrace, receiptSteps, reqSteps, reqUses, traceKind, traceQuery, type ReceiptTrace, type ReqTrace } from './trace'
import type { CheckPayload, MasterData, TraceTx } from './types'

const sheet = (more: Partial<CheckPayload> = {}): CheckPayload => ({
  modelCode: 'K1G',
  packingList: { refDoc: 'PL-T1', packages: 'Pallet 1-2' },
  invoice: { invoiceNo: 'INV-T1', lines: [{ lineNo: 1, partNo: 'RAT00586', description: 'HUB', qty: 30 }] },
  lines: [
    { caseNo: 'P-1', partNo: 'RAT00566', description: '', plQty: 50 },
    { caseNo: 'P-2', partNo: 'RAT00586', description: '', plQty: 30 },
  ],
  ...more,
})

/** รับของตามใบตรวจรับ → จัดเก็บ 1 กล่อง → เบิกเข้าไลน์ด้วยเลขใบเบิกกระดาษ */
async function received() {
  const api = demoWms()
  const master: MasterData = await api.master()
  const { id, checkNo } = await api.createCheck(sheet())
  await api.saveCheckCase(id, 'P-1', 'ok')
  await api.saveCheckCase(id, 'P-2', 'ok')
  const { grnId, grnNo } = await api.completeCheck(id)
  const boxes = (await api.grnDetail(grnId))!.lpns
  const spokes = boxes.find((b) => b.items[0].partNo === 'RAT00566')!
  await api.scanMove(spokes.id, 'RK-A-01-1', 'PUT')
  const docDate = bangkokDay(new Date().toISOString())
  const { reqNo } = await api.postRequisition({ kind: 'line', docNo: 'MRA-77', docDate, modelCode: 'K1G', lines: [{ partNo: 'RAT00566', qty: 20 }] })
  return { api, master, checkNo, grnId, grnNo, boxes, spokes, reqNo, docDate }
}

describe('trace queries', () => {
  it('reads document numbers from scanned links and tells numbers from parts', async () => {
    const master = await demoWms().master()
    expect(traceQuery(' https://x.workers.dev/t/lpn-2610-000017 ')).toBe('LPN-2610-000017')
    expect(traceQuery('https://x.workers.dev/g/GRN-2610-0003')).toBe('GRN-2610-0003')
    expect(traceQuery(' PL-K1G-1016 ')).toBe('PL-K1G-1016')
    expect(['LPN-2610-000017', 'grn-2610-0003', 'CNT-2610-0001', 'CHK-2610-0002', 'RQ-2610-0009', 'RAT00586/B', 'PL-K1G-1016'].map((q) => traceKind(q, master.parts))).toEqual([
      'lpn',
      'grn',
      'grn',
      'check',
      'req',
      'part',
      'doc',
    ])
  })
})

describe('tracing a receipt end to end (demo)', () => {
  it('follows a packing list through the check sheet, GRN, invoice, boxes, issues and the month', async () => {
    const { api, master, checkNo, grnNo, spokes, reqNo, docDate } = await received()
    const t = (await loadTrace(api, master, 'pl-t1')) as ReceiptTrace
    expect(t.type).toBe('receipt')
    expect([t.check?.checkNo, t.grn?.grnNo, t.invoice?.invoice.invoiceNo, t.focus]).toEqual([checkNo, grnNo, 'INV-T1', null])
    expect(t.boxes.map((b) => [b.lpn.items[0].partNo, b.place, b.now, b.issued, b.events.map((e) => e.kind).join('>')])).toEqual([
      ['RAT00566', 'store', 30, 20, 'RECEIVE>PUT>ISSUE'],
      ['RAT00586', 'staging', 30, 0, 'RECEIVE'],
    ])
    expect(t.reqs.map((r) => [r.reqNo, r.docNo, r.kind, r.model, r.day, r.qty, r.boxes, r.reconciled])).toEqual([
      [reqNo, 'MRA-77', 'line', 'K1G', docDate, 20, [spokes.lpnNo], false],
    ])
    expect(receiptSteps(t).map((s) => [s.key, s.code, s.tone])).toEqual([
      ['pl', 'PL-T1', 'ok'],
      ['check', checkNo, 'ok'],
      ['grn', grnNo, 'ok'],
      // Invoice มีแต่ RAT00586 · RAT00566 ที่รับมาไม่อยู่ใน Invoice ⇒ ต่าง 1 รายการ
      ['invoice', 'INV-T1', 'warn'],
      ['boxes', '2 กล่อง', 'work'],
      ['issue', '1 ใบเบิก', 'work'],
      ['ledger', `K1G ${docDate.slice(0, 7)}`, 'none'],
    ])
    expect(receiptSteps(t).find((s) => s.key === 'boxes')!.lines).toEqual(['ในช่อง 1 · รอจัดเก็บ 1', 'เหลือ 60 ชิ้น'])
    expect(receiptSteps(t).find((s) => s.key === 'issue')!.lines).toEqual(['เบิกไปแล้ว 20 ชิ้น', 'รอกระทบ FM-P-005 1 ใบ'])

    // ค้นด้วยเลขกล่อง / GRN / ใบตรวจรับ / Invoice ได้สายเดียวกัน
    const byBox = (await loadTrace(api, master, `https://x/t/${spokes.lpnNo}`)) as ReceiptTrace
    expect([byBox.type, byBox.grn?.grnNo, byBox.focus, byBox.boxes.length]).toEqual(['receipt', grnNo, spokes.lpnNo, 2])
    for (const q of [grnNo, checkNo, 'inv-t1']) expect(((await loadTrace(api, master, q)) as ReceiptTrace).grn?.grnNo).toBe(grnNo)
  })

  it('traces a requisition back to the boxes, receipt and packing list it took from', async () => {
    const { api, master, grnNo, spokes, reqNo } = await received()
    for (const q of [reqNo, 'mra-77']) {
      const t = (await loadTrace(api, master, q)) as ReqTrace
      expect(t.type).toBe('req')
      expect(t.sources).toEqual([
        { lpnId: spokes.id, lpnNo: spokes.lpnNo, partNo: 'RAT00566', qty: 20, fromLoc: 'RK-A-01-1', grnNo, plRef: 'PL-T1', invoiceNo: 'INV-T1', caseNo: 'P-1', reqNo },
      ])
      expect([t.fm005, t.subs]).toEqual([null, []])
      expect(reqSteps(t).map((s) => [s.key, s.code, s.tone])).toEqual([
        ['pl', 'PL-T1', 'ok'],
        ['grn', grnNo, 'ok'],
        ['boxes', '1 กล่อง', 'ok'],
        ['issue', reqNo, 'ok'],
        ['fm005', null, 'work'],
        ['ledger', `K1G ${t.req.docDate.slice(0, 7)}`, 'none'],
      ])
    }
    // FM-P-005 ของวันกระทบใบย่อย ⇒ ใบย่อยรู้ว่าใครกระทบ และ FM-P-005 เห็นใบย่อย + ที่มาของของ
    const docDate = bangkokDay(new Date().toISOString())
    const fm = await api.reconcileFm005({ docNo: 'FM-1', docDate, modelCode: 'K1G', lines: [{ partNo: 'RAT00566', qty: 25 }] })
    const sub = (await loadTrace(api, master, reqNo)) as ReqTrace
    expect(sub.fm005?.reqNo).toBe(fm.reqNo)
    const fmTrace = (await loadTrace(api, master, fm.reqNo)) as ReqTrace
    expect(fmTrace.subs.map((s) => s.reqNo)).toEqual([reqNo])
    expect(fmTrace.sources.map((s) => [s.partNo, s.qty, s.grnNo])).toEqual([['RAT00566', 25, grnNo]])
    expect(reqSteps(sub).find((s) => s.key === 'fm005')).toMatchObject({ code: fm.reqNo, tone: 'ok' })
    expect(reqSteps(fmTrace).find((s) => s.key === 'fm005')).toMatchObject({ code: fm.reqNo, lines: ['กระทบใบย่อย 1 ใบ'] })
  })

  it('opens the live document when the same number also matches a voided one, and says when nothing matches', async () => {
    const api = demoWms()
    const master = await api.master()
    const { id, checkNo } = await api.createCheck(sheet({ lines: [{ caseNo: 'P-1', partNo: 'RAT00566', description: '', plQty: 5 }] }))
    await api.saveCheckCase(id, 'P-1', 'ok')
    const { grnId, grnNo } = await api.completeCheck(id)
    await api.voidGrn(grnId, 'พิมพ์ผิด')
    // PL เดียวกัน: GRN ที่ยกเลิก + ใบตรวจรับที่เปิดกลับมา ⇒ เปิดใบตรวจรับ แล้วบอกว่ามี GRN ที่ยกเลิก
    const t = (await loadTrace(api, master, 'PL-T1')) as ReceiptTrace
    expect([t.type, t.check?.checkNo, t.check?.status, t.grn]).toEqual(['receipt', checkNo, 'open', null])
    expect(t.others.map((o) => [o.kind, o.query, o.active])).toEqual([['grn', grnNo, false]])
    // เปิด GRN ที่ยกเลิกตรง ๆ: กล่องถูกยกเลิก ไม่ขึ้นในใบ
    const voided = (await loadTrace(api, master, grnNo)) as ReceiptTrace
    expect(receiptSteps(voided).find((s) => s.key === 'grn')).toMatchObject({ tone: 'bad', lines: ['ยกเลิกแล้ว: พิมพ์ผิด'] })
    expect(await loadTrace(api, master, 'NOPE-1')).toEqual({ type: 'none', query: 'NOPE-1' })
    expect(await loadTrace(api, master, '   ')).toEqual({ type: 'none', query: '' })
  })

  it('shows where a part is now and its latest movements', async () => {
    const { api, master, spokes } = await received()
    const t = await loadTrace(api, master, 'rat00566')
    if (t.type !== 'part') throw new Error(t.type)
    expect(t.boxes.map((b) => [b.lpn.lpnNo, b.place, b.qty])).toEqual([[spokes.lpnNo, 'store', 30]])
    expect(t.byPlace).toEqual({ store: 30, staging: 0, mi3: 0, ng: 0, gone: 0 })
    expect(t.rows.map((r) => [r.kind, r.qty])).toEqual([
      ['ISSUE', 20],
      ['RECEIVE', 50],
    ])
  })
})

describe('trace helpers', () => {
  it('nets issues and returns per requisition and places boxes by their slot', () => {
    const tx = (kind: TraceTx['kind'], qty: number, reqId: string | null, more: Partial<TraceTx> = {}): TraceTx => ({
      id: `${kind}-${qty}-${reqId}`,
      kind,
      docNo: reqId ? `RQ-${reqId}` : null,
      lpnId: 'b1',
      lpnNo: 'LPN-1',
      lpnItemId: 'i1',
      partNo: 'P1',
      qty,
      newQty: null,
      passQty: null,
      ngQty: null,
      fromLoc: null,
      toLoc: null,
      ref: null,
      reason: null,
      status: 'done',
      createdCode: null,
      createdAt: '2026-10-17T03:00:00Z',
      decidedCode: null,
      requisitionId: reqId,
      box: null,
      req: null,
      ...more,
    })
    const uses = reqUses([tx('RECEIVE', 50, null), tx('ISSUE', 10, 'a'), tx('RETURN', 3, 'a'), tx('ISSUE', 5, 'b'), tx('RETURN', 5, 'b')])
    expect(uses.map((u) => [u.reqNo, u.qty])).toEqual([
      ['RQ-a', 7],
      ['RQ-b', 0],
    ])
    const locs = [
      { code: 'RCV-01', zoneId: 'z', kind: 'staging' as const, active: true },
      { code: 'MI3-QC', zoneId: 'z', kind: 'hold' as const, active: true },
      { code: 'NG-HOLD', zoneId: 'z', kind: 'ng' as const, active: true },
    ]
    const place = (locationCode: string, hold = false, status: 'active' | 'empty' = 'active') => boxPlace({ locationCode, hold, status }, locs)
    expect([place('RCV-01'), place('MI3-QC', true), place('MI3-QC'), place('NG-HOLD'), place('RK-A-01-1'), place('RK-A-01-1', false, 'empty')]).toEqual([
      'staging',
      'mi3',
      'staging',
      'ng',
      'store',
      'gone',
    ])
    expect(docOptions({ grns: [], checks: [], reqs: [], invoices: [] })).toEqual([])
  })
})
