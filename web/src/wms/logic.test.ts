import { describe, expect, it } from 'vitest'
import { discrepancyText, lpnFromScan, needsQi, reconcile, zoneCodeOfLoc } from './logic'
import { SAMPLE_INVOICE, SAMPLE_PACKING_LIST } from './sampleDocs'
import type { InvoiceView, MasterData } from './types'

const master: MasterData = {
  parts: [
    { partNo: '148537/A', name: 'RIM', type: 'RIM', customerId: 'RE', models: ['TWIN'] },
    { partNo: '148640/A', name: 'SPOKE', type: 'SPOKE', customerId: 'RE', models: ['TWIN'] },
  ],
  models: [
    { code: 'TWIN', customerId: 'RE', requiresInspection: true },
    { code: 'K1G', customerId: 'RE', requiresInspection: false },
  ],
  rules: [],
  locations: [],
  zoneHeads: [],
  fgItems: [],
}

describe('งานคลัง', () => {
  it('อ่านเลข LPN จากลิงก์ใน QR หรือรหัสเปล่า', () => {
    expect(lpnFromScan('https://x.workers.dev/t/LPN-2610-000017')).toBe('LPN-2610-000017')
    expect(lpnFromScan(' lpn-2610-000017 ')).toBe('LPN-2610-000017')
  })

  it('ตรวจ MI3 เฉพาะ Rim/Hub ของ Model ที่ต้องตรวจ (K1G ไม่ตรวจ)', () => {
    expect(needsQi(master, ['RIM', 'HUB'], 'TWIN', '148537/A')).toBe(true)
    expect(needsQi(master, ['RIM', 'HUB'], 'TWIN', '148640/A')).toBe(false)
    expect(needsQi(master, ['RIM', 'HUB'], 'K1G', '148537/A')).toBe(false)
    expect(needsQi(master, ['RIM', 'HUB'], 'TWIN', 'ไม่มีใน master')).toBe(false)
  })

  it('รหัสโซนจากรหัสช่อง', () => {
    expect(zoneCodeOfLoc('RK-C-01-1')).toBe('RK-C')
    expect(zoneCodeOfLoc('TENT-T-03')).toBe('TENT-T')
    expect(zoneCodeOfLoc('MI3-QC')).toBe('MI3-QC')
  })

  it('กระทบยอดด้วย Part No. รวมทุกเที่ยว และฟ้อง part ที่ไม่มีใน invoice', () => {
    const view: InvoiceView = {
      invoice: { id: 'i', invoiceNo: SAMPLE_INVOICE.invoiceNo, customerId: 'RE', poNo: SAMPLE_INVOICE.poNo, docDate: SAMPLE_INVOICE.docDate, movementType: '541', status: 'open', statusNote: null, statusAt: null, imagePaths: [], createdAt: '' },
      lines: SAMPLE_INVOICE.lines.map((l) => ({ ...l })),
      grns: [],
      // รับสองเที่ยว: เที่ยวแรกครบตาม PL, เที่ยวสองซี่ลวดเพิ่ม 10 + part นอก invoice
      received: [
        ...SAMPLE_PACKING_LIST.lines.map((l) => ({ partNo: l.partNo, qty: l.partNo === '148640/A' ? l.qty + 10 : l.qty })),
        { partNo: 'X-EXTRA', qty: 5 },
      ],
    }
    const rows = reconcile(view)
    const rim = rows.find((r) => r.partNo === '148537/A')!
    expect(rim).toMatchObject({ lineNo: 18, invoiceQty: 3600, receivedQty: 100, diff: -3500 })
    expect(rows.find((r) => r.partNo === '148640/A')!.diff).toBe(3610 - 100)
    expect(rows.find((r) => r.partNo === 'X-EXTRA')).toMatchObject({ lineNo: null, invoiceQty: null, diff: 5 })
    expect(rows.find((r) => r.partNo === '148543/A')!.diff).toBe(0)
    const text = discrepancyText(view, rows)
    expect(text).toContain('Invoice 4957930126')
    expect(text).not.toContain('148543/A')
  })

  it('เอกสารตัวอย่าง: PL กับ Invoice มีจำนวนรวมเท่ากัน (18,200) แต่ต่างรายบรรทัด', () => {
    const sum = (xs: { qty: number }[]) => xs.reduce((s, x) => s + x.qty, 0)
    expect(sum(SAMPLE_PACKING_LIST.lines)).toBe(18200)
    expect(sum(SAMPLE_INVOICE.lines)).toBe(18200)
    expect(SAMPLE_INVOICE.lines.map((l) => l.lineNo)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })
})
