/** งานคลัง: รับของ (GRN) → ป้ายกล่อง (LPN) → สแกน → กระทบยอด Invoice — ตรงกับ supabase/migrations/0008–0010 */

export type Perm =
  | 'receive.create'
  | 'label.print'
  | 'scan.put'
  | 'scan.move'
  | 'scan.issue'
  | 'scan.adjust'
  | 'scan.adjust.approve'
  | 'scan.count'
  | 'scan.qi'
  | 'invoice.close'
  | 'invoice.report'
  | 'master.edit'
  | 'accesslog.view'
  | 'layout.edit'
  | 'ledger.close'
  | 'ledger.ack.planning'
  | 'ledger.ack.account'

export const PERMS: { key: Perm; label: string; group: string }[] = [
  { key: 'receive.create', label: 'รับของ / ออก GRN', group: 'รับของ' },
  { key: 'label.print', label: 'พิมพ์ป้าย / รวมกล่อง', group: 'รับของ' },
  { key: 'scan.put', label: 'จัดเก็บเข้าที่ (PUT)', group: 'สแกน' },
  { key: 'scan.move', label: 'ย้ายที่ (MOVE)', group: 'สแกน' },
  { key: 'scan.issue', label: 'เบิก (สแกนเบิก / ใบเบิก / FM-P-005)', group: 'สแกน' },
  { key: 'scan.adjust', label: 'ขอแก้ไขยอด (ADJ)', group: 'สแกน' },
  { key: 'scan.adjust.approve', label: 'อนุมัติแก้ไขยอด', group: 'สแกน' },
  { key: 'scan.count', label: 'ตรวจนับ (COUNT)', group: 'สแกน' },
  { key: 'scan.qi', label: 'บันทึกผล MI3 (QI)', group: 'สแกน' },
  { key: 'invoice.report', label: 'แจ้งความต่าง Invoice', group: 'Invoice' },
  { key: 'invoice.close', label: 'ยืนยัน Invoice รับครบ', group: 'Invoice' },
  { key: 'master.edit', label: 'แก้ข้อมูลหลัก (part, ช่องเก็บ)', group: 'หลังบ้าน' },
  { key: 'accesslog.view', label: 'ดูประวัติการเข้าใช้', group: 'หลังบ้าน' },
  { key: 'layout.edit', label: 'แก้ผังคลัง (โซน ชั้นวาง บันได ลิฟต์)', group: 'หลังบ้าน' },
  { key: 'ledger.close', label: 'ปิดยอด / เปิดเดือน บัญชีคุม FM-P-537', group: 'บัญชีคุม' },
  { key: 'ledger.ack.planning', label: 'รับทราบยอดปิดเดือน (Planning)', group: 'บัญชีคุม' },
  { key: 'ledger.ack.account', label: 'รับทราบยอดปิดเดือน (บัญชี)', group: 'บัญชีคุม' },
]

export interface Settings {
  mode: 'trial' | 'live'
  trialRound: number
  qiPartTypes: string[]
}

/** ตารางข้อมูลรายการที่ล้างได้ (ชื่อตามฐานข้อมูล) · ข้อมูลหลักไม่อยู่ในนี้ */
export const ENV_TABLES = [
  ['grns', 'ใบรับสินค้า (GRN)'],
  ['lpns', 'กล่อง (LPN)'],
  ['wms_tx', 'รายการเคลื่อนไหว'],
  ['requisitions', 'ใบเบิก'],
  ['invoices', 'Invoice'],
  ['packing_lists', 'Packing list'],
  ['stock_counts', 'ใบตรวจนับ'],
  ['stock_closings', 'ปิดยอดเดือน'],
  ['print_jobs', 'คิวพิมพ์'],
] as const
export type EnvTable = (typeof ENV_TABLES)[number][0]
export type EnvCounts = Record<EnvTable, number>

/** ชุดข้อมูลรายการที่ล้างเก็บไว้ (ไม่ลบ) */
export interface EnvArchive {
  id: number
  /** live หรือ trial-<รอบ> */
  fromEnv: string
  counts: EnvCounts
  note: string | null
  archivedCode: string | null
  archivedAt: string
  restoredCode: string | null
  restoredAt: string | null
  /** อยู่ในโหมดเดียวกับตอนล้างและโหมดนั้นยังว่าง */
  restorable: boolean
}

