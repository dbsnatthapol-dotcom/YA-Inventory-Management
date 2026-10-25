import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { monthRange } from './ledger'
import { COUNT_HEADERS, countLocations, countTemplateRows, planStockImport, type CountCtx } from './stockImport'

const ctx: CountCtx = {
  parts: [
    { partNo: 'RAT00586', name: 'HUB', type: 'HUB', customerId: 'RE', models: ['K1G'], uamCode: '2011409' },
    { partNo: 'RAT01088', name: 'RIM', type: 'RIM', customerId: 'RE', models: ['K1G'] },
  ],
  locations: [
    { code: 'RK-B-01-1', zoneId: 'F1-RK-B' },
    { code: 'RK-B-01-2', zoneId: 'F1-RK-B' },
    { code: 'RCV-01', zoneId: 'RCV-01' },
  ],
  zones: [
    { id: 'F1-RK-B', code: 'RK-B' },
    { id: 'RCV-01', code: 'RCV-01' },
  ],
  lpns: [
    { status: 'active', locationCode: 'RK-B-01-1', items: [{ id: 'a', lpnId: '1', grnLineId: 'g', partNo: 'RAT00586', qty: 300 }] },
    { status: 'active', locationCode: 'RK-B-01-2', items: [{ id: 'b', lpnId: '2', grnLineId: 'g', partNo: 'RAT00586', qty: 200 }] },
    { status: 'empty', locationCode: 'RK-B-01-2', items: [{ id: 'c', lpnId: '3', grnLineId: 'g', partNo: 'RAT00586', qty: 999 }] },
  ],
}

