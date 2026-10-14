import { modelRequiresInspection } from './extraction'
import type { Bucket, InventoryState, Lot, Movement, MovementKind, Receipt } from './types'

export class InventoryError extends Error {}

/** ทิศทางของแต่ละรายการเคลื่อนไหว (null = เข้ามาจากภายนอก / ออกไปภายนอก) */
export const FLOW: Record<MovementKind, { from: Bucket | null; to: Bucket[] | null; label: string }> = {
  receive: { from: null, to: ['BOI'], label: 'รับเข้า BOI' },
  receive_ng: { from: null, to: ['NG_SUPPLIER', 'NG_CUSTOMER'], label: 'เสียหายตอนรับเข้า' },
  to_mi3: { from: 'BOI', to: ['MI3'], label: 'ส่งตรวจ MI3' },
  mi3_pass: { from: 'MI3', to: ['BOI'], label: 'ผลตรวจ MI3: ดี → BOI' },
  mi3_ng: { from: 'MI3', to: ['NG_CUSTOMER', 'NG_SUPPLIER'], label: 'ผลตรวจ MI3: NG' },
  issue_mra: { from: 'BOI', to: ['MRA'], label: 'MRA เบิก' },
  ng_in_process: { from: 'MRA', to: ['NG_CUSTOMER', 'NG_SUPPLIER'], label: 'เจอ NG ในกระบวนการ' },
  return_ng: { from: null, to: ['RETURNED'], label: 'ส่งคืน NG' },
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  BOI: 'BOI (ของดี)',
  MI3: 'MI3 (ตรวจคุณภาพ)',
  MRA: 'MRA (เบิกเข้าไลน์)',
  NG_CUSTOMER: 'NG รอส่งคืนลูกค้า',
  NG_SUPPLIER: 'NG ส่งคืน Supplier',
  RETURNED: 'ส่งคืนแล้ว',
}

const until = (at?: string) => (m: Movement) => !at || m.at <= at

/** ยอดคงเหลือของ lot ใน bucket หนึ่ง (ณ เวลา at ถ้าระบุ) */
export function bucketBalance(state: InventoryState, lotId: string, bucket: Bucket, at?: string): number {
  return state.movements
    .filter((m) => m.lotId === lotId)
    .filter(until(at))
    .reduce((sum, m) => sum + (m.to === bucket ? m.qty : 0) - (m.from === bucket ? m.qty : 0), 0)
}

const sumKind = (state: InventoryState, lotId: string, kind: MovementKind) =>
  state.movements.filter((m) => m.lotId === lotId && m.kind === kind).reduce((s, m) => s + m.qty, 0)

/**
 * ยอดที่ MRA เบิกได้: K1G เบิกจาก BOI ได้ทันที
 * Model อื่นเบิกได้เฉพาะยอดที่ผ่าน MI3 แล้วและยังไม่ถูกเบิก
 */
export function availableForMra(state: InventoryState, lot: Lot): number {
  const boi = bucketBalance(state, lot.id, 'BOI')
  if (!modelRequiresInspection(lot.model)) return boi
  return Math.min(boi, sumKind(state, lot.id, 'mi3_pass') - sumKind(state, lot.id, 'issue_mra'))
}

/** ยอดใน BOI ที่ยังรอตรวจ MI3 (เฉพาะ Model ที่ต้องตรวจ) */
export function pendingInspection(state: InventoryState, lot: Lot): number {
  if (!modelRequiresInspection(lot.model)) return 0
  return bucketBalance(state, lot.id, 'BOI') - availableForMra(state, lot)
}

let seq = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

export interface ReceiveLineInput {
  partNo: string
  invoiceQty: number
  countedQty: number
  damagedQty: number
  zoneId: string
  damagedTo?: 'NG_SUPPLIER' | 'NG_CUSTOMER'
}