export interface EnvSummary {
  env: string
  counts: EnvCounts
  archives: EnvArchive[]
}

/** คำที่ต้องพิมพ์ก่อนล้างข้อมูล (ตรงกับ admin_archive_env) */
export const ARCHIVE_CONFIRM = 'ล้างข้อมูล'

export const envLabel = (env: string) => (env === 'live' ? 'ใช้งานจริง' : env.startsWith('trial-') ? `ทดลอง รอบ ${env.slice(6)}` : env)

export type InvoiceStatus = 'open' | 'complete' | 'discrepancy_reported' | 'closed'

export interface Invoice {
  id: string
  invoiceNo: string
  customerId: string | null
  poNo: string | null
  docDate: string | null
  movementType: string | null
  status: InvoiceStatus
  statusNote: string | null
  statusAt: string | null
  imagePaths: string[]
  createdAt: string
}

export interface InvoiceLine {
  lineNo: number
  partNo: string
  description: string | null
  qty: number
}

export interface Grn {
  id: string
  grnNo: string
  invoiceId: string | null
  invoiceNo: string | null
  plRef: string
  soNo: string | null
  packages: string | null
  modelCode: string | null
  customerId: string | null
  receivedAt: string
  receiverCode: string | null
  note: string | null
  /** รับของทดแทน (แทน NG ที่ส่งคืน) */
  replacement?: boolean
}

export interface GrnLine {
  id: string
  grnId: string
  lineNo: number
  partNo: string
  description: string | null
  partType: string | null
  plQty: number
  countedQty: number
  invoiceQty: number | null
  needsQi: boolean
  homeLocation: string | null
}

export interface LpnItem {
  id: string
  lpnId: string
  grnLineId: string
  partNo: string
  qty: number
  /** ป้ายที่รายการนี้อยู่ก่อนถูกรวม (มีค่า = กล่องนี้เกิดจากการรวม ยกเลิกการรวมได้) */
  prevLpnId?: string | null
}

export type LpnStatus = 'active' | 'empty' | 'merged' | 'void'

export interface Lpn {
  id: string
  lpnNo: string
  grnId: string | null
  locationCode: string
  hold: boolean
  status: LpnStatus
  createdAt: string
  items: LpnItem[]
  /** จากใบรับสินค้าของกล่อง (มีเมื่อโหลดรายการกล่อง) */
  grnNo?: string | null
  modelCode?: string | null
  invoiceNo?: string | null
}

export type TxKind = 'RECEIVE' | 'PUT' | 'MOVE' | 'ISSUE' | 'ADJ' | 'COUNT' | 'QI' | 'MERGE' | 'UNMERGE' | 'SPLIT' | 'RETURN'

export interface Tx {
  id: string
  kind: TxKind
  docNo: string | null
  lpnId: string | null
  lpnNo: string | null
  lpnItemId: string | null
  partNo: string | null
  qty: number | null
  newQty: number | null
  passQty: number | null
  ngQty: number | null
  fromLoc: string | null
  toLoc: string | null
  ref: string | null
  reason: string | null
  status: 'done' | 'pending' | 'approved' | 'rejected'
  createdCode: string | null
  createdAt: string
  decidedCode: string | null
  /** ใบเบิกที่ทำให้เกิดรายการนี้ (เบิก/คืน) */
  requisitionId?: string | null
}

export interface StorageLoc {
  code: string
  zoneId: string
  kind: 'bin' | 'floor' | 'staging' | 'hold' | 'ng'
  /** ใช้งานได้ (อยู่ในผังหรือเป็นช่องพิเศษ และไม่ได้ถูกปิด) */
  active: boolean
  /** ปิดใช้จากหน้าหลังบ้าน (เช่น ชำรุด) · บันทึกผังไม่เปิดคืน */
  blocked?: boolean
  /** ช่องพิเศษที่เพิ่มในหน้าหลังบ้าน · บันทึกผังไม่ปิด */
  manual?: boolean
}

export interface ZoneHead {
  zoneId: string
  staffId: string
  employeeCode: string
  fullName: string
}

export interface StaffBrief {
  id: string
  employeeCode: string
  fullName: string
  role: string
}

