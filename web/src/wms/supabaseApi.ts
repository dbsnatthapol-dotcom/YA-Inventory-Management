import type { SupabaseClient } from '@supabase/supabase-js'
import type { WmsApi } from './api'
import { bangkokDay } from './ledger'
import type {
  ClosingTotal,
  EnvArchive,
  EnvCounts,
  FgItem,
  Grn,
  GrnLine,
  Invoice,
  InvoiceLine,
  LedgerRow,
  Lpn,
  LpnItem,
  PrintJob,
  Requisition,
  ScanIssueResult,
  StockClosing,
  StockCount,
  StorageLoc,
  Tx,
  TxKind,
} from './types'

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))

async function run<T = unknown>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(friendly(error.message))
  return data as T
}

/** ฟังก์ชัน/ตารางที่ยังไม่มีในฐานข้อมูล = ยังไม่ได้รัน SQL ไฟล์ล่าสุดใน supabase/migrations */
function friendly(msg: string): string {
  const m = /Could not find the (?:function|table) '?public\.(\w+)/.exec(msg) ?? /relation "public\.(\w+)" does not exist/.exec(msg)
  return m ? `ฐานข้อมูลยังไม่ได้อัปเดต (ไม่พบ ${m[1]}) · ให้ผู้ดูแลระบบรัน SQL ไฟล์ล่าสุดใน supabase/migrations` : msg
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

const GRN_SELECT = 'id, grn_no, invoice_id, model_code, customer_id, received_at, receiver_code, note, replacement, packing_lists(ref_doc, so_no, packages), invoices(invoice_no)'

function toGrn(r: Row): Grn {
  const pl = one(r.packing_lists as Row | Row[] | null)
  const inv = one(r.invoices as Row | Row[] | null)
  return {
    id: String(r.id),
    grnNo: String(r.grn_no),
    invoiceId: str(r.invoice_id),
    invoiceNo: inv ? str(inv.invoice_no) : null,
    plRef: pl ? String(pl.ref_doc) : '',
    soNo: pl ? str(pl.so_no) : null,
    packages: pl ? str(pl.packages) : null,
    modelCode: str(r.model_code),
    customerId: str(r.customer_id),
    receivedAt: String(r.received_at),
    receiverCode: str(r.receiver_code),
    note: str(r.note),
    replacement: Boolean(r.replacement),
  }
}

const toRequisition = (r: Row): Requisition => ({
  id: String(r.id),
  kind: r.kind as Requisition['kind'],
  reqNo: String(r.req_no),
  docNo: str(r.doc_no),
  docDate: String(r.doc_date),
  modelCode: str(r.model_code),
  fgCode: str(r.fg_code),
  fgQty: num(r.fg_qty),
  fromDept: str(r.from_dept),
  toDept: str(r.to_dept),
  note: str(r.note),
  status: r.status === 'void' ? 'void' : 'posted',
  reconciledBy: str(r.reconciled_by),
  createdCode: str(r.created_code),
  createdAt: String(r.created_at),
  lines: ((r.requisition_lines as Row[] | null) ?? [])
    .sort((a, b) => Number(a.line_no) - Number(b.line_no))
    .map((l) => ({ partNo: String(l.part_no), reqQty: num(l.req_qty), qty: Number(l.qty ?? 0), balance: num(l.balance) })),
})

const toGrnLine = (r: Row): GrnLine => ({
  id: String(r.id),
  grnId: String(r.grn_id),
  lineNo: Number(r.line_no),
  partNo: String(r.part_no),
  description: str(r.description),
  partType: str(r.part_type),
  plQty: Number(r.pl_qty),
  countedQty: Number(r.counted_qty),
  invoiceQty: num(r.invoice_qty),
  needsQi: Boolean(r.needs_qi),
  homeLocation: str(r.home_location),
})

const toItem = (r: Row): LpnItem => ({ id: String(r.id), lpnId: String(r.lpn_id), grnLineId: String(r.grn_line_id), partNo: String(r.part_no), qty: Number(r.qty), prevLpnId: str(r.prev_lpn_id) })

// lpn_items อ้างถึง lpns สองทาง (lpn_id = กล่องปัจจุบัน, prev_lpn_id = กล่องก่อนรวม) ต้องระบุ FK ไม่งั้น PostgREST ไม่รู้ว่าจะ join ทางไหน
// grns ระบุ FK ด้วย เพราะ lpns อ้างตัวเอง (merged_into) อาจถูกมองเป็นตารางเชื่อม
const LPN_SELECT =
  'id, lpn_no, grn_id, location_code, hold, status, created_at, lpn_items!lpn_items_lpn_id_fkey(id, lpn_id, grn_line_id, part_no, qty, prev_lpn_id), grns!lpns_grn_id_fkey(grn_no, model_code, invoices(invoice_no))'
const toLpn = (r: Row): Lpn => {
  const g = one(r.grns as Row | Row[] | null)
  return {
    id: String(r.id),
    lpnNo: String(r.lpn_no),
    grnId: str(r.grn_id),
    locationCode: String(r.location_code),
    hold: Boolean(r.hold),
    status: r.status as Lpn['status'],
    createdAt: String(r.created_at),
    items: ((r.lpn_items as Row[] | null) ?? []).map(toItem),
    grnNo: str(g?.grn_no),
    modelCode: str(g?.model_code),
    invoiceNo: str(one(g?.invoices as Row | Row[] | null)?.invoice_no),
  }
}

const TX_SELECT =
  'id, kind, doc_no, lpn_id, lpn_item_id, part_no, qty, new_qty, pass_qty, ng_qty, from_loc, to_loc, ref, reason, status, created_code, created_at, decided_code, lpns(lpn_no)'
const toTx = (r: Row): Tx => ({
  id: String(r.id),
  kind: r.kind as Tx['kind'],
  docNo: str(r.doc_no),
  lpnId: str(r.lpn_id),
  lpnNo: str(one(r.lpns as Row | Row[] | null)?.lpn_no),
  lpnItemId: str(r.lpn_item_id),
  partNo: str(r.part_no),
  qty: num(r.qty),
  newQty: num(r.new_qty),
  passQty: num(r.pass_qty),
  ngQty: num(r.ng_qty),
  fromLoc: str(r.from_loc),
  toLoc: str(r.to_loc),
  ref: str(r.ref),
  reason: str(r.reason),
  status: r.status as Tx['status'],
  createdCode: str(r.created_code),
  createdAt: String(r.created_at),
  decidedCode: str(r.decided_code),
})

const toInvoice = (r: Row): Invoice => ({
  id: String(r.id),
  invoiceNo: String(r.invoice_no),
  customerId: str(r.customer_id),
  poNo: str(r.po_no),
  docDate: str(r.doc_date),
  movementType: str(r.movement_type),
  status: r.status as Invoice['status'],
  statusNote: str(r.status_note),
  statusAt: str(r.status_at),
  imagePaths: (r.image_paths as string[] | null) ?? [],
  createdAt: String(r.created_at),
})

/** ย่อภาพจากกล้อง (มัก 4000px+) ก่อนเก็บเป็นหลักฐาน */
async function toJpeg(file: File, maxSide = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงภาพไม่สำเร็จ'))), 'image/jpeg', 0.85))
}

export function supabaseWms(sb: SupabaseClient): WmsApi {
  const rpc = <T>(fn: string, args?: Record<string, unknown>) => run<T>(sb.rpc(fn, args))

  const api: WmsApi = {
    kind: 'supabase',
    myPermissions: () => rpc<string[]>('my_permissions'),

    async settings() {
      const rows = await run(sb.from('app_settings').select('key, value'))
      const get = (k: string) => (rows as Row[]).find((r) => r.key === k)?.value
      return {
        mode: get('wms_mode') === 'live' ? 'live' : 'trial',
        trialRound: Number(get('trial_round') ?? 1),
        qiPartTypes: (get('qi_part_types') as string[] | undefined) ?? ['RIM', 'HUB'],
      }
    },

    async master() {
      const [parts, models, rules, locs, heads, fgs] = await Promise.all([
        run(sb.from('parts').select('part_no, name, part_type, customer_id, uam_code, revision, part_models(model_code)').order('part_no').limit(5000)),
        run(sb.from('product_models').select('code, customer_id, requires_inspection').order('code')),
        run(sb.from('zone_rules').select('customer_id, part_type, zone_id')),
        // select * : ใช้ได้ทั้งก่อนและหลังเพิ่มคอลัมน์ blocked / manual (0018)
        run(sb.from('locations').select('*').order('code').limit(5000)),
        rpc<Row[]>('zone_head_list'),
        run(sb.from('fg_items').select('code, name, model_code, active, fg_bom(part_no, qty_per)').order('code')),
      ])
      return {
        parts: (parts as Row[]).map((p) => ({
          partNo: String(p.part_no),
          name: String(p.name),
          type: str(p.part_type),
          customerId: str(p.customer_id),
          models: ((p.part_models as Row[] | null) ?? []).map((m) => String(m.model_code)),
          uamCode: str(p.uam_code),
          revision: str(p.revision),
        })),
        models: (models as Row[]).map((m) => ({ code: String(m.code), customerId: String(m.customer_id), requiresInspection: Boolean(m.requires_inspection) })),
        rules: (rules as Row[]).map((r) => ({ customerId: String(r.customer_id), partType: str(r.part_type), zoneId: String(r.zone_id) })),
        locations: (locs as Row[]).map((l) => ({
          code: String(l.code),
          zoneId: String(l.zone_id),
          kind: l.kind as StorageLoc['kind'],
          active: Boolean(l.active),
          blocked: Boolean(l.blocked),
          manual: Boolean(l.manual),
        })),
        zoneHeads: heads.map((h) => ({ zoneId: String(h.zone_id), staffId: String(h.staff_id), employeeCode: String(h.employee_code), fullName: String(h.full_name) })),
        fgItems: (fgs as Row[]).map(
          (f): FgItem => ({
            code: String(f.code),
            name: String(f.name),
            modelCode: str(f.model_code),
            active: Boolean(f.active),
            lines: ((f.fg_bom as Row[] | null) ?? []).filter((b) => Number(b.qty_per) > 0).map((b) => ({ partNo: String(b.part_no), qtyPer: Number(b.qty_per) })),
          }),
        ),
      }
    },

    async findInvoiceNo(invoiceNo) {
      const r = one(await run(sb.from('invoices').select('id, grns(id)').eq('invoice_no', invoiceNo.trim()).limit(1)))
      return r ? { id: String((r as Row).id), grnCount: (((r as Row).grns as Row[] | null) ?? []).length } : null
    },

    async createGrn(p) {
      return rpc<{ grnId: string; grnNo: string }>('create_grn', { p })
    },

    async uploadDoc(file, kind) {
      try {
        const blob = await toJpeg(file)
        const d = new Date()
        const path = `${kind}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.jpg`
        const { error } = await sb.storage.from('wms-docs').upload(path, blob, { contentType: 'image/jpeg' })
        if (error) throw error
        return path
      } catch (e) {
        console.warn('อัปโหลดภาพเอกสารไม่สำเร็จ:', e)
        return null
      }
    },

    attachImages: (grnId, plPaths, invoicePaths) => rpc('attach_receiving_images', { p_grn: grnId, p_pl_paths: plPaths, p_invoice_paths: invoicePaths }),

    async listGrns(limit = 30) {
      return ((await run(sb.from('grns').select(GRN_SELECT).order('received_at', { ascending: false }).limit(limit))) as Row[]).map(toGrn)
    },

    async grnDetail(grnId) {
      const [g, lines, lpns] = await Promise.all([
        run(sb.from('grns').select(GRN_SELECT).eq('id', grnId).maybeSingle()),
        run(sb.from('grn_lines').select('*').eq('grn_id', grnId).order('line_no')),
        run(sb.from('lpns').select(LPN_SELECT).eq('grn_id', grnId).not('status', 'in', '(merged,void)').order('lpn_no')),
      ])
      if (!g) return null
      return { grn: toGrn(g as Row), lines: (lines as Row[]).map(toGrnLine), lpns: (lpns as Row[]).map(toLpn) }
    },

    async findGrnId(grnNo) {
      const r = (await run(sb.from('grns').select('id').eq('grn_no', grnNo.trim().toUpperCase()).maybeSingle())) as Row | null
      return r ? String(r.id) : null
    },

    mergeLpns: (lpnIds, location) => rpc('merge_lpns', { p_lpn_ids: lpnIds, p_location: location ?? null }),
    unmergeLpn: (lpnId) => rpc('unmerge_lpn', { p_lpn: lpnId }),
    splitLpn: (lpnId, items) => rpc('split_lpn', { p_lpn: lpnId, p_items: items }),

    async findLpn(lpnNo) {
      const r = await run(sb.from('lpns').select(LPN_SELECT).eq('lpn_no', lpnNo.trim().toUpperCase()).maybeSingle())
      if (!r) return null
      const lpn = toLpn(r as Row)
      const [g, home] = await Promise.all([
        lpn.grnId ? run(sb.from('grns').select(GRN_SELECT).eq('id', lpn.grnId).maybeSingle()) : Promise.resolve(null),
        lpn.items[0] ? run(sb.from('grn_lines').select('home_location').eq('id', lpn.items[0].grnLineId).maybeSingle()) : Promise.resolve(null),
      ])
      return { lpn, grn: g ? toGrn(g as Row) : null, homeLocation: str((home as Row | null)?.home_location) }
    },

    scanMove: (lpnId, to, kind) => rpc('scan_move', { p_lpn: lpnId, p_to: to, p_kind: kind }),
    scanIssue: (p) => rpc<ScanIssueResult>('scan_issue_req', { p }),
    scanAdjustRequest: (itemId, newQty, reason) => rpc('scan_adjust_request', { p_item: itemId, p_new_qty: newQty, p_reason: reason }),
    scanAdjustDecide: (txId, approve) => rpc('scan_adjust_decide', { p_tx: txId, p_approve: approve }),
    scanCountItem: async (itemId, counted) => Number(await rpc('scan_count_item', { p_item: itemId, p_counted: counted })),
    scanQi: (lpnId, pass, ng, note) => rpc('scan_qi', { p_lpn: lpnId, p_pass: pass, p_ng: ng, p_note: note }),

    async recentTx(limit = 30, lpnId) {
      let q = sb.from('wms_tx').select(TX_SELECT).order('created_at', { ascending: false }).limit(limit)
      if (lpnId) q = q.eq('lpn_id', lpnId)
      return ((await run(q)) as Row[]).map(toTx)
    },

    async pendingAdjustments() {
      return ((await run(sb.from('wms_tx').select(TX_SELECT).eq('kind', 'ADJ').eq('status', 'pending').order('created_at'))) as Row[]).map(toTx)
    },

    async activeLpns() {
      return ((await run(sb.from('lpns').select(LPN_SELECT).eq('status', 'active').limit(5000))) as Row[]).map(toLpn)
    },

    async invoiceView(query) {
      const q = query.trim().replace(/[,()"]/g, '')
      if (!q) return null
      let inv = one(await run(sb.from('invoices').select('*').or(`invoice_no.eq.${q},po_no.eq.${q}`).limit(1))) as Row | null
      if (!inv) {
        const pl = one(await run(sb.from('packing_lists').select('invoice_id').eq('ref_doc', q).not('invoice_id', 'is', null).limit(1))) as Row | null
        if (pl) inv = (await run(sb.from('invoices').select('*').eq('id', String(pl.invoice_id)).maybeSingle())) as Row | null
      }
      if (!inv) return null
      const id = String(inv.id)
      const [lines, grns] = await Promise.all([
        run(sb.from('invoice_lines').select('line_no, part_no, description, qty').eq('invoice_id', id).order('line_no')),
        run(sb.from('grns').select(GRN_SELECT).eq('invoice_id', id).order('received_at')),
      ])
      const grnIds = (grns as Row[]).map((g) => String(g.id))
      const glines = grnIds.length ? ((await run(sb.from('grn_lines').select('part_no, counted_qty').in('grn_id', grnIds))) as Row[]) : []
      const received = new Map<string, number>()
      for (const l of glines) received.set(String(l.part_no), (received.get(String(l.part_no)) ?? 0) + Number(l.counted_qty))
      return {
        invoice: toInvoice(inv),
        lines: (lines as Row[]).map((l): InvoiceLine => ({ lineNo: Number(l.line_no), partNo: String(l.part_no), description: str(l.description), qty: Number(l.qty) })),
        grns: (grns as Row[]).map(toGrn),
        received: [...received].map(([partNo, qty]) => ({ partNo, qty })),
      }
    },

    invoiceSetStatus: (invoiceId, status, note) => rpc('invoice_set_status', { p_invoice: invoiceId, p_status: status, p_note: note ?? null }),

    async listInvoices(limit = 30) {
      return ((await run(sb.from('invoices').select('id, invoice_no, status, created_at').order('created_at', { ascending: false }).limit(limit))) as Row[]).map((r) => ({
        id: String(r.id),
        invoiceNo: String(r.invoice_no),
        status: r.status as Invoice['status'],
        createdAt: String(r.created_at),
      }))
    },

    async permissionRows() {
      return ((await run(sb.from('role_permissions').select('role, perm, allowed'))) as Row[]).map((r) => ({ role: String(r.role), perm: String(r.perm), allowed: Boolean(r.allowed) }))
    },
    setPermission: (role, perm, allowed) => rpc('admin_set_permission', { p_role: role, p_perm: perm, p_allowed: allowed }),
    async staffDirectory() {
      return (await rpc<Row[]>('staff_directory')).map((s) => ({ id: String(s.id), employeeCode: String(s.employee_code), fullName: String(s.full_name), role: String(s.role) }))
    },
    setZoneHead: (zoneId, staffId) => rpc('admin_set_zone_head', { p_zone: zoneId, p_staff: staffId }),
    setSetting: (key, value) => rpc('admin_set_setting', { p_key: key, p_value: value }),
    async envSummary() {
      const r = await rpc<{ env: string; counts: EnvCounts; archives: EnvArchive[] }>('admin_env_summary')
      return { env: r.env, counts: r.counts, archives: r.archives.map((a) => ({ ...a, id: Number(a.id) })) }
    },
    archiveEnv: async (confirm, note) => Number((await rpc<{ id: number }>('admin_archive_env', { p_confirm: confirm, p_note: note })).id),
    restoreArchive: async (id) => {
      await rpc('admin_restore_archive', { p_id: id })
    },
    upsertPart: (p) =>
      rpc('master_save_part', {
        p: { partNo: p.partNo, name: p.name, type: p.type ?? '', customerId: p.customerId, uamCode: p.uamCode ?? '', models: p.models },
      }),
    upsertLocation: (l) => rpc('master_upsert_location', { p_code: l.code, p_zone: l.zoneId, p_kind: l.kind, p_active: l.active }),
    setZoneRule: (r) => rpc('master_set_zone_rule', { p_customer: r.customerId, p_type: r.partType ?? '', p_zone: r.zoneId }),
    saveLayout: async (p) => {
      await rpc('layout_save', { p })
    },

    saveFg: async (fg) => {
      await rpc('master_save_fg', { p: fg })
    },
    postRequisition: (p) => rpc<{ id: string; reqNo: string }>('requisition_post', { p }),
    reconcileFm005: (p) => rpc<{ id: string; reqNo: string; subs: number }>('requisition_reconcile', { p }),
    voidRequisition: async (id, reason) => {
      await rpc('requisition_void', { p_id: id, p_reason: reason })
    },
    async listRequisitions(from, to) {
      const rows = (await run(
        sb
          .from('requisitions')
          .select('id, kind, req_no, doc_no, doc_date, model_code, fg_code, fg_qty, from_dept, to_dept, note, status, reconciled_by, created_code, created_at, requisition_lines(line_no, part_no, req_qty, qty, balance)')
          .gte('doc_date', from)
          .lte('doc_date', to)
          .order('created_at', { ascending: false })
          .limit(1000),
      )) as Row[]
      return rows.map(toRequisition)
    },
    async dashboardActivity(fromDay) {
      const from = `${fromDay}T00:00:00+07:00`
      const [grns, qi] = await Promise.all([
        run(
          sb
            .from('grns')
            .select('grn_no, model_code, received_at, replacement, grn_lines(part_no, counted_qty)')
            .gte('received_at', from)
            .not('grn_no', 'like', 'CNT-%')
            .order('received_at')
            .limit(3000),
        ),
        run(
          sb
            .from('wms_tx')
            .select('part_no, pass_qty, ng_qty, created_at, lpns!wms_tx_lpn_id_fkey(grns!lpns_grn_id_fkey(model_code))')
            .eq('kind', 'QI')
            .gte('created_at', from)
            .order('created_at')
            .limit(5000),
        ),
      ])
      return {
        receipts: (grns as Row[]).flatMap((g) =>
          ((g.grn_lines as Row[] | null) ?? [])
            .map((l) => ({
              day: bangkokDay(String(g.received_at)),
              grnNo: String(g.grn_no),
              model: str(g.model_code),
              partNo: String(l.part_no),
              qty: Number(l.counted_qty ?? 0),
              replacement: Boolean(g.replacement),
            }))
            .filter((r) => r.qty > 0),
        ),
        qi: (qi as Row[]).map((t) => {
          const grn = one(one(t.lpns as Row | Row[] | null)?.grns as Row | Row[] | null)
          return { day: bangkokDay(String(t.created_at)), model: grn ? str(grn.model_code) : null, partNo: String(t.part_no ?? ''), pass: Number(t.pass_qty ?? 0), ng: Number(t.ng_qty ?? 0) }
        }),
      }
    },
    async ledgerRows(parts, to) {
      const rows = await rpc<Row[]>('stock_ledger_rows', { p_parts: parts, p_to: to })
      return rows.map(
        (r): LedgerRow => ({
          at: String(r.at),
          partNo: String(r.part_no),
          kind: r.kind as TxKind,
          col: r.col as LedgerRow['col'],
          qty: Number(r.qty ?? 0),
          invNo: str(r.inv_no),
          orderNo: str(r.order_no),
          orderDate: str(r.order_date),
          docNo: str(r.doc_no),
          lot: str(r.lot),
          note: str(r.note),
        }),
      )
    },
    async listClosings() {
      const rows = (await run(sb.from('stock_closings').select('*').order('month', { ascending: false }).limit(500))) as Row[]
      return rows.map(
        (r): StockClosing => ({
          id: String(r.id),
          modelCode: String(r.model_code),
          month: String(r.month),
          status: r.status === 'closed' ? 'closed' : 'reopened',
          totals: Array.isArray(r.totals) ? (r.totals as ClosingTotal[]) : [],
          closedBy: str(r.closed_by),
          closedAt: str(r.closed_at),
          planningBy: str(r.planning_by),
          planningAt: str(r.planning_at),
          accountBy: str(r.account_by),
          accountAt: str(r.account_at),
          note: str(r.note),
        }),
      )
    },
    closeMonth: async (model, month, note) => {
      await rpc('stock_close', { p_model: model, p_month: month, p_note: note ?? null })
    },
    reopenMonth: async (id, reason) => {
      await rpc('stock_reopen', { p_id: id, p_reason: reason })
    },
    ackClosing: async (id, side) => {
      await rpc('stock_close_ack', { p_id: id, p_side: side })
    },
    submitStockCount: (p) => rpc<{ id: string; countNo: string }>('stock_count_submit', { p }),
    async listStockCounts() {
      const rows = (await run(sb.from('stock_counts').select('*, stock_count_lines(*)').order('created_at', { ascending: false }).limit(100))) as Row[]
      return rows.map(
        (r): StockCount => ({
          id: String(r.id),
          countNo: String(r.count_no),
          status: r.status as StockCount['status'],
          note: str(r.note),
          createdCode: str(r.created_code),
          createdAt: String(r.created_at),
          decidedCode: str(r.decided_code),
          decidedAt: str(r.decided_at),
          decisionNote: str(r.decision_note),
          grnId: str(r.grn_id),
          lines: ((r.stock_count_lines as Row[] | null) ?? [])
            .map((l) => ({
              lineNo: Number(l.line_no),
              loc: String(l.loc),
              zoneId: str(l.zone_id),
              partNo: String(l.part_no),
              systemQty: Number(l.system_qty),
              countedQty: Number(l.counted_qty),
              appliedQty: num(l.applied_qty),
            }))
            .sort((a, b) => a.lineNo - b.lineNo),
        }),
      )
    },
    queuePrint: (p) => rpc<string>('print_job_create', { p }),
    async listPrintJobs() {
      const rows = (await run(sb.from('print_jobs').select('*').order('requested_at', { ascending: false }).limit(50))) as Row[]
      return rows.map(
        (r): PrintJob => ({
          id: String(r.id),
          format: r.format as PrintJob['format'],
          grnId: String(r.grn_id),
          lpnIds: ((r.lpn_ids as string[] | null) ?? []).map(String),
          copies: Number(r.copies ?? 1),
          title: str(r.title),
          status: r.status as PrintJob['status'],
          requestedCode: str(r.requested_code),
          requestedAt: String(r.requested_at),
          doneCode: str(r.done_code),
          doneAt: str(r.done_at),
        }),
      )
    },
    finishPrintJob: async (id, status) => {
      await rpc('print_job_finish', { p_id: id, p_status: status })
    },
    decideStockCount: async (id, approve, note) => {
      const r = await rpc<{ changed: number; newBoxes: number; grnId?: string | null }>('stock_count_decide', { p_id: id, p_approve: approve, p_note: note ?? null })
      return { changed: r.changed, newBoxes: r.newBoxes, grnId: r.grnId ?? null }
    },
  }
  return api
}
