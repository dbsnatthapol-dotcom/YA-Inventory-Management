import { suggestZone } from './extraction'
import { emptyState, moveLot, receiveInvoice } from './ledger'
import { PARTS } from './masterData'
import type { InventoryState } from './types'

const zoneOf = (partNo: string) => suggestZone(PARTS.find((p) => p.partNo === partNo)!)!

/**
 * ข้อมูลตัวอย่างเพื่อให้รายงานมีตัวเลขตั้งแต่เปิดหน้า (ทั้งหมดเป็นข้อมูลสมมติ)
 * เมื่อวาน: รับ invoice K1G และ J1D
 * วันนี้: รับ J1A และ TWIN, MRA เบิกหลายรอบ, ส่งตรวจ MI3, เจอ NG ในกระบวนการ
 * เวลาของรายการวันนี้นับย้อนจาก now เพื่อไม่ให้มีรายการ "ในอนาคต" บน Dashboard
 */
export function buildDemoState(today: string, now: string = `${today}T09:00:00.000Z`): InventoryState {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  const yesterday = d.toISOString().slice(0, 10)
  const t = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`
  // เวลาย้อนหลังจาก now (นาที) — ถ้าเพิ่งเริ่มวัน ให้บีบช่วง 8 ชม. ลงให้อยู่ในวันนี้ตามเวลาไทยเสมอ
  const nowMs = new Date(now).getTime()
  const span = Math.min(8 * 60 * 60_000, nowMs - new Date(`${today}T00:00:00+07:00`).getTime() - 60_000)
  const ago = (minutes: number) => new Date(nowMs - (span * minutes) / 480).toISOString()

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
      receivedBy: 'ทีมรับเข้า',
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
      receivedBy: 'ทีมรับเข้า',
      receivedAt: t(yesterday, '03:10'),
    },
    [{ partNo: '150324/A', invoiceQty: 800, countedQty: 800, damagedQty: 0, zoneId: zoneOf('150324/A') }],
  )
  const MRA = 'MRA ไลน์ประกอบ'
  const QC = 'MI3 คัดงาน'
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#1', kind: 'issue_mra', qty: 120, at: ago(420), by: MRA })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#3', kind: 'issue_mra', qty: 4320, at: ago(415), by: MRA })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#4', kind: 'issue_mra', qty: 8640, at: ago(410), by: MRA })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'to_mi3', qty: 400, at: ago(360), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0141#1', kind: 'ng_in_process', qty: 2, to: 'NG_CUSTOMER', note: 'ขอบล้อบุบ เจอที่ไลน์ประกอบ', at: ago(300), by: MRA })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'mi3_pass', qty: 390, at: ago(270), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'mi3_ng', qty: 10, to: 'NG_SUPPLIER', note: 'ลูกปืนหมุนฝืด', at: ago(270), by: QC })

  // วันนี้: รับ J1A และ TWIN
  s = receiveInvoice(
    s,
    { invoiceNo: 'RE-INV-2610-0150', invoiceDate: today, supplier: 'Royal Enfield (ตัวอย่าง)', customerId: 'RE', model: 'J1A', provider: 'mock', receivedBy: 'ทีมรับเข้า', receivedAt: ago(240) },
    [
      { partNo: 'RAJ00296/A', invoiceQty: 150, countedQty: 150, damagedQty: 0, zoneId: zoneOf('RAJ00296/A') },
      { partNo: 'RAT00328/A', invoiceQty: 150, countedQty: 148, damagedQty: 0, zoneId: zoneOf('RAT00328/A') },
      { partNo: 'RAJ00575/A', invoiceQty: 5400, countedQty: 5400, damagedQty: 0, zoneId: zoneOf('RAJ00575/A') },
      { partNo: 'RAJ00298/A', invoiceQty: 10800, countedQty: 10800, damagedQty: 0, zoneId: zoneOf('RAJ00298/A') },
      { partNo: '1120064/A', invoiceQty: 300, countedQty: 300, damagedQty: 0, zoneId: zoneOf('1120064/A') },
    ],
  )
  s = moveLot(s, { lotId: 'RE-INV-2610-0150#1', kind: 'to_mi3', qty: 150, at: ago(200), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0150#1', kind: 'mi3_pass', qty: 148, at: ago(150), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0150#1', kind: 'mi3_ng', qty: 2, to: 'NG_SUPPLIER', note: 'ขอบล้อมีรอยร้าว', at: ago(150), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0150#1', kind: 'issue_mra', qty: 100, at: ago(90), by: MRA })
  s = receiveInvoice(
    s,
    { invoiceNo: 'RE-INV-2610-0152', invoiceDate: today, supplier: 'Royal Enfield (ตัวอย่าง)', customerId: 'RE', model: 'TWIN', provider: 'mock', receivedBy: 'ทีมรับเข้า', receivedAt: ago(120) },
    [
      { partNo: 'RAJ00669/A', invoiceQty: 120, countedQty: 120, damagedQty: 0, zoneId: zoneOf('RAJ00669/A') },
      { partNo: 'RAT00728/A', invoiceQty: 120, countedQty: 120, damagedQty: 0, zoneId: zoneOf('RAT00728/A') },
      { partNo: '148543/A', invoiceQty: 120, countedQty: 120, damagedQty: 2, zoneId: zoneOf('148543/A') },
      { partNo: '150324/A', invoiceQty: 240, countedQty: 240, damagedQty: 0, zoneId: zoneOf('150324/A') },
    ],
  )
  s = moveLot(s, { lotId: 'RE-INV-2610-0152#4', kind: 'to_mi3', qty: 240, at: ago(60), by: QC })
  s = moveLot(s, { lotId: 'RE-INV-2610-0144#1', kind: 'issue_mra', qty: 200, at: ago(30), by: MRA })
  return s
}
