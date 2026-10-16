import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { buildLedger } from './ledger'

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

async function setup() {
  const api = demoWms()
  await api.createGrn({
    packingList: { refDoc: 'PL-1' },
    modelCode: 'K1G',
    lines: [
      { partNo: 'RAT00586', description: 'HUB', plQty: 1000, countedQty: 1000 },
      { partNo: 'RAT01088', description: 'RIM', plQty: 500, countedQty: 500 },
    ],
  })
  const items = async () => (await api.activeLpns()).flatMap((l) => l.items)
  const item = async (part: string) => (await items()).find((i) => i.partNo === part)!
  const onHand = async (part: string) => (await items()).filter((i) => i.partNo === part).reduce((s, i) => s + i.qty, 0)
  return { api, item, onHand }
}

describe('scan issue is a requisition (one issue path)', () => {
  it('a scan issue to the line is not cut again by the end-of-day FM-P-005', async () => {
    const { api, item, onHand } = await setup()
    await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 200, kind: 'line', modelCode: 'K1G', docNo: 'MRA-9', toDept: 'MRA ไลน์ประกอบ K1G' })
    expect(await onHand('RAT00586')).toBe(800)
    const r = await api.reconcileFm005({ docNo: '292333', docDate: today(), modelCode: 'K1G', lines: [{ partNo: 'RAT00586', qty: 200 }] })
    expect(r.subs).toBe(1)
    expect(await onHand('RAT00586')).toBe(800)
  })

  it('boxes scanned with the same paper number become one requisition, one line per part', async () => {
    const { api, item } = await setup()
    const a = await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 200, kind: 'line', modelCode: 'K1G', docNo: '777' })
    const b = await api.scanIssue({ itemId: (await item('RAT01088')).id, qty: 50, kind: 'line', modelCode: 'K1G', docNo: '777' })
    const c = await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 100, kind: 'line', modelCode: 'K1G', docNo: '777' })
    expect([a.appended, b.appended, c.appended]).toEqual([false, true, true])
    expect(new Set([a.id, b.id, c.id]).size).toBe(1)
    const [req] = await api.listRequisitions(today(), today())
    expect(req.lines.map((l) => [l.partNo, l.qty])).toEqual([
      ['RAT00586', 300],
      ['RAT01088', 50],
    ])
    // ไม่มีเลขใบเบิก ⇒ ใบใหม่ทุกครั้ง
    const d = await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 1, kind: 'line', modelCode: 'K1G' })
    expect(d.id).not.toBe(a.id)
  })

  it('QC and NG pulls land in their own FM-P-537 columns', async () => {
    const { api, item } = await setup()
    await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 10, kind: 'qc' })
    await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 5, kind: 'ng', modelCode: 'K1G' })
    await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 100, kind: 'line', modelCode: 'K1G' })
    const rows = await api.ledgerRows(['RAT00586'], new Date(Date.now() + 86400000).toISOString())
    const [sheet] = buildLedger(rows, [{ partNo: 'RAT00586', name: 'HUB', uamCode: null }], today().slice(0, 7))
    const sum = (k: 'issue' | 'qc' | 'ng') => sheet.lines.reduce((s, l) => s + l[k], 0)
    expect([sum('issue'), sum('qc'), sum('ng')]).toEqual([100, 10, 5])
    expect(sheet.closing).toBe(885)
  })

  it('guards: model required for the line, part must belong to the model, quantity in the box', async () => {
    const { api, item } = await setup()
    const id = (await item('RAT00586')).id
    await expect(api.scanIssue({ itemId: id, qty: 1, kind: 'line' })).rejects.toThrow('เลือก Model')
    await expect(api.scanIssue({ itemId: id, qty: 1, kind: 'line', modelCode: 'J1D' })).rejects.toThrow('ไม่ได้อยู่ใน Model J1D')
    await expect(api.scanIssue({ itemId: id, qty: 5000, kind: 'line', modelCode: 'K1G' })).rejects.toThrow('ไม่เกิน 1000')
  })

  it('voiding a scanned requisition puts the pieces back into the scanned box', async () => {
    const { api, item, onHand } = await setup()
    const r = await api.scanIssue({ itemId: (await item('RAT00586')).id, qty: 120, kind: 'line', modelCode: 'K1G' })
    await api.voidRequisition(r.id, 'สแกนผิดกล่อง')
    expect(await onHand('RAT00586')).toBe(1000)
  })
})

describe('count then adjust in one step', () => {
  it('records the count per part and returns the difference', async () => {
    const { api, item } = await setup()
    const it0 = await item('RAT00586')
    expect(await api.scanCountItem(it0.id, 990)).toBe(-10)
    const [count] = (await api.recentTx(5)).filter((t) => t.kind === 'COUNT')
    expect([count.partNo, count.qty, count.newQty]).toEqual(['RAT00586', 1000, 990])
    expect(await api.pendingAdjustments()).toHaveLength(0)
  })
})

describe('slots: layout owns the count, back office blocks / adds', () => {
  it('a layout save keeps blocked slots closed and special slots open', async () => {
    const api = demoWms()
    const master = await api.master()
    const zoneId = master.locations.find((l) => l.code.startsWith('RK-A-'))!.zoneId
    const codes = master.locations.filter((l) => l.zoneId === zoneId && l.active).map((l) => l.code)
    const kind = master.locations.find((l) => l.zoneId === zoneId)!.kind
    await api.upsertLocation({ code: codes[4], zoneId, kind, active: false })
    await api.upsertLocation({ code: 'RK-A-99-1', zoneId, kind, active: true })
    await api.saveLayout({ zones: [], removed: [], nodes: [], addEdges: [], dropEdges: [], locations: [{ zoneId, kind, codes }] })
    const after = (await api.master()).locations
    const at = (c: string) => after.find((l) => l.code === c)!
    expect([at(codes[4]).active, at(codes[4]).blocked]).toEqual([false, true])
    expect([at('RK-A-99-1').active, at('RK-A-99-1').manual]).toEqual([true, true])
    // ย่อผัง: ช่องท้ายปิด ช่องพิเศษยังอยู่
    await api.saveLayout({ zones: [], removed: [], nodes: [], addEdges: [], dropEdges: [], locations: [{ zoneId, kind, codes: codes.slice(0, 10) }] })
    const small = (await api.master()).locations
    expect(small.find((l) => l.code === codes[20])!.active).toBe(false)
    expect(small.find((l) => l.code === 'RK-A-99-1')!.active).toBe(true)
    // ช่องของโซนอื่น
    const other = master.locations.find((l) => l.zoneId !== zoneId && l.active)!
    await expect(api.upsertLocation({ ...other, zoneId })).rejects.toThrow('เป็นของโซนอื่น')
  })
})
