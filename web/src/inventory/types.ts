// โมเดลข้อมูลงานรับเข้า / สต็อก — ตรงกับตารางใน supabase/migrations/0003_inventory_flow.sql

/**
 * สถานะของสต็อก (bucket) แทนคอลัมน์ในใบรายงาน STOCK
 * BOI = คลังของดีพร้อมเบิก, MI3 = ระหว่างตรวจคุณภาพ, MRA = เบิกเข้าไลน์แล้ว,
 * NG_CUSTOMER = NG รอส่งคืนลูกค้า, NG_SUPPLIER = NG ส่งคืน Supplier, RETURNED = ส่งคืนออกไปแล้ว
 */
export type Bucket = 'BOI' | 'MI3' | 'MRA' | 'NG_CUSTOMER' | 'NG_SUPPLIER' | 'RETURNED'

export type MovementKind =
  | 'receive' // รับเข้า BOI (ยอดนับจริงที่สภาพดี)
  | 'receive_ng' // ของเสียหายตอนรับเข้า
  | 'to_mi3' // ส่งตรวจคุณภาพ
  | 'mi3_pass' // ผลตรวจดี กลับ BOI
  | 'mi3_ng' // ผลตรวจเสีย
  | 'issue_mra' // MRA เบิกเข้าไลน์
  | 'ng_in_process' // เจอของเสียในกระบวนการ
  | 'return_ng' // ส่งคืน NG ออกไป

export interface Customer {
  id: string
  name: string
}

export interface ProductModel {
  code: string
  customerId: string
  /** ต้องผ่าน MI3 ก่อนเบิก MRA หรือไม่ */
  requiresInspection: boolean
}

export interface Part {
  partNo: string
  type: string
  description: string
  customerId: string
  /** Model ที่ใช้ part นี้ */
  models: string[]
  /** revision ในต้นฉบับ (ตัวหลัง /) — ระบบอ้างอิงด้วยเลขฐาน */
  revision?: string | null
}

/** ใบรายงาน STOCK ของ Model กลุ่มหนึ่ง (เช่น J1D + J1D4) */
export interface StockSheet {
  id: string
  title: string
  customerId: string
  models: string[]
  /** ลำดับ part ตามแบบฟอร์มเดิม */
  partNos: string[]
}

/** กฎแนะนำโซนจัดเก็บ: ลูกค้า + กลุ่มสินค้า (type = null คือค่าเริ่มต้นของลูกค้า) */
export interface ZoneRule {
  customerId: string
  type: string | null
  zoneId: string
}

/** ผลการอ่าน invoice (จาก Qwen-VL หรือแบบจำลอง) ก่อนเทียบกับ Master */
export interface ExtractedInvoice {
  invoiceNo: string
  invoiceDate: string
  supplier: string
  model: string
  lines: { partNo: string; description: string; qty: number }[]
  provider: 'mock' | 'qwen'
}

/** บรรทัดใบรับเข้า 1 บรรทัด = 1 lot (ย้อนกลับหา invoice ได้) */
export interface Lot {
  id: string
  receiptId: string
  invoiceNo: string
  model: string
  partNo: string
  invoiceQty: number
  /** ยอดที่นับได้จริง */
  countedQty: number
  /** ในยอดที่นับได้ มีของเสียหายเท่าไร */
  damagedQty: number
  zoneId: string
  receivedAt: string
}

export interface Receipt {
  id: string
  invoiceNo: string
  invoiceDate: string
  supplier: string
  customerId: string
  model: string
  provider: ExtractedInvoice['provider']
  receivedAt: string
  receivedBy: string
}

export interface Movement {
  id: string
  lotId: string
  kind: MovementKind
  from: Bucket | null
  to: Bucket | null
  qty: number
  at: string
  note?: string
  /** ผู้บันทึก (ใช้ติดตามย้อนหลัง) */
  by?: string
}

export interface InventoryState {
  receipts: Receipt[]
  lots: Lot[]
  movements: Movement[]
}
