import { describe, expect, it } from 'vitest'
import { saveThenReload } from './afterSave'
import { demoWms } from './demoApi'
import { invoiceLinesFromRows, tidyInvoiceLines } from './invoiceLines'
import { COUNT_HEADERS, planStockImport, type CountCtx } from './stockImport'

// ชุดแก้ด่วน A1 A2 A3 A5 B1 B2 (กติกาเดียวกับ migration 0022)

const hubAndRim = (api: ReturnType<typeof demoWms>, refDoc: string, qty = 10) =>
  api.createGrn({
    packingList: { refDoc },
    modelCode: 'K1G',
    lines: [
      { partNo: 'RAT00586', description: 'HUB', plQty: qty, countedQty: qty, caseNo: 'C1' },
      { partNo: 'RAT01088', description: 'RIM', plQty: qty, countedQty: qty, caseNo: 'C2' },
    ],
  })

describe('A1 approving a stale adjustment', () => {
  it('refuses when the box changed after the request, and shows the current qty', async () => {
    const api = demoWms()
    await hubAndRim(api, 'PL-A1')
    const hub = async () => (await api.activeLpns()).flatMap((l) => l.items).find((i) => i.partNo === 'RAT00586')!
    await api.scanAdjustRequest((await hub()).id, 8, 'นับได้ 8')
    await api.scanIssue({ itemId: (await hub()).id, qty: 5, kind: 'line', modelCode: 'K1G' })
    const [t] = await api.pendingAdjustments()
    expect([t.qty, t.newQty, t.nowQty]).toEqual([10, 8, 5])
    await expect(api.scanAdjustDecide(t.id, true)).rejects.toThrow('ตอนขอ 10 · ตอนนี้ 5')
    expect((await hub()).qty).toBe(5)
    await api.scanAdjustDecide(t.id, false)
    // นับใหม่แล้วขอใหม่ ⇒ อนุมัติได้
    await api.scanAdjustRequest((await hub()).id, 4, 'นับใหม่ได้ 4')
    const [again] = await api.pendingAdjustments()
    expect(again.nowQty).toBe(5)
    await api.scanAdjustDecide(again.id, true)
    expect((await hub()).qty).toBe(4)
  })
})

describe('A2 merging NG boxes', () => {
  it('never merges an NG box with a good box, and keeps NG merges in the NG area', async () => {
    const api = demoWms()
    const { id } = await api.createCheck({
      modelCode: 'K1G',
      packingList: { refDoc: 'PL-A2' },
      lines: [
        { caseNo: 'N1', partNo: 'RAT00566', description: '', plQty: 10 },
        { caseNo: 'N2', partNo: 'RAT00567', description: '', plQty: 10 },
      ],
    })
    for (const l of (await api.checkDetail(id))!.lines) await api.saveCheckLine(l.id, l.version, { actual: 10, damaged: 2, note: 'บุบ' })
    const { grnId } = await api.completeCheck(id)
    const boxes = (await api.grnDetail(grnId))!.lpns
    const ng = boxes.filter((b) => b.locationCode === 'NG-HOLD').map((b) => b.id)
    const good = boxes.filter((b) => b.locationCode !== 'NG-HOLD').map((b) => b.id)
    expect([ng.length, good.length]).toEqual([2, 2])
    await expect(api.mergeLpns([good[0], ng[0]])).rejects.toThrow('รวมกล่อง NG (ของเสียหาย) กับกล่องของดีไม่ได้')
    await expect(api.mergeLpns(ng, 'RCV-01')).rejects.toThrow('กล่อง NG รวมแล้วต้องอยู่พื้นที่กัก NG')
    await expect(api.mergeLpns(good, 'NG-HOLD')).rejects.toThrow('รวมกล่องของดีไปไว้พื้นที่กัก NG ไม่ได้')
    const m = await api.mergeLpns(ng)
    expect((await api.grnDetail(grnId))!.lpns.find((b) => b.lpnNo === m.lpnNo)?.locationCode).toBe('NG-HOLD')
  })
})

