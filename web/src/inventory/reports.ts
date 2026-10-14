import { bucketBalance, FLOW, pendingInspection } from './ledger'
import { PARTS } from './masterData'
import type { Bucket, InventoryState, Lot, Movement, MovementKind, Part, Receipt, StockSheet } from './types'

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
export function dailyStockReport(state: InventoryState, date: string, sheet?: StockSheet): StockRow[] {
  const end = dayEnd(date)
  const today = onDay(date)
  const parts = sheet ? sheet.partNos.map((no) => PARTS.find((p) => p.partNo === no)!) : PARTS
  // ใบรายงานแยก Model: นับเฉพาะ lot ที่รับเข้าด้วย invoice ของ Model ในใบนั้น
  const inSheet = (l: Lot) => !sheet || sheet.models.includes(l.model)
  return parts.map((part) => {
    const lots = state.lots.filter((l) => l.partNo === part.partNo && l.receivedAt <= end && inSheet(l))
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

/** แถวในประวัติการเคลื่อนไหว พร้อม tag กลับไปหา lot / invoice / Model / part */
export interface MovementRow {
  movement: Movement
  lot: Lot
  receipt: Receipt | undefined
  part: Part | undefined
  label: string
  /** ทิศทางเทียบกับคลัง: เข้า / ออก / ย้ายภายใน */
  direction: 'in' | 'out' | 'internal'
}

const OUT_KINDS: MovementKind[] = ['issue_mra', 'return_ng']
const IN_KINDS: MovementKind[] = ['receive', 'receive_ng']

export interface MovementFilter {
  from?: string
  to?: string
  model?: string
  kind?: MovementKind
  /** ค้นหาจากเลข invoice, lot, part no., ผู้บันทึก หรือหมายเหตุ */
  q?: string
}

/** ประวัติการเคลื่อนไหวทั้งระบบ (ใหม่สุดก่อน) */
export function movementLog(state: InventoryState, filter: MovementFilter = {}): MovementRow[] {
  const lots = new Map(state.lots.map((l) => [l.id, l]))
  const receipts = new Map(state.receipts.map((r) => [r.id, r]))
  const q = filter.q?.trim().toUpperCase()
  return state.movements
    .map((m) => {
      const lot = lots.get(m.lotId)!
      return {
        movement: m,
        lot,
        receipt: receipts.get(lot.receiptId),
        part: PARTS.find((p) => p.partNo === lot.partNo),
        label: FLOW[m.kind].label,
        direction: IN_KINDS.includes(m.kind) ? 'in' : OUT_KINDS.includes(m.kind) ? 'out' : 'internal',
      } satisfies MovementRow
    })
    .filter((r) => !filter.from || bangkokDate(r.movement.at) >= filter.from)
    .filter((r) => !filter.to || bangkokDate(r.movement.at) <= filter.to)
    .filter((r) => !filter.model || r.lot.model === filter.model)
    .filter((r) => !filter.kind || r.movement.kind === filter.kind)
    .filter(
      (r) =>
        !q ||
        [r.lot.id, r.lot.invoiceNo, r.lot.partNo, r.movement.by ?? '', r.movement.note ?? '', r.part?.description ?? '']
          .some((v) => v.toUpperCase().includes(q)),
    )
    .sort((a, b) => b.movement.at.localeCompare(a.movement.at))
}

export interface DashboardSummary {
  date: string
  receipts: number
  invoiceQty: number
  receivedQty: number
  shortQty: number
  damagedQty: number
  issuedQty: number
  ngFoundQty: number
  returnedQty: number
  pendingQcQty: number
  inMi3Qty: number
  onHandQty: number
  movements: number
  /** ยอดรับเข้า BOI และเบิก MRA รายชั่วโมง (เวลาไทย 0–23) */
  hourly: { hour: number; received: number; issued: number }[]
  byModel: { model: string; received: number; issued: number; onHand: number; pendingQc: number; ng: number }[]
}

const bangkokHour = (iso: string) => new Date(new Date(iso).getTime() + BKK_OFFSET_MS).getUTCHours()

/** ตัวเลขสรุปของวันสำหรับ Dashboard */
export function dashboardSummary(state: InventoryState, date: string): DashboardSummary {
  const today = onDay(date)
  const moves = state.movements.filter((m) => today(m.at))
  const sum = (kinds: MovementKind[], list = moves) => list.filter((m) => kinds.includes(m.kind)).reduce((s, m) => s + m.qty, 0)
  const lotsToday = state.lots.filter((l) => today(l.receivedAt))
  const lotModel = new Map(state.lots.map((l) => [l.id, l.model]))
  const bal = (lots: Lot[], b: Bucket) => lots.reduce((s, l) => s + bucketBalance(state, l.id, b), 0)

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const inHour = moves.filter((m) => bangkokHour(m.at) === hour)
    return { hour, received: sum(['receive'], inHour), issued: sum(['issue_mra'], inHour) }
  })

  const models = [...new Set(state.lots.map((l) => l.model))].sort()
  const byModel = models.map((model) => {
    const lots = state.lots.filter((l) => l.model === model)
    const mm = moves.filter((m) => lotModel.get(m.lotId) === model)
    return {
      model,
      received: sum(['receive'], mm),
      issued: sum(['issue_mra'], mm),
      onHand: bal(lots, 'BOI') + bal(lots, 'MI3'),
      pendingQc: lots.reduce((s, l) => s + pendingInspection(state, l), 0),
      ng: bal(lots, 'NG_CUSTOMER') + bal(lots, 'NG_SUPPLIER'),
    }
  })

  return {
    date,
    receipts: state.receipts.filter((r) => today(r.receivedAt)).length,
    invoiceQty: lotsToday.reduce((s, l) => s + l.invoiceQty, 0),
    receivedQty: sum(['receive']),
    shortQty: lotsToday.reduce((s, l) => s + Math.max(0, l.invoiceQty - l.countedQty), 0),
    damagedQty: sum(['receive_ng']),
    issuedQty: sum(['issue_mra']),
    ngFoundQty: sum(['mi3_ng', 'ng_in_process']),
    returnedQty: sum(['return_ng']),
    pendingQcQty: state.lots.reduce((s, l) => s + pendingInspection(state, l), 0),
    inMi3Qty: bal(state.lots, 'MI3'),
    onHandQty: bal(state.lots, 'BOI') + bal(state.lots, 'MI3'),
    movements: moves.length,
    hourly,
    byModel,
  }
}

export interface ZoneContents {
  zoneId: string
  /** ของดีที่วางอยู่ในโซน (BOI) */
  totalQty: number
  /** ในนั้นยังรอตรวจ MI3 กี่ชิ้น */
  pendingQcQty: number
  models: { model: string; qty: number }[]
  items: { lot: Lot; part: Part | undefined; qty: number; pendingQc: number }[]
}

/** ของที่อยู่ในโซนจัดเก็บ (ยอด BOI ของทุก lot ที่จัดเก็บในโซนนี้) แยกตาม Model และ lot */
export function zoneContents(state: InventoryState, zoneId: string): ZoneContents {
  const items = state.lots
    .filter((l) => l.zoneId === zoneId)
    .map((lot) => ({
      lot,
      part: PARTS.find((p) => p.partNo === lot.partNo),
      qty: bucketBalance(state, lot.id, 'BOI'),
      pendingQc: pendingInspection(state, lot),
    }))
    .filter((i) => i.qty > 0)
    .sort((a, b) => a.lot.model.localeCompare(b.lot.model) || a.lot.partNo.localeCompare(b.lot.partNo))
  const byModel = new Map<string, number>()
  for (const i of items) byModel.set(i.lot.model, (byModel.get(i.lot.model) ?? 0) + i.qty)
  return {
    zoneId,
    totalQty: items.reduce((s, i) => s + i.qty, 0),
    pendingQcQty: items.reduce((s, i) => s + i.pendingQc, 0),
    models: [...byModel].map(([model, qty]) => ({ model, qty })).sort((a, b) => b.qty - a.qty),
    items,
  }
}

/** ยอดรวมของทุกโซน (ใช้ติดป้ายบนผัง 3D) */
export function zoneTotals(state: InventoryState): Map<string, ZoneContents> {
  const ids = [...new Set(state.lots.map((l) => l.zoneId))]
  return new Map(ids.map((id) => [id, zoneContents(state, id)]))
}
