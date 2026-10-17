import type {
  CycleActivity,
  DashActivity,
  EnvSummary,
  Grn,
  GrnDetail,
  InvoiceStatus,
  InvoiceView,
  Lpn,
  MasterData,
  PartMaster,
  PermRow,
  ReceivePayload,
  Settings,
  StaffBrief,
  FgItem,
  LedgerRow,
  StockClosing,
  StockCount,
  PrintJob,
  PrintJobPayload,
  StockCountPayload,
  ReconcilePayload,
  Requisition,
  RequisitionPayload,
  ScanIssuePayload,
  ScanIssueResult,
  StorageLoc,
  Tx,
  ZoneRuleRow,
} from './types'
import type { LayoutSavePayload } from '../lib/layoutSave'

/** ช่องทางเดียวที่หน้าจองานคลังใช้ — มีสองแบบ: Supabase (ใช้งานจริง) และ demo (เก็บในเบราว์เซอร์) */
export interface WmsApi {
  kind: 'supabase' | 'demo'
  myPermissions(): Promise<string[]>
  settings(): Promise<Settings>
  master(): Promise<MasterData>

  findInvoiceNo(invoiceNo: string): Promise<{ id: string; grnCount: number } | null>
  createGrn(p: ReceivePayload): Promise<{ grnId: string; grnNo: string }>
  uploadDoc(file: File, kind: 'pl' | 'invoice'): Promise<string | null>
  attachImages(grnId: string, plPaths: string[], invoicePaths: string[]): Promise<void>
  listGrns(limit?: number): Promise<Grn[]>
  grnDetail(grnId: string): Promise<GrnDetail | null>
  findGrnId(grnNo: string): Promise<string | null>
  mergeLpns(lpnIds: string[], location?: string): Promise<{ lpnId: string; lpnNo: string }>
  /** คืนป้ายเดิมก่อนรวม · ได้เฉพาะเมื่อกล่องรวมยังไม่มีการเคลื่อนไหว */
  unmergeLpn(lpnId: string): Promise<{ lpnNos: string }>
  /** ย้าย part/จำนวนที่เลือกออกไปกล่องใหม่ (เลข LPN ใหม่) */
  splitLpn(lpnId: string, items: { itemId: string; qty: number }[]): Promise<{ lpnId: string; lpnNo: string }>

  findLpn(lpnNo: string): Promise<{ lpn: Lpn; grn: Grn | null; homeLocation: string | null } | null>
  scanMove(lpnId: string, to: string, kind: 'PUT' | 'MOVE'): Promise<void>
  /** เบิกจากกล่องที่สแกน = ใบเบิก (เข้าไลน์ / QC เบิก / NG) · FM-P-005 นับรวม ไม่ตัดซ้ำ */
  scanIssue(p: ScanIssuePayload): Promise<ScanIssueResult>
  scanAdjustRequest(itemId: string, newQty: number, reason: string): Promise<string>
  scanAdjustDecide(txId: string, approve: boolean): Promise<void>
  /** บันทึกการนับของ part ในกล่อง (ยอดยังไม่เปลี่ยน) · คืนส่วนต่าง นับได้ − ระบบ */
  scanCountItem(itemId: string, counted: number): Promise<number>
  scanQi(lpnId: string, pass: number, ng: number, note: string): Promise<string>
  recentTx(limit?: number, lpnId?: string): Promise<Tx[]>
  pendingAdjustments(): Promise<Tx[]>
  activeLpns(): Promise<Lpn[]>

  invoiceView(query: string): Promise<InvoiceView | null>
  invoiceSetStatus(invoiceId: string, status: InvoiceStatus, note?: string): Promise<void>
  listInvoices(limit?: number): Promise<{ id: string; invoiceNo: string; status: InvoiceStatus; createdAt: string }[]>