export interface PartMaster {
  /** รหัสลูกค้าแบบเลขฐาน (หลัก) เช่น RAT00586 · revision /B แยกไว้ที่ revision */
  partNo: string
  name: string
  type: string | null
  customerId: string | null
  models: string[]
  /** รหัสภายใน UAM เช่น 2011409 */
  uamCode?: string | null
  /** revision ล่าสุดที่เห็น เช่น B (ข้อมูลประกอบ) */
  revision?: string | null
}

/** ชุดวงล้อสำเร็จรูป (FG) ที่ไลน์เบิก + BOM จำนวน part ต่อ 1 วง */
export interface FgItem {
  /** รหัส FG เช่น 2019333 */
  code: string
  name: string
  modelCode: string | null
  active: boolean
  lines: { partNo: string; qtyPer: number }[]
}

export interface ModelRow {
  code: string
  customerId: string
  requiresInspection: boolean
}

export interface ZoneRuleRow {
  customerId: string
  partType: string | null
  zoneId: string
}

export interface MasterData {
  parts: PartMaster[]
  models: ModelRow[]
  rules: ZoneRuleRow[]
  locations: StorageLoc[]
  zoneHeads: ZoneHead[]
  fgItems: FgItem[]
}

/** ใบเบิก: line = ใบเบิกย่อยเข้าไลน์, fm005 = FM-P-005 ยอดรวมจบวัน, qc = QC เบิก, ng = ตัด NG ส่งคืน */
export type RequisitionKind = 'line' | 'fm005' | 'qc' | 'ng'

export interface RequisitionLine {
  partNo: string
  /** ใบย่อย: ขอเบิก · FM-P-005: ผลรวมใบย่อยของวัน */
  reqQty: number | null
  /** ใบย่อย: จ่ายจริง · FM-P-005: ยอดในเอกสาร */
  qty: number
  /** สต็อกคงเหลือหลังบันทึก */
  balance: number | null
}

export interface Requisition {
  id: string
  kind: RequisitionKind
  reqNo: string
  docNo: string | null
  docDate: string
  modelCode: string | null
  fgCode: string | null
  fgQty: number | null
  fromDept: string | null
  toDept: string | null
  note: string | null
  status: 'posted' | 'void'
  reconciledBy: string | null
  createdCode: string | null
  createdAt: string
  lines: RequisitionLine[]
}

export interface RequisitionPayload {
  kind: 'line' | 'qc' | 'ng'
  docNo?: string
  docDate: string
  modelCode?: string
  fgCode?: string
  fgQty?: number | null
  fromDept?: string
  toDept?: string
  note?: string
  lines: { partNo: string; reqQty?: number | null; qty: number }[]
}

/** สแกนเบิกจากกล่อง = ใบเบิก (นับรวมตอนกระทบ FM-P-005) */
export interface ScanIssuePayload {
  itemId: string
  qty: number
  /** line = เข้าไลน์, qc = QC เบิก, ng = ตัด NG / ส่งคืน */
  kind: 'line' | 'qc' | 'ng'
  /** ต้องมีเมื่อเบิกเข้าไลน์ */
  modelCode?: string | null
  /** เลขใบเบิกกระดาษ · สแกนหลายกล่องด้วยเลขเดียวกันในวันเดียวกัน = ใบเดียวกัน */
  docNo?: string
  /** ปลายทาง เช่น ไลน์ประกอบ Bigbike ชั้น 2 */
  toDept?: string
}

export interface ScanIssueResult {
  id: string
  reqNo: string
  docNo: string | null
  /** ต่อท้ายใบเบิกเดิม (เลขใบเบิกเดียวกัน) */
  appended: boolean
}

export interface ReconcilePayload {
  docNo: string
  docDate: string
  modelCode: string
  fgCode?: string
  fgQty?: number | null
  fromDept?: string
  toDept?: string
  note?: string
  lines: { partNo: string; qty: number }[]
}

/** ช่องในบัญชีคุม FM-P-537: รับเข้าปกติ / ทดแทน / เบิก (ติดลบ = คืน) / NG / QC เบิก / ปรับยอด */
export type LedgerCol = 'recv' | 'recv_rep' | 'issue' | 'ng' | 'qc' | 'adj'

export interface LedgerRow {
  at: string
  partNo: string
  kind: TxKind
  col: LedgerCol
  qty: number
  invNo: string | null
  orderNo: string | null
  orderDate: string | null
  docNo: string | null
  lot: string | null
  note: string | null
}