/** ยืนยันรับเข้า: ยอดดีเข้า BOI, ของเสียหายเข้า NG, ส่วนต่างกับ invoice ไปอยู่ในรายงานความต่าง */
export function receiveInvoice(
  state: InventoryState,
  receipt: Omit<Receipt, 'id' | 'receivedAt'> & { receivedAt?: string },
  lines: ReceiveLineInput[],
): InventoryState {
  if (state.receipts.some((r) => r.invoiceNo === receipt.invoiceNo))
    throw new InventoryError(`Invoice ${receipt.invoiceNo} รับเข้าไปแล้ว`)
  if (!lines.length) throw new InventoryError('ไม่มีรายการให้รับเข้า')
  for (const l of lines) {
    if (![l.invoiceQty, l.countedQty, l.damagedQty].every((n) => Number.isInteger(n) && n >= 0))
      throw new InventoryError(`${l.partNo}: จำนวนต้องเป็นจำนวนเต็มไม่ติดลบ`)
    if (l.damagedQty > l.countedQty) throw new InventoryError(`${l.partNo}: ของเสียหายมากกว่ายอดที่นับได้`)
  }

  const at = receipt.receivedAt ?? new Date().toISOString()
  const r: Receipt = { ...receipt, id: newId('RCV'), receivedAt: at }
  const lots: Lot[] = []
  const movements: Movement[] = []
  lines.forEach((l, i) => {
    const lot: Lot = {
      id: `${receipt.invoiceNo}#${i + 1}`,
      receiptId: r.id,
      invoiceNo: receipt.invoiceNo,
      model: receipt.model,
      partNo: l.partNo,
      invoiceQty: l.invoiceQty,
      countedQty: l.countedQty,
      damagedQty: l.damagedQty,
      zoneId: l.zoneId,
      receivedAt: at,
    }
    lots.push(lot)
    const good = l.countedQty - l.damagedQty
    if (good > 0) movements.push({ id: newId('MV'), lotId: lot.id, kind: 'receive', from: null, to: 'BOI', qty: good, at })
    if (l.damagedQty > 0)
      movements.push({
        id: newId('MV'),
        lotId: lot.id,
        kind: 'receive_ng',
        from: null,
        to: l.damagedTo ?? 'NG_SUPPLIER',
        qty: l.damagedQty,
        at,
        note: 'เสียหายตอนรับเข้า',
      })
  })
  return { receipts: [...state.receipts, r], lots: [...state.lots, ...lots], movements: [...state.movements, ...movements] }
}

export interface MoveInput {
  lotId: string
  kind: Exclude<MovementKind, 'receive' | 'receive_ng'>
  qty: number
  /** ปลายทาง เมื่อ kind มีได้หลายปลายทาง (เช่น NG ลูกค้า / Supplier) */
  to?: Bucket
  /** ต้นทางของ return_ng */
  from?: Bucket
  note?: string
  at?: string
}

/** บันทึกการเคลื่อนไหวของ lot พร้อมตรวจกฎทุกข้อ */
export function moveLot(state: InventoryState, input: MoveInput): InventoryState {
  const lot = state.lots.find((l) => l.id === input.lotId)
  if (!lot) throw new InventoryError(`ไม่พบ lot ${input.lotId}`)
  if (!Number.isInteger(input.qty) || input.qty <= 0) throw new InventoryError('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0')

  const flow = FLOW[input.kind]
  const from = input.kind === 'return_ng' ? input.from : flow.from
  if (input.kind === 'return_ng' && from !== 'NG_CUSTOMER' && from !== 'NG_SUPPLIER')
    throw new InventoryError('ส่งคืนได้เฉพาะของใน NG รอส่งคืนลูกค้า หรือ NG ส่งคืน Supplier')
  const to = input.to ?? flow.to![0]
  if (!flow.to!.includes(to)) throw new InventoryError(`${flow.label} ไปที่ ${to} ไม่ได้`)

  const available = from ? bucketBalance(state, lot.id, from) : 0
  if (input.qty > available)
    throw new InventoryError(`${BUCKET_LABEL[from!]} ของ lot ${lot.id} มีเพียง ${available.toLocaleString()} ชิ้น`)

  if (input.kind === 'issue_mra') {
    const canIssue = availableForMra(state, lot)
    if (input.qty > canIssue)
      throw new InventoryError(
        modelRequiresInspection(lot.model)
          ? `Model ${lot.model} ต้องผ่าน MI3 ก่อนเบิก — เบิกได้อีก ${canIssue.toLocaleString()} ชิ้น (รอตรวจ ${pendingInspection(state, lot).toLocaleString()})`
          : `เบิกได้สูงสุด ${canIssue.toLocaleString()} ชิ้น`,
      )
  }

  const movement: Movement = {
    id: newId('MV'),
    lotId: lot.id,
    kind: input.kind,
    from: from ?? null,
    to,
    qty: input.qty,
    at: input.at ?? new Date().toISOString(),
    note: input.note,
  }
  return { ...state, movements: [...state.movements, movement] }
}

export const emptyState = (): InventoryState => ({ receipts: [], lots: [], movements: [] })
