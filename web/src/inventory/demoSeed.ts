import { suggestZone } from './extraction'
import { emptyState, moveLot, receiveInvoice } from './ledger'
import { PARTS } from './masterData'
import type { InventoryState } from './types'

const zoneOf = (partNo: string) => suggestZone(PARTS.find((p) => p.partNo === partNo)!)!

/**
 * ข้อมูลตัวอย่างเพื่อให้รายงานมีตัวเลขตั้งแต่เปิดหน้า (ทั้งหมดเป็นข้อมูลสมมติ)
 * เมื่อวาน: รับ invoice K1G และ J1D, วันนี้: MRA เบิกบางส่วน, ส่ง J1D ตรวจ MI3, เจอ NG ในกระบวนการ
 */
export function buildDemoState(today: string): InventoryState {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const yesterday = d.toISOString().slice(0, 10)
  const t = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`

  let s = emptyState()
  s = receiveInvoice(
    s,
    {
      invoiceNo: 'RE-INV-2610-0141',
      invoiceDate: yesterday,
      supplier: 'Royal Enfield (ตัวอย่าง)',
      customerId: 'RE',
      model: 'K1G',
      provider: 'mock',
      receivedBy: 'ทีมรับเข้า (ตัวอย่าง)',
      receivedAt: t(yesterday, '02:30'),
    },
    [
      { partNo: 'RAJ00537/B', invoiceQty: 300, countedQty: 300, damagedQty: 3, zoneId: zoneOf('RAJ00537/B') },
      { partNo: 'RAT00587/B', invoiceQty: 300, countedQty: 300, damagedQty: 0, zoneId: zoneOf('RAT00587/B') },
      { partNo: 'RAJ00538/B', invoiceQty: 10800, countedQty: 10750, damagedQty: 0, zoneId: zoneOf('RAJ00538/B') },
      { partNo: 'RAJ00550/B', invoiceQty: 21600, countedQty: 21600, damagedQty: 0, zoneId: zoneOf('RAJ00550/B') },
      { partNo: 'RAJ00301/D', invoiceQty: 300, countedQty: 300, damagedQty: 0, zoneId: zoneOf('RAJ00301/D') },
    ],
  )
  s = receiveInvoice(
    s,
    {
      invoiceNo: 'RE-INV-2610-0144',
      invoiceDate: yesterday,
      supplier: 'Royal Enfield (ตัวอย่าง)',
      customerId: 'RE',
      model: 'J1D',
      provider: 'mock',
      receivedBy: 'ทีมรับเข้า (ตัวอย่าง)',
      receivedAt: t(yesterday, '03:10'),
    },
    [{ partNo: '150324/A', invoiceQty: 800, countedQty: 800, damagedQty: 0, zoneId: zoneOf('150324/A') }],
  )
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#1', kind: 'issue_mra', qty: 120, at: t(today, '01:15') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#3', kind: 'issue_mra', qty: 4320, at: t(today, '01:20') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#4', kind: 'issue_mra', qty: 8640, at: t(today, '01:25') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#1', kind: 'ng_in_process', qty: 2, to: 'NG_CUSTOMER', note: 'ขอบล้อบุบ เจอที่ไลน์ประกอบ', at: t(today, '04:00') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'to_mi3', qty: 400, at: t(today, '02:00') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'mi3_pass', qty: 390, at: t(today, '05:00') })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'mi3_ng', qty: 10, to: 'NG_SUPPLIER', note: 'ลูกปืนหมุนฝืด', at: t(today, '05:00') })
  return s
}