/** ยอดต่อ part ตอนปิดเดือน */
export interface ClosingTotal {
  partNo: string
  opening: number
  in: number
  out: number
  closing: number
}

/** ปิดยอดบัญชีคุม FM-P-537 ของ Model ในเดือน + การรับทราบของ Planning / บัญชี */
export interface StockClosing {
  id: string
  modelCode: string
  /** YYYY-MM */
  month: string
  status: 'closed' | 'reopened'
  totals: ClosingTotal[]
  closedBy: string | null
  closedAt: string | null
  planningBy: string | null
  planningAt: string | null
  accountBy: string | null
  accountAt: string | null
  note: string | null
}

/** ใบตรวจนับจากไฟล์ Excel (รอผู้มีสิทธิ์อนุมัติก่อนปรับยอด) */
/** รับเข้า 1 บรรทัดของใบรับสินค้า (ยอดนับได้จริง) สำหรับหน้าภาพรวม */
export interface ReceiptRow {
  /** วันที่ (เวลาไทย) YYYY-MM-DD */
  day: string
  grnNo: string
  model: string | null
  partNo: string
  qty: number
  /** รับของทดแทน NG */
  replacement: boolean
}

/** ผลตรวจ MI3 1 รายการ (ดี / NG) พร้อม Model ของกล่อง */
export interface QiRow {
  day: string
  model: string | null
  partNo: string
  pass: number
  ng: number
}

/** ความเคลื่อนไหวย้อนหลังสำหรับหน้าภาพรวม (ใบเบิกดึงจาก listRequisitions) */
export interface DashActivity {
  receipts: ReceiptRow[]
  qi: QiRow[]
}

export interface StockCountLine {
  lineNo: number
  /** รหัสช่องเก็บหรือรหัสโซนตามที่กรอก */
  loc: string
  zoneId: string | null
  partNo: string
  /** ยอดในระบบตอนส่ง */
  systemQty: number
  countedQty: number
  /** ส่วนต่างที่ปรับจริงตอนอนุมัติ */
  appliedQty: number | null
}

export interface StockCount {
  id: string
  countNo: string
  status: 'pending' | 'approved' | 'rejected'
  note: string | null
  createdCode: string | null
  createdAt: string
  decidedCode: string | null
  decidedAt: string | null
  decisionNote: string | null
  /** เอกสารของกล่องใหม่ (ยอดนับเกินและไม่มีกล่องเดิม) ใช้พิมพ์ป้าย */
  grnId: string | null
  lines: StockCountLine[]
}

export interface StockCountPayload {
  note?: string
  lines: { loc: string; partNo: string; counted: number }[]
}

/** งานในคิวพิมพ์ (ส่งจากมือถือ ให้คอมจุดพิมพ์พิมพ์) */
export interface PrintJob {
  id: string
  format: 'label' | 'sheet' | 'a4'
  grnId: string
  lpnIds: string[]
  copies: number
  title: string | null
  status: 'queued' | 'printed' | 'cancelled'
  requestedCode: string | null
  requestedAt: string
  doneCode: string | null
  doneAt: string | null
}

export interface PrintJobPayload {
  format: PrintJob['format']
  grnId: string
  lpnIds: string[]
  copies?: number
  title?: string
}

/** ข้อมูลที่หน้ารับของส่งไปสร้าง GRN */
export interface ReceivePayload {
  invoice?: {
    invoiceNo: string
    customerId?: string
    poNo?: string
    docDate?: string
    movementType?: string
    lines: { lineNo: number; partNo: string; description: string; qty: number }[]
    imagePaths?: string[]
  }
  packingList: { refDoc: string; soNo?: string; packages?: string; imagePaths?: string[] }
  modelCode: string
  note?: string
  /** รับของทดแทน */
  replacement?: boolean
  /** zoneId = โซนเก็บที่ผู้รับเลือกเอง (ไม่ระบุ = ระบบแนะนำตามกฎลูกค้า + กลุ่ม part) */
  lines: { partNo: string; description: string; plQty: number; countedQty: number; zoneId?: string }[]
}

export interface GrnDetail {
  grn: Grn
  lines: GrnLine[]
  lpns: Lpn[]
}

export interface InvoiceView {
  invoice: Invoice
  lines: InvoiceLine[]
  grns: Grn[]
  received: { partNo: string; qty: number }[]
}

export interface PermRow {
  role: string
  perm: string
  allowed: boolean
}
