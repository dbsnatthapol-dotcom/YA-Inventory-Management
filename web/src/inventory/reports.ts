import { bucketBalance, pendingInspection } from './ledger'
import { PARTS } from './masterData'
import type { InventoryState, Lot, Movement, Part } from './types'

export interface StockRow {
  part: Part
  /** รับตาม Invoice (ในวันที่เลือก) */
  invoiceQty: number
  /** Actual Receive เข้า BOI (ในวันที่เลือก) */
  actualReceive: number
  /** MRA เบิก (ในวันที่เลือก) */
  mraIssued: number
  /** คงเหลือ ณ สิ้นวัน */
  boi: number
  mi3: number
  /** ของใน BOI ที่ยังรอตรวจ MI3 (Model อื่นที่ไม่ใช่ K1G) */
  pendingQc: number
  ngCustomer: number
  ngSupplier: number
  /** Balance = ของที่อยู่ในคลังจริง (BOI + MI3) */
  balance: number
}

// เวลาเก็บเป็น UTC แต่ "ประจำวัน" ใช้วันตามเวลาประเทศไทย (UTC+7)
const BKK_OFFSET_MS = 7 * 60 * 60 * 1000
export const bangkokDate = (iso: string = new Date().toISOString()) =>
  new Date(new Date(iso).getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10)
const dayEnd = (date: string) => new Date(`${date}T23:59:59.999+07:00`).toISOString()
const onDay = (date: string) => (iso: string) => bangkokDate(iso) === date

/**
 * ใบรายงาน STOCK ประจำวัน — คอลัมน์ตามแบบฟอร์มเดิมของแผนก W/H ASSY
 * ยอดเข้า/ออก นับเฉพาะวันที่เลือก ส่วนยอดคงเหลือคิด ณ สิ้นวันนั้น
 */
export function dailyStockReport(state: InventoryState, date: string, parts: Part[] = PARTS): StockRow[] {
  const end = dayEnd(date)
  const today = onDay(date)
  return parts.map((part) => {
    const lots = state.lots.filter((l) => l.partNo === part.partNo && l.receivedAt <= end)
    const lotIds = new Set(lots.map((l) => l.id))
    const moves = state.movements.filter((m) => lotIds.has(m.lotId) && today(m.at))
    const sum = (pred: (m: Movement) => boolean) => moves.filter(pred).reduce((s, m) => s + m.qty, 0)
    const bal = (b: Parameters<typeof bucketBalance>[2]) => lots.reduce((s, l) => s + bucketBalance(state, l.id, b, end), 0)
    const boi = bal('BOI')
    const mi3 = bal('MI3')
    return {
      part,
      invoiceQty: lots.filter((l) => today(l.receivedAt)).reduce((s, l) => s + l.invoiceQty, 0),
      actualReceive: sum((m) => m.kind === 'receive'),
      mraIssued: sum((m) => m.kind === 'issue_mra'),
      boi,
      mi3,
      pendingQc: lots.reduce((s, l) => s + pendingInspection(state, l), 0),
      ngCustomer: bal('NG_CUSTOMER'),
      ngSupplier: bal('NG_SUPPLIER'),
      balance: boi + mi3,
    }
  })
}

export type DiscrepancyType = 'ขาด' | 'เกิน' | 'เสียหาย'

export interface DiscrepancyLine {
  lot: Lot
  part: Part | undefined
  type: DiscrepancyType
  qty: number
}

/** รายงานความต่างระหว่าง invoice กับของจริง ของใบรับเข้าหนึ่งใบ */
export function discrepancyReport(state: InventoryState, receiptId: string): DiscrepancyLine[] {
  return state.lots
    .filter((l) => l.receiptId === receiptId)
    .flatMap((lot) => {
      const part = PARTS.find((p) => p.partNo === lot.partNo)
      const out: DiscrepancyLine[] = []
      const diff = lot.countedQty - lot.invoiceQty
      if (diff < 0) out.push({ lot, part, type: 'ขาด', qty: -diff })
      if (diff > 0) out.push({ lot, part, type: 'เกิน', qty: diff })
      if (lot.damagedQty > 0) out.push({ lot, part, type: 'เสียหาย', qty: lot.damagedQty })
      return out
    })
}

/** ประวัติทั้งหมดของ lot เพื่อย้อนกลับไปหา invoice ต้นทาง */
export function lotTrace(state: InventoryState, lotId: string) {
  const lot = state.lots.find((l) => l.id === lotId)
  const receipt = lot && state.receipts.find((r) => r.id === lot.receiptId)
  return { lot, receipt, movements: state.movements.filter((m) => m.lotId === lotId).sort((a, b) => a.at.localeCompare(b.at)) }
}