  // หลังบ้าน
  permissionRows(): Promise<PermRow[]>
  setPermission(role: string, perm: string, allowed: boolean): Promise<void>
  staffDirectory(): Promise<StaffBrief[]>
  setZoneHead(zoneId: string, staffId: string | null): Promise<void>
  setSetting(key: 'wms_mode' | 'qi_part_types', value: unknown): Promise<void>
  /** ข้อมูลรายการของโหมดปัจจุบัน + ชุดที่ล้างเก็บไว้ */
  envSummary(): Promise<EnvSummary>
  /** ล้างข้อมูลรายการของโหมดปัจจุบันไปเก็บเป็นชุดใหม่ (ไม่ลบ) · confirm ต้องเป็น ARCHIVE_CONFIRM · คืนเลขชุด */
  archiveEnv(confirm: string, note: string): Promise<number>
  /** กู้คืนชุดที่เก็บไว้กลับเข้าโหมดเดิม (ต้องอยู่ในโหมดนั้นและโหมดนั้นยังว่าง) */
  restoreArchive(id: number): Promise<void>
  upsertPart(p: PartMaster): Promise<void>
  /** หลังบ้าน: active = false ปิดช่อง (ชำรุด) · true เปิดคืน · รหัสใหม่ = ช่องพิเศษ */
  upsertLocation(l: StorageLoc): Promise<void>
  setZoneRule(r: ZoneRuleRow): Promise<void>
  /** ชุดวงล้อ (FG) + BOM */
  saveFg(fg: FgItem): Promise<void>
  // ใบเบิกเข้าไลน์ + บัญชีคุม
  /** บันทึกใบเบิก แล้วตัดสต็อกจากกล่องที่รับเข้าก่อน (FIFO) */
  postRequisition(p: RequisitionPayload): Promise<{ id: string; reqNo: string }>
  /** FM-P-005: กระทบกับใบย่อยของวัน/Model เดียวกัน ส่วนต่างตัดเพิ่มหรือคืนเข้าสต็อก */
  reconcileFm005(p: ReconcilePayload): Promise<{ id: string; reqNo: string; subs: number }>
  voidRequisition(id: string, reason: string): Promise<void>
  /** ใบเบิกตามช่วงวันที่ (YYYY-MM-DD) */
  listRequisitions(from: string, to: string): Promise<Requisition[]>
  /** รายการเคลื่อนไหวของ part ก่อนเวลา to (ISO) สำหรับบัญชีคุม */
  ledgerRows(parts: string[], to: string): Promise<LedgerRow[]>
  /** หน้าภาพรวม: รับเข้า (ต่อบรรทัดใบรับ ไม่รวมกล่องใหม่จากการตรวจนับ) และผลตรวจ MI3 ตั้งแต่วันที่ fromDay (เวลาไทย) */
  dashboardActivity(fromDay: string): Promise<DashActivity>
  /** วางแผนนับวน: การนับตั้งแต่ countsFrom และการเข้า-ออกของช่องตั้งแต่ movesFrom (วันที่ YYYY-MM-DD) */
  cycleActivity(countsFrom: string, movesFrom: string): Promise<CycleActivity>
  /** ปิดยอดทุก Model (ใช้ดูสถานะและงานรอรับทราบ) */
  listClosings(): Promise<StockClosing[]>
  /** ปิดยอดเดือนที่จบแล้ว (สิทธิ์ ledger.close) · ใบเบิกของเดือนนั้นแก้ไม่ได้จนกว่าจะเปิดเดือน */
  closeMonth(model: string, month: string, note?: string): Promise<void>
  reopenMonth(id: string, reason: string): Promise<void>
  /** รับทราบยอด: planning (ledger.ack.planning) หรือ account (ledger.ack.account) */
  ackClosing(id: string, side: 'planning' | 'account'): Promise<void>
  // นำเข้ายอดตรวจนับ (Part + ช่องเก็บ/โซน) → อนุมัติ → ปรับยอด
  /** ส่งใบตรวจนับ (สิทธิ์ scan.count) · ระบบบันทึกยอดในระบบ ณ ตอนส่ง */
  submitStockCount(p: StockCountPayload): Promise<{ id: string; countNo: string }>
  listStockCounts(): Promise<StockCount[]>
  /** อนุมัติ = ปรับยอดตามส่วนต่าง (สิทธิ์ scan.adjust.approve, คนส่งอนุมัติเองไม่ได้) */
  decideStockCount(id: string, approve: boolean, note?: string): Promise<{ changed: number; newBoxes: number; grnId: string | null }>
  // คิวพิมพ์ป้าย: มือถือส่ง → คอมจุดพิมพ์พิมพ์
  queuePrint(p: PrintJobPayload): Promise<string>
  /** งานที่รอพิมพ์ + ที่เพิ่งพิมพ์/ยกเลิก (ล่าสุดก่อน) */
  listPrintJobs(): Promise<PrintJob[]>
  finishPrintJob(id: string, status: 'printed' | 'cancelled'): Promise<void>

  /** บันทึกผังที่แก้ลงฐานข้อมูลกลาง (สิทธิ์ layout.edit) */
  saveLayout(p: LayoutSavePayload): Promise<void>
}

/** ข้อความ error ที่อ่านรู้เรื่อง (ข้อความจากฐานข้อมูลเป็นภาษาไทยอยู่แล้ว) */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
