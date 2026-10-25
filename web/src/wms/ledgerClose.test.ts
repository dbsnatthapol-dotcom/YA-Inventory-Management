import { describe, expect, it } from 'vitest'
import { thisMonth } from './closing'
import { demoWms } from './demoApi'
import { bangkokDay, buildLedger, monthRange, NO_MODEL, onDocDate, rowsOfModel } from './ledger'

// ชุดบัญชีคุม / ปิดเดือน A4 A6 A7 A8 D2 (กติกาเดียวกับ migration 0023)

const SHARED = '150324' // bearing ใช้ร่วม 8 Model (K1G, TWIN, ...)
const today = () => bangkokDay(new Date().toISOString())
const lastMonth = () => {
  const [y, m] = thisMonth().split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const part = { partNo: SHARED, name: 'BEARING', uamCode: null }

async function twoModels() {
  const api = demoWms()
  // TWIN รับ 100 ก่อน แล้ว K1G รับ 50
  await api.createGrn({ packingList: { refDoc: 'PL-TWIN' }, modelCode: 'TWIN', lines: [{ partNo: SHARED, description: 'BEARING', plQty: 100, countedQty: 100 }] })
  await api.createGrn({ packingList: { refDoc: 'PL-K1G' }, modelCode: 'K1G', lines: [{ partNo: SHARED, description: 'BEARING', plQty: 50, countedQty: 50 }] })
  return api
}
const closing = async (api: ReturnType<typeof demoWms>, model: string) => {
  const rows = await api.ledgerRows([SHARED], monthRange(thisMonth()).to)
  return buildLedger(rowsOfModel(rows, model), [part], thisMonth())[0].closing
}

describe('A4 shared parts are counted once, in the model of the document', () => {
  it('splits receipts and issues by model, and model-less QC by the receipt it took from', async () => {
    const api = await twoModels()
    // K1G เบิก 30: FIFO ตัดจากกล่องของใบรับ TWIN (เก่ากว่า) แต่เข้าบัญชี K1G ตามใบเบิก
    await api.postRequisition({ kind: 'line', docDate: today(), modelCode: 'K1G', lines: [{ partNo: SHARED, qty: 30 }] })
    // QC เบิก 10 ไม่มี Model ⇒ เข้าบัญชีของใบรับที่ของมา (TWIN)
    await api.postRequisition({ kind: 'qc', docDate: today(), lines: [{ partNo: SHARED, qty: 10 }] })
    expect([await closing(api, 'TWIN'), await closing(api, 'K1G')]).toEqual([90, 20])
    // รวมทุก Model = ของจริงในคลัง (เดิมแต่ละ Model เห็นทั้ง 110)
    const all = buildLedger(await api.ledgerRows([SHARED], monthRange(thisMonth()).to), [part], thisMonth())[0].closing
    expect(all).toBe(110)
    expect(await closing(api, NO_MODEL)).toBe(0)
  })

  it('keeps found stock of a shared part out of every model (shown as "no model")', async () => {
    const api = await twoModels()
    // นับเจอ 7 ชิ้นในช่องที่ไม่มีกล่อง ⇒ กล่องใหม่จากการตรวจนับ (ใบรับไม่มี Model · part ร่วมหลาย Model)
    const { id } = await api.submitStockCount({ lines: [{ loc: 'RK-B-01-1', partNo: SHARED, counted: 7 }] })
    await api.decideStockCount(id, true)
    expect([await closing(api, 'TWIN'), await closing(api, 'K1G'), await closing(api, NO_MODEL)]).toEqual([100, 50, 7])
  })
})

describe('A6 the ledger month follows the document date', () => {
  it('puts a back-dated requisition in the month on the paper', async () => {
    const api = await twoModels()
    const prev = lastMonth()
    await api.postRequisition({ kind: 'line', docNo: 'MRA-BACK', docDate: `${prev}-28`, modelCode: 'K1G', lines: [{ partNo: SHARED, qty: 5 }] })
    const rows = rowsOfModel(await api.ledgerRows([SHARED], monthRange(thisMonth()).to), 'K1G')
    const back = rows.find((r) => r.docNo === 'MRA-BACK')!
    expect(back.at.slice(0, 7) <= prev).toBe(true)
    expect(bangkokDay(back.at)).toBe(`${prev}-28`)
    // ใบนี้อยู่ในบัญชีเดือนก่อน ไม่อยู่เดือนนี้
    const [prevSheet] = buildLedger(rows, [part], prev)
    expect(prevSheet.lines.map((l) => l.docNo)).toEqual(['MRA-BACK'])
    const [nowSheet] = buildLedger(rows, [part], thisMonth())
    expect(nowSheet.lines.some((l) => l.docNo === 'MRA-BACK')).toBe(false)
  })

  it('locks QC / NG requisitions without a model by the model of the stock they take', async () => {
    const api = await twoModels()
    const prev = lastMonth()
    await api.closeMonth('TWIN', prev)
    // ของในกล่อง TWIN ⇒ ใบ QC ลงวันที่เดือนที่ TWIN ปิดแล้ว บันทึกไม่ได้
    await expect(api.postRequisition({ kind: 'qc', docDate: `${prev}-20`, lines: [{ partNo: SHARED, qty: 1 }] })).rejects.toThrow(/TWIN เดือน .* ปิดยอดแล้ว/)
    await api.postRequisition({ kind: 'qc', docDate: today(), lines: [{ partNo: SHARED, qty: 1 }] })
  })

  it('keeps the time of day when moving to the document date', () => {
    expect(onDocDate('2026-10-25T03:15:42.123Z', '2026-09-30')).toBe('2026-09-30T03:15:42.123Z')
    // 01:00 เวลาไทย = 18:00 UTC วันก่อน
    expect(onDocDate('2026-10-24T18:00:00.000Z', '2026-09-30')).toBe('2026-09-29T18:00:00.000Z')
  })
})

describe('A7 adjustments are booked on the approval date', () => {
  it('uses the approval time, not the request time', async () => {
    const api = await twoModels()
    const item = (await api.activeLpns()).flatMap((l) => l.items).find((i) => i.partNo === SHARED)!
    await api.scanAdjustRequest(item.id, item.qty - 1, 'นับได้ขาด 1')
    await new Promise((r) => setTimeout(r, 15))
    const [t] = await api.pendingAdjustments()
    await api.scanAdjustDecide(t.id, true)
    const adj = (await api.ledgerRows([SHARED], monthRange(thisMonth()).to)).find((r) => r.kind === 'ADJ')!
    const decided = (await api.recentTx(20)).find((x) => x.id === t.id)!
    expect(adj.at).toBe(decided.decidedAt)
    expect(adj.at > decided.createdAt).toBe(true)
    expect(adj.model).toBe('TWIN')
  })
})

describe('A8 merged and split boxes keep their received date', () => {
  it('lets FIFO still take the older goods first', async () => {
    const api = demoWms()
    const lines = [
      { partNo: 'RAT00586', description: 'HUB', plQty: 10, countedQty: 10, caseNo: 'C1' },
      { partNo: 'RAT01088', description: 'RIM', plQty: 10, countedQty: 10, caseNo: 'C2' },
    ]
    const { grnId } = await api.createGrn({ packingList: { refDoc: 'PL-OLD' }, modelCode: 'K1G', lines })
    await new Promise((r) => setTimeout(r, 15))
    const { grnId: newer } = await api.createGrn({ packingList: { refDoc: 'PL-NEW' }, modelCode: 'K1G', lines })
    const old = (await api.grnDetail(grnId))!.lpns
    await new Promise((r) => setTimeout(r, 15))
    const m = await api.mergeLpns(old.map((b) => b.id))
    const merged = (await api.grnDetail(grnId))!.lpns.find((b) => b.lpnNo === m.lpnNo)!
    expect(merged.createdAt).toBe(old.map((b) => b.createdAt).sort()[0])
    // เบิก HUB 4: ต้องตัดจากกล่องรวม (ของเก่า) ไม่ใช่กล่องของใบรับใหม่
    await api.postRequisition({ kind: 'line', docDate: today(), modelCode: 'K1G', lines: [{ partNo: 'RAT00586', qty: 4 }] })
    const hubLeft = async (id: string) =>
      (await api.grnDetail(id))!.lpns.flatMap((b) => (b.status === 'active' ? b.items : [])).find((i) => i.partNo === 'RAT00586')!.qty
    expect([await hubLeft(grnId), await hubLeft(newer)]).toEqual([6, 10])
    // แยกกล่องรวม: กล่องใหม่ใช้วันรับเข้าเดิม
    const hub = (await api.grnDetail(grnId))!.lpns.find((b) => b.lpnNo === m.lpnNo)!.items.find((i) => i.partNo === 'RAT00586')!
    const s = await api.splitLpn(merged.id, [{ itemId: hub.id, qty: 2 }])
    expect((await api.grnDetail(grnId))!.lpns.find((b) => b.lpnNo === s.lpnNo)!.createdAt).toBe(merged.createdAt)
  })
})

describe('D2 the person who closes does not acknowledge', () => {
  it('blocks the closer and one person signing for both sides', async () => {
    const api = await twoModels()
    await api.closeMonth('TWIN', lastMonth())
    const [c] = await api.listClosings()
    expect(c.mine).toEqual({ closed: false, planning: false, account: false })
    await api.ackClosing(c.id, 'planning')
    expect((await api.listClosings())[0].mine).toEqual({ closed: false, planning: true, account: false })
    await expect(api.ackClosing(c.id, 'account')).rejects.toThrow('รับทราบอีกฝั่งไปแล้ว')
  })
})
