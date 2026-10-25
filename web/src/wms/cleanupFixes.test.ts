import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { invoiceByPart } from './invoiceLines'
import { bangkokDay } from './ledger'

// ชุดเก็บกวาด A11 A12 B11 (กติกาเดียวกับ migration 0025)

const today = () => bangkokDay(new Date().toISOString())
async function oneBox(part = 'RAT00586', qty = 10) {
  const api = demoWms()
  const { grnId } = await api.createGrn({ packingList: { refDoc: `PL-${part}-${qty}` }, modelCode: 'K1G', lines: [{ partNo: part, description: 'X', plQty: qty, countedQty: qty }] })
  const box = (await api.grnDetail(grnId))!.lpns[0]
  return { api, grnId, box, item: box.items[0] }
}

describe('A11 only boxes in use can be counted or adjusted', () => {
  it('refuses a box of a voided receipt', async () => {
    const { api, grnId, item } = await oneBox()
    await api.voidGrn(grnId, 'ทดสอบ')
    await expect(api.scanCountItem(item.id, 9)).rejects.toThrow('ถูกยกเลิก')
    await expect(api.scanAdjustRequest(item.id, 9, 'x')).rejects.toThrow('ถูกยกเลิก')
  })

  it('still counts a used-up box (found stock goes through approval)', async () => {
    const { api, item } = await oneBox('RAT01088', 5)
    await api.postRequisition({ kind: 'line', docDate: today(), modelCode: 'K1G', lines: [{ partNo: 'RAT01088', qty: 5 }] })
    expect(await api.scanCountItem(item.id, 2)).toBe(2)
  })
})

describe('A12 whole pieces and a model on line requisitions', () => {
  it('refuses half a piece everywhere stock moves', async () => {
    const { api, item } = await oneBox('RAT00566', 20)
    await expect(api.postRequisition({ kind: 'line', docDate: today(), modelCode: 'K1G', lines: [{ partNo: 'RAT00566', qty: 0.5 }] })).rejects.toThrow('จำนวนเต็ม')
    await expect(api.scanCountItem(item.id, 2.5)).rejects.toThrow('จำนวนเต็ม')
    await expect(api.scanAdjustRequest(item.id, 2.5, 'x')).rejects.toThrow('จำนวนเต็ม')
    await expect(api.createGrn({ packingList: { refDoc: 'PL-HALF' }, modelCode: 'K1G', lines: [{ partNo: 'RAT00566', description: 'X', plQty: 1, countedQty: 1.5 }] })).rejects.toThrow('จำนวนเต็ม')
    // ไม่มีอะไรเปลี่ยน
    expect((await api.activeLpns()).flatMap((l) => l.items).find((i) => i.id === item.id)!.qty).toBe(20)
  })

  it('needs a model on a line requisition but not on QC', async () => {
    const { api } = await oneBox('RAT00566', 20)
    await expect(api.postRequisition({ kind: 'line', docDate: today(), lines: [{ partNo: 'RAT00566', qty: 1 }] })).rejects.toThrow('ต้องระบุ Model')
    await api.postRequisition({ kind: 'qc', docDate: today(), lines: [{ partNo: 'RAT00566', qty: 1 }] })
  })
})

describe('B11 invoice quantities on the receiving page', () => {
  it('adds up a part on several invoice lines and keeps the first line number', () => {
    const by = invoiceByPart(
      [
        { lineNo: 3, partNo: 'hub', qty: 50 },
        { lineNo: 7, partNo: 'HUB', qty: 50 },
        { lineNo: 9, partNo: 'RIM', qty: 30 },
      ],
      (p) => p.toUpperCase(),
    )
    expect([...by]).toEqual([
      ['HUB', { qty: 100, lineNo: 3 }],
      ['RIM', { qty: 30, lineNo: 9 }],
    ])
  })
})