describe('A3 count sheet rows that overlap', () => {
  const ctx: CountCtx = {
    parts: [{ partNo: 'RAT00586', name: 'HUB', type: 'HUB', customerId: 'RE', models: ['K1G'] }],
    locations: [
      { code: 'RK-B-01-1', zoneId: 'F1-RK-B' },
      { code: 'RK-B-01-2', zoneId: 'F1-RK-B' },
    ],
    zones: [{ id: 'F1-RK-B', code: 'RK-B' }],
    lpns: [{ status: 'active', locationCode: 'RK-B-01-1', items: [{ id: 'a', lpnId: '1', grnLineId: 'g', partNo: 'RAT00586', qty: 20 }] }],
  }

  it('flags a zone row and a slot row of the same part before upload', () => {
    const { rows } = planStockImport(
      [COUNT_HEADERS, ['RK-B-01-1', 'RAT00586', '', '20', '20', ''], ['RK-B', 'RAT00586', '', '', '5', 'เจอเพิ่ม'], ['RK-B-01-2', 'RAT00586', '', '', '0', '']],
      ctx,
    )
    expect(rows.map((r) => r.status)).toEqual(['error', 'error', 'error'])
    expect(rows[0].messages).toEqual(['ซ้อนกับแถว 3 (RK-B) · part เดียวกันให้นับระดับเดียว: รายช่อง หรือทั้งโซน'])
    // ช่องต่างกันในโซนเดียวกัน ไม่ซ้อนกัน
    const slots = planStockImport([COUNT_HEADERS, ['RK-B-01-1', 'RAT00586', '', '', '20'], ['RK-B-01-2', 'RAT00586', '', '', '1']], ctx).rows
    expect(slots.map((r) => r.status)).toEqual(['match', 'over'])
  })

  it('the demo refuses the same overlap on submit', async () => {
    const api = demoWms()
    await expect(
      api.submitStockCount({
        lines: [
          { loc: 'RK-B-01-1', partNo: 'RAT00586', counted: 20 },
          { loc: 'rk-b', partNo: 'RAT00586', counted: 5 },
        ],
      }),
    ).rejects.toThrow('แถว 2: RAT00586 ที่ RK-B ซ้อนกับแถว 1 (RK-B-01-1)')
    await api.submitStockCount({
      lines: [
        { loc: 'RK-B-01-1', partNo: 'RAT00586', counted: 0 },
        { loc: 'RK-B', partNo: 'RAT01088', counted: 0 },
      ],
    })
    expect(await api.listStockCounts()).toHaveLength(1)
  })
})

describe('A5 returns after a merge', () => {
  it('voiding a requisition puts the pieces in the box the item is in now and opens it', async () => {
    const api = demoWms()
    const { grnId } = await hubAndRim(api, 'PL-A5')
    const boxes = (await api.grnDetail(grnId))!.lpns
    const hubItem = boxes.flatMap((b) => b.items).find((i) => i.partNo === 'RAT00586')!
    const r1 = await api.scanIssue({ itemId: hubItem.id, qty: 4, kind: 'line', modelCode: 'K1G' })
    const m = await api.mergeLpns(boxes.map((b) => b.id))
    const merged = () => api.grnDetail(grnId).then((d) => d!.lpns.find((b) => b.lpnNo === m.lpnNo)!)
    // เบิกของในกล่องรวมจนหมด ⇒ กล่องรวม "หมดแล้ว"
    for (const i of (await merged()).items) await api.scanIssue({ itemId: i.id, qty: i.qty, kind: 'line', modelCode: 'K1G' })
    expect((await merged()).status).toBe('empty')
    await api.voidRequisition(r1.id, 'คีย์ผิด')
    const back = await merged()
    expect(back.status).toBe('active')
    expect(back.items.find((i) => i.partNo === 'RAT00586')?.qty).toBe(4)
    const ret = (await api.recentTx(10)).find((t) => t.kind === 'RETURN')!
    expect([ret.lpnNo, ret.qty]).toEqual([m.lpnNo, 4])
  })
})

