import type {
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
  StorageLoc,
  Tx,
  ZoneRuleRow,
} from './types'

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

  findLpn(lpnNo: string): Promise<{ lpn: Lpn; grn: Grn | null; homeLocation: string | null } | null>
  scanMove(lpnId: string, to: string, kind: 'PUT' | 'MOVE'): Promise<void>
  scanIssue(itemId: string, qty: number, ref: string, note: string): Promise<string>
  scanAdjustRequest(itemId: string, newQty: number, reason: string): Promise<string>
  scanAdjustDecide(txId: string, approve: boolean): Promise<void>
  scanCount(lpnId: string, counted: number): Promise<number>
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
  newTrialRound(): Promise<number>
  upsertPart(p: PartMaster): Promise<void>
  upsertLocation(l: StorageLoc): Promise<void>
  setZoneRule(r: ZoneRuleRow): Promise<void>
}

/** ข้อความ error ที่อ่านรู้เรื่อง (ข้อความจากฐานข้อมูลเป็นภาษาไทยอยู่แล้ว) */
export function errorText(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}