describe('stock count import', () => {
  it('reads a slot or a whole zone', () => {
    expect(countLocations('rk-b-01-1', ctx)).toEqual({ locs: ['RK-B-01-1'], zoneId: 'F1-RK-B' })
    expect(countLocations('RK-B', ctx)).toEqual({ locs: ['RK-B-01-1', 'RK-B-01-2', 'RK-B'], zoneId: 'F1-RK-B' })
    expect(countLocations('XX', ctx)).toBeNull()
  })

  it('builds the template from active boxes, per slot or summed per zone', () => {
    expect(countTemplateRows(ctx, { zoneId: null, byZone: false }).map((r) => `${r.loc} ${r.partNo} ${r.system}`)).toEqual(['RK-B-01-1 RAT00586 300', 'RK-B-01-2 RAT00586 200'])
    expect(countTemplateRows(ctx, { zoneId: 'F1-RK-B', byZone: true }).map((r) => `${r.loc} ${r.system}`)).toEqual(['RK-B 500'])
    expect(countTemplateRows(ctx, { zoneId: 'RCV-01', byZone: false })).toEqual([])
  })

  it('compares counted against the system and flags bad rows', () => {
    const { rows, skipped } = planStockImport(
      [
        ['Union Autoparts Manufacturing Co., Ltd.'],
        [],
        COUNT_HEADERS,
        ['RK-B-01-1', 'RAT00586/B', '', '300', '290', ''],
        ['RK-B-01-2', '2011409', '', '200', '200', ''],
        ['RK-B', 'RAT1088', '', '', '12', 'เจอเพิ่ม'],
        ['RCV-01', 'RAT00586', '', '', '', ''],
        ['NOPE', 'RAT00586', '', '', '1', ''],
        ['RCV-01', 'ZZZ', '', '', 'abc', ''],
      ],
      ctx,
    )
    expect(skipped).toBe(1)
    expect(rows.map((r) => [r.row, r.loc, r.partNo, r.system, r.counted, r.diff, r.status])).toEqual([
      [4, 'RK-B-01-1', 'RAT00586', 300, 290, -10, 'short'],
      [5, 'RK-B-01-2', 'RAT00586', 200, 200, 0, 'match'],
      [6, 'RK-B', 'RAT01088', 0, 12, 12, 'over'],
      [8, 'NOPE', 'RAT00586', 0, 1, 0, 'error'],
      [9, 'RCV-01', 'ZZZ', 0, 0, 0, 'error'],
    ])
    expect(rows[4].messages).toHaveLength(2)
    const dup = planStockImport([COUNT_HEADERS, ['RK-B', 'RAT00586', '', '', '1'], ['rk-b', 'RAT00586/B', '', '', '2']], ctx).rows
    expect(dup.map((r) => r.status)).toEqual(['error', 'error'])
  })

  it('demo: submit, approve and post the differences to the ledger', async () => {
    const api = demoWms()
    const lines = [
      { partNo: 'H6906002/B', description: 'BOLT', plQty: 500, countedQty: 500 },
      { partNo: 'RAB00076/A', description: 'DISC', plQty: 100, countedQty: 100 },
    ]
    await api.createGrn({ packingList: { refDoc: 'PL-1' }, modelCode: 'TWIN', lines })
    await api.createGrn({ packingList: { refDoc: 'PL-2' }, modelCode: 'TWIN', lines })
    // ของรับเข้าอยู่ที่ RCV-01: นับ BOLT ได้ 950 (ขาด 50), DISC 250 (เกิน 50), BEARING 10 (ไม่มีกล่อง → กล่องใหม่)
    const { id, countNo } = await api.submitStockCount({
      note: 'นับประจำเดือน',
      lines: [
        { loc: 'RCV-01', partNo: 'H6906002', counted: 950 },
        { loc: 'rcv-01', partNo: 'RAB00076/A', counted: 250 },
        { loc: 'RCV-01', partNo: '150324', counted: 10 },
      ],
    })
    expect(countNo).toMatch(/^CNT-/)
    let [c] = await api.listStockCounts()
    expect(c.lines.map((l) => [l.partNo, l.systemQty, l.countedQty])).toEqual([
      ['H6906002', 1000, 950],
      ['RAB00076', 200, 250],
      ['150324', 0, 10],
    ])
    // ยังไม่อนุมัติ = ยอดยังไม่เปลี่ยน
    const qty = async (part: string) => (await api.activeLpns()).flatMap((l) => l.items).filter((i) => i.partNo === part).reduce((s, i) => s + i.qty, 0)
    expect(await qty('H6906002')).toBe(1000)
    await expect(api.decideStockCount(id, false)).rejects.toThrow(/เหตุผล/)
    const r = await api.decideStockCount(id, true)
    expect(r).toMatchObject({ changed: 3, newBoxes: 1 })
    expect([await qty('H6906002'), await qty('RAB00076'), await qty('150324')]).toEqual([950, 250, 10])
    // ขาด ลดจากกล่องที่เข้าก่อน
    const bolts = (await api.activeLpns()).filter((l) => l.items.some((i) => i.partNo === 'H6906002')).sort((a, b) => a.lpnNo.localeCompare(b.lpnNo))
    expect(bolts.map((b) => b.items[0].qty)).toEqual([450, 500])
    ;[c] = await api.listStockCounts()
    expect([c.status, c.lines.map((l) => l.appliedQty)]).toEqual(['approved', [-50, 50, 10]])
    await expect(api.decideStockCount(id, true)).rejects.toThrow(/พิจารณาไปแล้ว/)
    const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
    const ledger = await api.ledgerRows(['H6906002', '150324'], monthRange(month).to)
    expect(ledger.filter((x) => x.col === 'adj').map((x) => [x.partNo, x.qty, x.docNo])).toEqual([
      ['H6906002', -50, countNo],
      ['150324', 10, countNo],
    ])
    // ยอดเปลี่ยนหลังส่ง (เบิกไปแล้ว) ⇒ อนุมัติไม่ได้ ต้องนับใหม่
    const again = await api.submitStockCount({ lines: [{ loc: 'RCV-01', partNo: 'H6906002', counted: 0 }] })
    await api.postRequisition({ kind: 'line', docDate: '2026-10-16', modelCode: 'TWIN', lines: [{ partNo: 'H6906002', qty: 900 }] })
    await expect(api.decideStockCount(again.id, true)).rejects.toThrow(/ไม่พอลด/)
    expect(await qty('H6906002')).toBe(50)
  })
})