describe('B1 a part packed in several cases', () => {
  it('tidies invoice lines like check_inv_lines', () => {
    expect(
      tidyInvoiceLines([
        { lineNo: 1, partNo: ' rat00586 ', description: 'HUB', qty: 100 },
        { lineNo: 1, partNo: 'RAT00586', description: 'HUB', qty: 100 },
        { lineNo: 1, partNo: 'RAT01088', description: null, qty: 50 },
        { lineNo: null, partNo: 'RAT00566', qty: 7 },
        { partNo: '  ', qty: 1 },
      ]),
    ).toEqual([
      { lineNo: 1, partNo: 'RAT00586', description: 'HUB', qty: 100 },
      { lineNo: 2, partNo: 'RAT01088', description: '', qty: 50 },
      { lineNo: 3, partNo: 'RAT00566', description: '', qty: 7 },
    ])
  })

  it('sends one invoice line per part from the receiving rows', () => {
    const row = (partNo: string, invQty: number | null, invLine: number | null) => ({ partNo, description: partNo, invQty, invLine })
    expect(invoiceLinesFromRows([row('RAT00586', 100, null), row('RAT00586', 100, 4), row('RAT00586', 100, null), row('RAT01088', null, 2), row('RAT00566', 30, 1)])).toEqual([
      { lineNo: 4, partNo: 'RAT00586', description: 'RAT00586', qty: 100 },
      { lineNo: 1, partNo: 'RAT00566', description: 'RAT00566', qty: 30 },
    ])
  })

  it('the demo stores each invoice line once even if a client repeats it', async () => {
    const api = demoWms()
    const line = { lineNo: 1, partNo: 'RAT00586', description: 'HUB', qty: 100 }
    await api.createGrn({
      packingList: { refDoc: 'PL-B1' },
      modelCode: 'K1G',
      invoice: { invoiceNo: 'INV-B1', lines: [line, line, { ...line, lineNo: 1, partNo: 'RAT01088', qty: 40 }] },
      lines: [
        { partNo: 'RAT00586', description: 'HUB', plQty: 60, countedQty: 60, caseNo: 'C1' },
        { partNo: 'RAT00586', description: 'HUB', plQty: 40, countedQty: 40, caseNo: 'C2' },
        { partNo: 'RAT01088', description: 'RIM', plQty: 40, countedQty: 40, caseNo: 'C2' },
      ],
    })
    const view = (await api.invoiceView('INV-B1'))!
    expect(view.lines.map((l) => [l.lineNo, l.partNo, l.qty])).toEqual([
      [1, 'RAT00586', 100],
      [2, 'RAT01088', 40],
    ])
  })
})

describe('B2 save then reload', () => {
  it('a failed reload after a save is still a success', async () => {
    const seen: string[] = []
    const r = await saveThenReload(
      async () => 'RQ-1',
      (v) => seen.push(`saved ${v}`),
      [
        async () => {
          seen.push('reload box')
          throw new Error('offline')
        },
        () => {
          throw new Error('sync throw')
        },
      ],
    )
    expect(r).toEqual({ value: 'RQ-1', reloadFailed: true })
    expect(seen).toEqual(['saved RQ-1', 'reload box'])
    expect(await saveThenReload(async () => 1, () => undefined, [async () => 2])).toEqual({ value: 1, reloadFailed: false })
  })

  it('a failed save is an error and nothing reloads', async () => {
    let reloaded = false
    await expect(
      saveThenReload(
        async () => {
          throw new Error('สต็อกไม่พอ')
        },
        () => (reloaded = true),
        [() => (reloaded = true)],
      ),
    ).rejects.toThrow('สต็อกไม่พอ')
    expect(reloaded).toBe(false)
  })
})
