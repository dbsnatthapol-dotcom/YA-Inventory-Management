import type { SupabaseClient } from '@supabase/supabase-js'
import type { WmsApi } from './api'
import type { Grn, GrnLine, Invoice, InvoiceLine, Lpn, LpnItem, StorageLoc, Tx } from './types'

type Row = Record<string, unknown>
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const str = (v: unknown) => (v === null || v === undefined ? null : String(v))

async function run<T = unknown>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p
  if (error) throw new Error(error.message)
  return data as T
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

const GRN_SELECT = 'id, grn_no, invoice_id, model_code, customer_id, received_at, receiver_code, note, packing_lists(ref_doc, so_no, packages), invoices(invoice_no)'

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
  }
}

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
const LPN_SELECT = 'id, lpn_no, grn_id, location_code, hold, status, created_at, lpn_items!lpn_items_lpn_id_fkey(id, lpn_id, grn_line_id, part_no, qty, prev_lpn_id)'
const toLpn = (r: Row): Lpn => ({
  id: String(r.id),
  lpnNo: String(r.lpn_no),
  grnId: str(r.grn_id),
  locationCode: String(r.location_code),
  hold: Boolean(r.hold),
  status: r.status as Lpn['status'],
  createdAt: String(r.created_at),
  items: ((r.lpn_items as Row[] | null) ?? []).map(toItem),
})

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
      const [parts, models, rules, locs, heads] = await Promise.all([
        run(sb.from('parts').select('part_no, name, part_type, customer_id, part_models(model_code)').order('part_no').limit(5000)),
        run(sb.from('product_models').select('code, customer_id, requires_inspection').order('code')),
        run(sb.from('zone_rules').select('customer_id, part_type, zone_id')),
        run(sb.from('locations').select('code, zone_id, kind, active').order('code').limit(5000)),
        rpc<Row[]>('zone_head_list'),
      ])
      return {
        parts: (parts as Row[]).map((p) => ({
          partNo: String(p.part_no),
          name: String(p.name),
          type: str(p.part_type),
          customerId: str(p.customer_id),
          models: ((p.part_models as Row[] | null) ?? []).map((m) => String(m.model_code)),
        })),
        models: (models as Row[]).map((m) => ({ code: String(m.code), customerId: String(m.customer_id), requiresInspection: Boolean(m.requires_inspection) })),
        rules: (rules as Row[]).map((r) => ({ customerId: String(r.customer_id), partType: str(r.part_type), zoneId: String(r.zone_id) })),
        locations: (locs as Row[]).map((l) => ({ code: String(l.code), zoneId: String(l.zone_id), kind: l.kind as StorageLoc['kind'], active: Boolean(l.active) })),
        zoneHeads: heads.map((h) => ({ zoneId: String(h.zone_id), staffId: String(h.staff_id), employeeCode: String(h.employee_code), fullName: String(h.full_name) })),
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
    scanIssue: (itemId, qty, ref, note) => rpc('scan_issue', { p_item: itemId, p_qty: qty, p_ref: ref, p_note: note }),
    scanAdjustRequest: (itemId, newQty, reason) => rpc('scan_adjust_request', { p_item: itemId, p_new_qty: newQty, p_reason: reason }),
    scanAdjustDecide: (txId, approve) => rpc('scan_adjust_decide', { p_tx: txId, p_approve: approve }),
    scanCount: async (lpnId, counted) => Number(await rpc('scan_count', { p_lpn: lpnId, p_counted: counted })),
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
    newTrialRound: async () => Number(await rpc('admin_new_trial_round')),
    upsertPart: (p) => rpc('master_upsert_part', { p_part_no: p.partNo, p_name: p.name, p_type: p.type ?? '', p_customer: p.customerId, p_models: p.models }),
    upsertLocation: (l) => rpc('master_upsert_location', { p_code: l.code, p_zone: l.zoneId, p_kind: l.kind, p_active: l.active }),
    setZoneRule: (r) => rpc('master_set_zone_rule', { p_customer: r.customerId, p_type: r.partType ?? '', p_zone: r.zoneId }),
    saveLayout: async (p) => {
      await rpc('layout_save', { p })
    },
  }
  return api
}
