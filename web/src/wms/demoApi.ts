import { sampleLayout } from '../data/factoryLayout'
import { MODELS, PARTS, ZONE_RULES } from '../inventory/masterData'
import type { WmsApi } from './api'
import { layoutLocations, zoneCodeOf } from './locations'
import { addDays, bangkokDay, buildLedger, monthRange, onDocDate, rowsOfModel } from './ledger'
import { tidyInvoiceLines } from './invoiceLines'
import { canonPartNo, partRevision, partsOfModel, resolvePart } from './partCodes'
import { HEAD_KINDS } from './readiness'
import { countLocations, systemQty } from './stockImport'
import type {
  CheckLine,
  CheckPayload,
  ReceiptCheck,
  Grn,
  GrnLine,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  LedgerRow,
  Lpn,
  MasterData,
  PermRow,
  ReceivePayload,
  Requisition,
  StockClosing,
  StockCount,
  PrintJob,
  Settings,
  StaffBrief,
  TraceTx,
  Tx,
  ZoneHead,
  CountRow,
  EnvArchive,
  EnvCounts,
} from './types'
import { ARCHIVE_CONFIRM, envLabel } from './types'

/**
 * โหมดสาธิต (ไม่ได้ต่อ Supabase): เก็บทุกอย่างในเบราว์เซอร์ และใช้กฎเดียวกับฟังก์ชันในฐานข้อมูล
 * (supabase/migrations/0009_wms_functions.sql) เพื่อให้ลองขั้นตอนได้ครบโดยไม่ต้อง login
 */
interface DemoDb {
  settings: Settings
  counters: Record<string, number>
  invoices: (Invoice & { lines: InvoiceLine[] })[]
  grns: Grn[]
  grnLines: GrnLine[]
  lpns: Lpn[]
  tx: Tx[]
  master: MasterData
  perms: PermRow[]
  staff: StaffBrief[]
  requisitions: Requisition[]
  closings: StockClosing[]
  counts: StockCount[]
  printJobs: PrintJob[]
  /** ใบตรวจรับ (บรรทัดอยู่ในใบ) */
  checks: DemoCheck[]
  /** ชุดที่ล้างเก็บไว้ (ฐานข้อมูลจริงย้ายแถวไป env archive-<เลขชุด>) */
  archives: Omit<EnvArchive, 'restorable'>[]
  archiveData: Record<string, DemoData>
  /** เติมกล่องตัวอย่างของหน้าสาธิตไปแล้ว (ไม่เติมซ้ำ) */
  sampled?: boolean
}

type DemoCheck = Omit<ReceiptCheck, 'grnNo' | 'lineCount' | 'checkedCount'> & { lines: CheckLine[] }

/** ข้อมูลรายการ (ล้างเก็บได้) · ที่เหลือใน DemoDb เป็นข้อมูลหลัก ค่าตั้ง และเลขเอกสาร */
const DATA_KEYS = ['invoices', 'grns', 'grnLines', 'lpns', 'tx', 'requisitions', 'closings', 'counts', 'printJobs', 'checks'] as const
type DemoData = Pick<DemoDb, (typeof DATA_KEYS)[number]>

const DEMO_HEAD = { id: 'demo-head', employeeCode: 'DEMO-WH', fullName: 'เต็มดวง (เจี๊ยบ)', role: 'warehouse' }

// v2: รหัส part เป็นเลขฐาน (ข้อมูลสาธิตเก่าที่มี /A /B เริ่มใหม่)
const KEY = 'uam-wms-demo-v2'
const ME = 'DEMO'
/** ชื่อผู้ใช้สาธิตบนเอกสาร (ปิดยอด / รับทราบ) */
const DEMO_ME = `ผู้ใช้สาธิต (${ME})`
/** สาธิต: ผู้ปิดยอด (คนละคนกับผู้ใช้สาธิต ⇒ ผู้ใช้สาธิตกดรับทราบได้) */
const DEMO_CLOSER = 'หัวหน้าคลังสาธิต (DEMO-MGR)'

function seed(): DemoDb {
  return {
    settings: { mode: 'trial', trialRound: 1, qiPartTypes: ['RIM', 'HUB'] },
    counters: {},
    requisitions: [],
    closings: [],
    counts: [],
    printJobs: [],
    checks: [],
    archives: [],
    archiveData: {},
    invoices: [],
    grns: [],
    grnLines: [],
    lpns: [],
    tx: [],
    master: {
      parts: PARTS.map((p) => ({ partNo: p.partNo, name: p.description, type: p.type, customerId: p.customerId, models: p.models, revision: p.revision ?? null })),
      models: MODELS.map((m) => ({ code: m.code, customerId: m.customerId, requiresInspection: m.requiresInspection })),
      rules: ZONE_RULES.map((r) => ({ customerId: r.customerId, partType: r.type, zoneId: r.zoneId })),
      locations: layoutLocations(sampleLayout).map((l) => ({ ...l, active: true })),
      // หัวหน้าโซนทุกโซน: พี่เต็มดวง (เจี๊ยบ) · ภายหลังแยกตามสายงาน
      zoneHeads: sampleLayout.zones
        .filter((z) => HEAD_KINDS.has(z.kind))
        .map((z) => ({ zoneId: z.id, staffId: DEMO_HEAD.id, employeeCode: DEMO_HEAD.employeeCode, fullName: DEMO_HEAD.fullName })),
      // ตัวอย่างชุดวงล้อ (สาธิต) ตามสัดส่วนใน FM-P-005 290 วง: ลูกปืน 2 ตัว, ซี่ลวดแต่ละแบบ 9 ซี่ ต่อ 1 วง
      fgItems: [
        {
          code: 'K1G-RR-BLK',
          name: 'K1G ล้อหลัง 17×3.50 TL BLACK (ตัวอย่าง)',
          modelCode: 'K1G',
          active: true,
          lines: [
            { partNo: 'RAT00586', qtyPer: 1 },
            { partNo: 'RAT01088', qtyPer: 1 },
            { partNo: 'RAT00282', qtyPer: 1 },
            { partNo: 'RAT00283', qtyPer: 1 },
            { partNo: '150324', qtyPer: 2 },
            { partNo: 'RAT00566', qtyPer: 9 },
            { partNo: 'RAT00567', qtyPer: 9 },
          ],
        },
      ],
    },
    // ค่าเริ่มต้นเดียวกับ supabase/migrations/0008_wms_receiving.sql
    perms: (
      [
        ['warehouse', ['receive.create', 'label.print', 'scan.put', 'scan.move', 'scan.issue', 'scan.adjust', 'scan.count', 'invoice.report']],
        ['mi3', ['scan.qi', 'scan.move', 'label.print']],
        ['engineer', ['scan.adjust.approve', 'invoice.close', 'invoice.report', 'layout.edit']],
        ['manager', ['scan.adjust.approve', 'invoice.close', 'invoice.report', 'accesslog.view', 'master.edit', 'layout.edit', 'ledger.close', 'ledger.ack.account']],
        ['planner', ['ledger.ack.planning']],
      ] as [string, string[]][]
    ).flatMap(([role, perms]) => perms.map((perm) => ({ role, perm, allowed: true }))),
    staff: [{ id: 'demo', employeeCode: ME, fullName: 'ผู้ใช้สาธิต', role: 'admin' }, DEMO_HEAD],
  }
}

function load(): DemoDb {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      // ข้อมูลเก่าในเครื่องอาจยังไม่มีช่องใหม่ (เช่น fgItems) ⇒ เติมจากค่าเริ่มต้น
      const base = seed()
      const saved = JSON.parse(raw) as Partial<DemoDb>
      return { ...base, ...saved, master: { ...base.master, ...saved.master } }
    }
  } catch {
    // ไม่มีที่เก็บ: เริ่มใหม่
  }
  return seed()
}

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`)
const nowIso = () => new Date().toISOString()
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** samples: หน้าสาธิตเติมกล่องตัวอย่างครั้งแรก (ผัง 3D / ค้นหา / ทัวร์มีของให้ดู) · ชุดทดสอบเริ่มจากคลังว่าง */
export function demoWms(opts: { samples?: boolean } = {}): WmsApi {
  let db = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(db))
    } catch {
      // เต็มหรือไม่มีที่เก็บ: ใช้ได้เฉพาะรอบนี้
    }
  }
  const fail = (msg: string): never => {
    throw new Error(msg)
  }  // เดือนที่ปิดยอดแล้ว: ใบเบิกของ Model นั้นแก้ไม่ได้ (เหมือน trigger requisition_month_lock)
  const assertOpen = (model: string | null | undefined, day: string) => {
    if (model && db.closings.some((c) => c.modelCode === model && c.month === day.slice(0, 7) && c.status === 'closed'))
      fail(`บัญชีคุม ${model} เดือน ${day.slice(0, 7)} ปิดยอดแล้ว · ให้ผู้มีสิทธิ์เปิดเดือนก่อน`)
  }

  const nextDoc = (prefix: string) => {
    const d = new Date()
    const yymm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`
    const key = `${prefix}-${yymm}-${db.settings.mode}-${db.settings.trialRound}`
    const n = (db.counters[key] = (db.counters[key] ?? 0) + 1)
    return `${prefix}-${yymm}-${String(n).padStart(prefix === 'LPN' ? 6 : 4, '0')}`
  }
  // โหมดสาธิตเก็บข้อมูลชุดเดียว: env ใช้แสดงผลและเทียบตอนกู้คืนเท่านั้น
  const envNow = () => (db.settings.mode === 'live' ? 'live' : `trial-${db.settings.trialRound}`)
  const envCounts = (d: DemoData): EnvCounts => ({
    grns: d.grns.length,
    lpns: d.lpns.length,
    wms_tx: d.tx.length,
    requisitions: d.requisitions.length,
    invoices: d.invoices.length,
    // 1 GRN = 1 Packing list (เหมือน create_grn)
    packing_lists: d.grns.length,
    stock_counts: d.counts.length,
    stock_closings: d.closings.length,
    print_jobs: d.printJobs.length,
    receipt_checks: (d.checks ?? []).length,
  })
  const hasData = (c: EnvCounts) => Object.values(c).some((n) => n > 0)
  const countRows = (fromDay: string): CountRow[] =>
    db.tx
      .filter((t) => t.kind === 'COUNT' && bangkokDay(t.createdAt) >= fromDay)
      .map((t) => ({ at: t.createdAt, day: bangkokDay(t.createdAt), loc: t.fromLoc, itemId: t.lpnItemId, partNo: t.partNo ?? '', system: t.qty ?? 0, counted: t.newQty ?? 0, code: t.createdCode }))
  // Model ของรายการในบัญชีคุม (เหมือน ledger_item_model / stock_ledger_entries 0023):
  // ใบรับที่ของชิ้นนั้นมา (รายการในกล่อง ⇒ กล่อง) ⇒ Model เดียวของ part · part ร่วมที่ไม่รู้ ⇒ null
  const soleModel = (part: string | null) => {
    const models = [...new Set(db.master.parts.find((p) => p.partNo === part)?.models ?? [])]
    return models.length === 1 ? models[0] : null
  }
  const itemModel = (itemId: string | null | undefined, lpnId: string | null | undefined, part: string | null | undefined) => {
    const item = itemId ? db.lpns.flatMap((l) => l.items).find((i) => i.id === itemId) : undefined
    const line = item ? db.grnLines.find((g) => g.id === item.grnLineId) : undefined
    const box = lpnId ? db.lpns.find((l) => l.id === lpnId) : undefined
    return (line && db.grns.find((g) => g.id === line.grnId)?.modelCode) || (box && db.grns.find((g) => g.id === box.grnId)?.modelCode) || soleModel(part ?? null)
  }
  const log = (t: Partial<Tx> & Pick<Tx, 'kind'>) => {
    // ใบ QC / NG ที่ไม่มี Model: ติดล็อกปิดเดือนตาม Model ของใบรับที่ของมา (เหมือน trigger wms_tx_month_lock 0023)
    const req = (t.kind === 'ISSUE' || t.kind === 'RETURN') && t.requisitionId ? db.requisitions.find((r) => r.id === t.requisitionId) : undefined
    if (req && !req.modelCode) assertOpen(itemModel(t.lpnItemId, t.lpnId, t.partNo), req.docDate)
    return db.tx.unshift({
      id: uid(),
      docNo: null,
      lpnId: null,
      lpnNo: null,
      lpnItemId: null,
      partNo: null,
      qty: null,
      newQty: null,
      passQty: null,
      ngQty: null,
      fromLoc: null,
      toLoc: null,
      ref: null,
      reason: null,
      status: 'done',
      createdCode: ME,
      createdAt: nowIso(),
      decidedCode: null,
      ...t,
    })
  }
  const lpnById = (id: string) => db.lpns.find((l) => l.id === id) ?? fail('ไม่พบป้าย')
  const itemById = (id: string) => {
    for (const l of db.lpns) {
      const it = l.items.find((i) => i.id === id)
      if (it) return { lpn: l, item: it }
    }
    return fail('ไม่พบรายการในกล่อง')
  }
  const commit = <T>(fn: () => T): Promise<T> => {
    const before = JSON.stringify(db)
    try {
      const out = fn()
      save()
      return Promise.resolve(clone(out))
    } catch (e) {
      db = JSON.parse(before)
      return Promise.reject(e)
    }
  }
  const lpnOf = (lpn: Lpn): Lpn => {
    const grn = db.grns.find((g) => g.id === lpn.grnId)
    return { ...clone(lpn), grnNo: grn?.grnNo ?? null, modelCode: grn?.modelCode ?? null, invoiceNo: grn?.invoiceNo ?? null, plRef: grn?.plRef ?? null }
  }

  // ===== ช่องแนะนำตามกฎโซนตอนนี้ (เหมือน suggest_slots ใน 0020): หลายกล่องได้ช่องว่างไม่ซ้ำกัน =====
  const suggestFor = (ids: string[]) => {
    const busy = new Set(db.lpns.filter((l) => l.status === 'active').map((l) => l.locationCode))
    const taken = new Set<string>()
    const out: { lpnId: string; code: string | null }[] = []
    for (const id of ids) {
      const lpn = db.lpns.find((l) => l.id === id)
      if (!lpn) continue
      const grn = db.grns.find((g) => g.id === lpn.grnId)
      const customer = grn?.customerId ?? db.master.models.find((m) => m.code === grn?.modelCode)?.customerId ?? null
      const item = [...lpn.items].filter((i) => i.qty > 0).sort((a, b) => b.qty - a.qty || a.partNo.localeCompare(b.partNo))[0]
      const type = db.master.parts.find((p) => p.partNo === item?.partNo)?.type ?? null
      const zones = db.master.rules
        .filter((r) => r.customerId === customer && (r.partType === type || r.partType === null))
        .sort((a, b) => Number(a.partType === null) - Number(b.partType === null))
        .map((r) => r.zoneId)
      const free = (zoneId: string) =>
        db.master.locations
          .filter((l) => l.zoneId === zoneId && l.active && !l.blocked && (l.kind === 'bin' || l.kind === 'floor') && !busy.has(l.code) && !taken.has(l.code))
          .sort((a, b) => a.code.localeCompare(b.code))[0]?.code ?? null
      const code = zones.map(free).find((c) => c !== null) ?? null
      if (code) taken.add(code)
      out.push({ lpnId: id, code })
    }
    return out
  }

  // ===== ใบตรวจรับ =====
  const checkOf = ({ lines, ...c }: DemoCheck): ReceiptCheck => ({
    ...c,
    grnNo: db.grns.find((g) => g.id === c.grnId)?.grnNo ?? null,
    lineCount: lines.length,
    checkedCount: lines.filter((l) => l.actualQty !== null).length,
  })
  const openCheck = (id: string) => {
    const c = db.checks.find((x) => x.id === id)
    if (!c || c.status !== 'open') return fail('ไม่พบใบตรวจรับที่ยังเปิดอยู่')
    return c
  }
  const wholeQty = (n: number) => Number.isInteger(n) && n >= 0
  // บรรทัด Invoice ไม่ซ้ำ เลขไม่ชนกัน (เหมือน check_inv_lines ใน 0022)
  const invLines = (lines: { lineNo?: number | null; partNo: string; description?: string | null; qty: number }[]) =>
    tidyInvoiceLines(lines, (c) => canonPartNo(db.master.parts, c))
  const partName = (partNo: string) => db.master.parts.find((p) => p.partNo === canonPartNo(db.master.parts, partNo))?.name ?? null

  // ===== ใบเบิก: กติกาเดียวกับ wms_issue_fifo (0021) / wms_return_lifo (0014) =====
  const inNgArea = (l: Lpn) => db.master.locations.find((x) => x.code === l.locationCode)?.kind === 'ng'
  const onHand = (part: string) =>
    db.lpns.filter((l) => l.status === 'active').reduce((s, l) => s + l.items.filter((i) => i.partNo === part).reduce((t, i) => t + i.qty, 0), 0)
  const issueFifo = (reqId: string, doc: string, ref: string, part: string, qty: number) => {
    if (!(qty > 0)) return
    // ใบเบิก NG ตัดจากพื้นที่กัก NG ก่อน · ใบอื่น (เข้าไลน์ / QC / FM-P-005) ไม่แตะของในพื้นที่ NG
    const ng = db.requisitions.find((r) => r.id === reqId)?.kind === 'ng'
    const boxes = db.lpns
      .filter((l) => l.status === 'active' && !l.hold && (ng || !inNgArea(l)) && l.items.some((i) => i.partNo === part && i.qty > 0))
      .sort((a, b) => Number(!inNgArea(a)) - Number(!inNgArea(b)) || a.createdAt.localeCompare(b.createdAt) || a.lpnNo.localeCompare(b.lpnNo))
    const have = boxes.reduce((s, l) => s + l.items.filter((i) => i.partNo === part).reduce((t, i) => t + i.qty, 0), 0)
    if (have < qty) fail(`สต็อก ${part} ไม่พอ · พร้อมเบิก ${have} ขอเบิก ${qty}`)
    let left = qty
    for (const l of boxes)
      for (const item of l.items.filter((i) => i.partNo === part && i.qty > 0)) {
        if (left <= 0) break
        const take = Math.min(left, item.qty)
        item.qty -= take
        left -= take
        log({ kind: 'ISSUE', docNo: doc, lpnId: l.id, lpnNo: l.lpnNo, lpnItemId: item.id, partNo: part, qty: take, fromLoc: l.locationCode, ref, requisitionId: reqId })
        if (!l.items.some((i) => i.qty > 0)) l.status = 'empty'
      }
  }
  // คืนเข้ากล่องที่รายการอยู่ตอนนี้ (อาจถูกรวมกล่องหลังเบิก) และเปิดสถานะกล่องนั้น (เหมือน 0022)
  const putBack = (t: Tx, qty: number, doc: string, ref: string | null, reqId: string, reason: string | null = null) => {
    const { lpn: l, item } = itemById(t.lpnItemId ?? '')
    item.qty += qty
    if (l.status === 'empty') l.status = 'active'
    log({ kind: 'RETURN', docNo: doc, lpnId: l.id, lpnNo: l.lpnNo, lpnItemId: item.id, partNo: t.partNo, qty, toLoc: l.locationCode, ref, reason, requisitionId: reqId })
  }
  const returnLifo = (reqId: string, from: string[], doc: string, ref: string, part: string, qty: number) => {
    let left = qty
    // db.tx เรียงใหม่ → เก่า อยู่แล้ว
    for (const t of db.tx.filter((x) => x.kind === 'ISSUE' && from.includes(x.requisitionId ?? '') && x.partNo === part)) {
      if (left <= 0) break
      const take = Math.min(left, t.qty ?? 0)
      putBack(t, take, doc, ref, reqId)
      left -= take
    }
    if (left > 0) fail(`คืน ${part} ได้ไม่ครบ (เกินยอดที่เบิกไว้ ${left})`)
  }
  const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

  // ===== รับของ: เหมือน create_grn (0020) · caseNo เดียวกัน = กล่องเดียวกัน (part ที่ต้องตรวจ MI3 แยกกล่องตาม part) =====
  const receive = (input: ReceivePayload, checkId: string | null = null) => {
    // รหัสหลัก (เลขฐาน) เหมือน trigger part_canon ฝั่งฐานข้อมูล
    const canon = (c: string) => canonPartNo(db.master.parts, c)
    const p: ReceivePayload = {
      ...input,
      lines: input.lines.map((l) => ({ ...l, partNo: canon(l.partNo) })),
      invoice: input.invoice && { ...input.invoice, lines: input.invoice.lines.map((l) => ({ ...l, partNo: canon(l.partNo) })) },
    }
    if (!p.lines.length) fail('ไม่มีรายการรับเข้า')
    if (!p.packingList.refDoc.trim()) fail('ต้องมีเลขอ้างอิงของ Packing List')
    const model = db.master.models.find((m) => m.code === p.modelCode)
    const customer = model?.customerId ?? p.invoice?.customerId ?? null
    let invoice = p.invoice?.invoiceNo ? db.invoices.find((i) => i.invoiceNo === p.invoice!.invoiceNo) : undefined
    if (p.invoice?.invoiceNo && !invoice) {
      invoice = {
        id: uid(),
        invoiceNo: p.invoice.invoiceNo,
        customerId: customer,
        poNo: p.invoice.poNo || null,
        docDate: p.invoice.docDate || null,
        movementType: p.invoice.movementType || null,
        status: 'open',
        statusNote: null,
        statusAt: null,
        imagePaths: p.invoice.imagePaths ?? [],
        createdAt: nowIso(),
        lines: invLines(p.invoice.lines),
      }
      db.invoices.unshift(invoice)
    }
    const grn: Grn = {
      id: uid(),
      grnNo: nextDoc('GRN'),
      invoiceId: invoice?.id ?? null,
      invoiceNo: invoice?.invoiceNo ?? null,
      plRef: p.packingList.refDoc,
      soNo: p.packingList.soNo || null,
      packages: p.packingList.packages || null,
      modelCode: p.modelCode || null,
      customerId: customer,
      receivedAt: nowIso(),
      receiverCode: ME,
      note: p.note || null,
      replacement: !!p.replacement,
      status: 'active',
      checkId,
    }
    db.grns.unshift(grn)
    const used = new Set(db.lpns.filter((l) => l.status === 'active').map((l) => l.locationCode))
    // พื้นที่กัก NG: ของเสียหายแยกเป็นกล่องของตัวเอง (เหมือน create_grn 0021) · ไม่มี ⇒ อยู่กล่องเดียวกับของดี
    const ngLoc = db.master.locations.filter((l) => l.kind === 'ng' && l.active && !l.blocked).map((l) => l.code).sort()[0] ?? null
    p.lines.forEach((line, i) => {
      const damaged = line.damagedQty ?? 0
      if (damaged < 0 || !Number.isInteger(damaged) || damaged > line.countedQty) fail(`จำนวนเสียหายของรายการที่ ${i + 1} ต้องเป็นจำนวนเต็ม 0 ถึง ${line.countedQty}`)
      const good = ngLoc ? line.countedQty - damaged : line.countedQty
      const part = db.master.parts.find((x) => x.partNo === line.partNo)
      const type = part?.type ?? null
      const needs = !!type && (model?.requiresInspection ?? true) && db.settings.qiPartTypes.includes(type)
      const rule = db.master.rules.find((r) => r.customerId === customer && r.partType === type) ?? db.master.rules.find((r) => r.customerId === customer && r.partType === null)
      const zoneId = line.zoneId || rule?.zoneId
      const home =
        db.master.locations.find((l) => l.zoneId === zoneId && l.active && (l.kind === 'bin' || l.kind === 'floor') && !used.has(l.code))?.code ??
        (line.zoneId ? zoneCodeOf(db.master.locations.find((l) => l.zoneId === line.zoneId)?.code ?? line.zoneId) : 'RCV-01')
      used.add(home)
      const caseNo = (line.caseNo ?? '').trim().toUpperCase() || null
      const gl: GrnLine = {
        id: uid(),
        grnId: grn.id,
        lineNo: i + 1,
        partNo: line.partNo,
        description: line.description,
        partType: type,
        plQty: line.plQty,
        countedQty: line.countedQty,
        invoiceQty: invoice?.lines.find((l) => l.partNo === line.partNo)?.qty ?? null,
        needsQi: needs,
        homeLocation: home,
        caseNo,
        damagedQty: damaged,
      }
      db.grnLines.push(gl)
      if (good > 0) {
        // กล่องของเคสนี้ที่จุดรับของ (ไม่ใช่กล่อง NG ของเคสเดียวกัน)
        const same = caseNo && !needs ? db.lpns.find((l) => l.grnId === grn.id && l.caseNo === caseNo && !l.hold && l.status === 'active' && l.locationCode === 'RCV-01') : undefined
        const lpn: Lpn = same ?? { id: uid(), lpnNo: nextDoc('LPN'), grnId: grn.id, locationCode: needs ? 'MI3-QC' : 'RCV-01', hold: needs, status: 'active', createdAt: nowIso(), items: [], caseNo }
        lpn.items.push({ id: uid(), lpnId: lpn.id, grnLineId: gl.id, partNo: line.partNo, qty: good })
        if (!same) db.lpns.push(lpn)
        log({ kind: 'RECEIVE', docNo: grn.grnNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, partNo: line.partNo, qty: good, toLoc: lpn.locationCode, ref: grn.plRef })
      }
      // ของเสียหาย: กล่อง NG แยก 1 กล่องต่อรายการ → คิว "NG รอส่งคืน"
      if (ngLoc && damaged > 0) {
        const box: Lpn = { id: uid(), lpnNo: nextDoc('LPN'), grnId: grn.id, locationCode: ngLoc, hold: false, status: 'active', createdAt: nowIso(), items: [], caseNo }
        box.items.push({ id: uid(), lpnId: box.id, grnLineId: gl.id, partNo: line.partNo, qty: damaged })
        db.lpns.push(box)
        log({ kind: 'RECEIVE', docNo: grn.grnNo, lpnId: box.id, lpnNo: box.lpnNo, partNo: line.partNo, qty: damaged, toLoc: ngLoc, ref: grn.plRef, reason: 'เสียหายจากการตรวจรับ → NG' })
      }
    })
    return { grnId: grn.id, grnNo: grn.grnNo }
  }

  const api: WmsApi = {
    kind: 'demo',
    myPermissions: async () => ['*'],
    settings: async () => clone(db.settings),
    master: async () => clone(db.master),

    async findInvoiceNo(no) {
      const inv = db.invoices.find((i) => i.invoiceNo === no.trim())
      return inv ? { id: inv.id, grnCount: db.grns.filter((g) => g.invoiceId === inv.id && g.status !== 'void').length } : null
    },

    createGrn: (input: ReceivePayload) => commit(() => receive(input)),

    uploadDoc: async () => null,
    docUrl: async () => null,
    attachImages: async () => undefined,
    listGrns: async (limit = 30) => clone(db.grns.slice(0, limit)),


    async grnDetail(grnId) {
      const grn = db.grns.find((g) => g.id === grnId)
      if (!grn) return null
      return clone({
        grn,
        lines: db.grnLines.filter((l) => l.grnId === grnId).sort((a, b) => a.lineNo - b.lineNo),
        lpns: db.lpns.filter((l) => l.grnId === grnId && l.status !== 'merged' && l.status !== 'void').sort((a, b) => a.lpnNo.localeCompare(b.lpnNo)),
      })
    },

    findGrnId: async (grnNo) => db.grns.find((g) => g.grnNo === grnNo.trim().toUpperCase())?.id ?? null,

    // เหมือน grn_void (0020)
    voidGrn: (grnId, reason) =>
      commit(() => {
        if (!reason.trim()) fail('ใส่เหตุผลที่ยกเลิก')
        const g = db.grns.find((x) => x.id === grnId) ?? fail('ไม่พบใบรับสินค้า')
        if (g.status === 'void') fail('ใบรับนี้ยกเลิกไปแล้ว')
        assertOpen(g.modelCode, bangkokDay(g.receivedAt))
        const mine = new Set(db.grnLines.filter((l) => l.grnId === grnId).map((l) => l.id))
        const boxes = db.lpns.filter((l) => l.grnId === grnId || l.items.some((i) => mine.has(i.grnLineId)))
        const ids = new Set(boxes.map((b) => b.id))
        const used = new Set<string>()
        for (const t of db.tx)
          if (t.lpnId && ids.has(t.lpnId) && ['ISSUE', 'RETURN', 'QI', 'ADJ'].includes(t.kind) && t.status !== 'rejected')
            used.add(t.kind === 'QI' ? 'ตรวจ MI3' : t.kind === 'ADJ' ? 'แก้ยอด' : 'เบิก')
        if (boxes.some((b) => b.items.some((i) => !mine.has(i.grnLineId)))) used.add('รวมอยู่กับของใบอื่น')
        if (used.size) fail(`ยกเลิกใบรับไม่ได้ · ของจากใบนี้มีรายการต่อแล้ว: ${[...used].join(', ')}`)
        let n = 0
        for (const b of boxes)
          if (b.status === 'active') {
            b.status = 'void'
            n++
          }
        Object.assign(g, { status: 'void', voidReason: reason.trim(), voidedCode: ME, voidedAt: nowIso() })
        for (const j of db.printJobs) if (j.grnId === grnId && j.status === 'queued') Object.assign(j, { status: 'cancelled', doneCode: ME, doneAt: nowIso() })
        const c = db.checks.find((x) => x.grnId === grnId)
        if (c) Object.assign(c, { status: 'open', grnId: null, doneCode: null, doneAt: null, note: [c.note, `ยกเลิก ${g.grnNo}: ${reason.trim()}`].filter(Boolean).join(' · ') })
        return { grnNo: g.grnNo, boxes: n, checkId: c?.id ?? null }
      }),

    // ===== ใบตรวจรับ (กติกาเดียวกับ check_* ใน 0020) =====
    createCheck: (p: CheckPayload) =>
      commit(() => {
        const model = db.master.models.find((m) => m.code === p.modelCode)
        if (!model) fail('เลือก Model')
        if (!p.packingList.refDoc.trim()) fail('ต้องมีเลขอ้างอิงของ Packing List')
        if (!p.lines.length) fail('ไม่มีรายการให้ตรวจ')
        const id = uid()
        const lines: CheckLine[] = p.lines.map((l, i) => {
          if (!l.partNo.trim()) fail(`รายการที่ ${i + 1} ยังไม่มี Part No.`)
          const partNo = canonPartNo(db.master.parts, l.partNo)
          return {
            id: uid(),
            checkId: id,
            lineNo: i + 1,
            caseNo: (l.caseNo ?? '').trim().toUpperCase(),
            partNo,
            description: l.description?.trim() || partName(partNo),
            plQty: Math.max(0, l.plQty || 0),
            invLine: l.invLine ?? null,
            zoneId: l.zoneId ?? null,
            extra: false,
            actualQty: null,
            damagedQty: 0,
            note: null,
            photos: [],
            checkedCode: null,
            checkedAt: null,
            version: 0,
          }
        })
        const checkNo = nextDoc('CHK')
        db.checks.unshift({
          id,
          checkNo,
          status: 'open',
          modelCode: model!.code,
          customerId: model!.customerId,
          replacement: !!p.replacement,
          plRef: p.packingList.refDoc.trim(),
          soNo: p.packingList.soNo?.trim() || null,
          packages: p.packingList.packages?.trim() || null,
          title: p.packingList.title?.trim() || null,
          invoiceNo: p.invoice?.invoiceNo.trim() || null,
          poNo: p.invoice?.poNo?.trim() || null,
          docDate: p.invoice?.docDate || null,
          movementType: p.invoice?.movementType?.trim() || null,
          invoiceLines: invLines(p.invoice?.lines ?? []),
          plImages: p.packingList.imagePaths ?? [],
          invImages: p.invoice?.imagePaths ?? [],
          note: p.note?.trim() || null,
          grnId: null,
          createdCode: ME,
          createdAt: nowIso(),
          doneCode: null,
          doneAt: null,
          cancelReason: null,
          cancelledCode: null,
          cancelledAt: null,
          lines,
        })
        return { id, checkNo }
      }),
    listChecks: async () => {
      const all = db.checks.map(checkOf)
      return clone([...all.filter((c) => c.status === 'open'), ...all.filter((c) => c.status !== 'open')].slice(0, 80))
    },
    checkDetail: async (id) => {
      const c = db.checks.find((x) => x.id === id)
      return c ? clone({ check: checkOf(c), lines: [...c.lines].sort((a, b) => a.lineNo - b.lineNo) }) : null
    },
    saveCheckLine: (lineId, version, patch) =>
      commit(() => {
        const c = db.checks.find((x) => x.lines.some((l) => l.id === lineId)) ?? fail('ไม่พบรายการตรวจรับ')
        if (c.status !== 'open') fail('ใบตรวจรับนี้ปิดแล้ว')
        const l = c.lines.find((x) => x.id === lineId)!
        if (l.version !== version) fail('รายการนี้มีคนบันทึกไปก่อนแล้ว · โหลดใหม่แล้วตรวจอีกครั้ง')
        const actual = patch.actual !== undefined ? patch.actual : l.actualQty
        let damaged = patch.damaged !== undefined ? patch.damaged : l.damagedQty
        const pl = patch.plQty !== undefined ? patch.plQty : l.plQty
        if (actual !== null && !wholeQty(actual)) fail('จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ')
        if (!wholeQty(damaged)) fail('จำนวนเสียหายต้องเป็นจำนวนเต็มไม่ติดลบ')
        if (!wholeQty(pl)) fail('จำนวนใน Packing List ต้องเป็นจำนวนเต็มไม่ติดลบ')
        if (actual === null) damaged = 0
        if (damaged > (actual ?? 0)) fail('จำนวนเสียหายมากกว่าที่นับได้')
        if (patch.partNo !== undefined && !patch.partNo.trim()) fail('ใส่ Part No.')
        const counted = patch.actual !== undefined
        Object.assign(l, {
          actualQty: actual,
          damagedQty: damaged,
          plQty: pl,
          zoneId: patch.zoneId !== undefined ? patch.zoneId : l.zoneId,
          note: patch.note !== undefined ? patch.note.trim() || null : l.note,
          photos: patch.photos ?? l.photos,
          partNo: patch.partNo !== undefined ? canonPartNo(db.master.parts, patch.partNo) : l.partNo,
          description: patch.description !== undefined ? patch.description.trim() || null : patch.partNo !== undefined ? (partName(patch.partNo) ?? l.description) : l.description,
          caseNo: patch.caseNo !== undefined ? patch.caseNo.trim().toUpperCase() : l.caseNo,
          checkedCode: counted ? (actual === null ? null : ME) : l.checkedCode,
          checkedAt: counted ? (actual === null ? null : nowIso()) : l.checkedAt,
          version: l.version + 1,
        })
        return l
      }),
    saveCheckCase: (checkId, caseNo, mode) =>
      commit(() => {
        if (mode !== 'ok' && mode !== 'missing') fail('คำสั่งไม่ถูกต้อง')
        const c = openCheck(checkId)
        const want = caseNo.trim().toUpperCase()
        let n = 0
        for (const l of c.lines.filter((x) => x.caseNo === want && x.actualQty === null && !x.extra)) {
          Object.assign(l, {
            actualQty: mode === 'ok' ? l.plQty : 0,
            damagedQty: 0,
            note: mode === 'missing' ? (l.note ?? 'ไม่มีเคสนี้มากับรถ') : l.note,
            checkedCode: ME,
            checkedAt: nowIso(),
            version: l.version + 1,
          })
          n++
        }
        return n
      }),
    addCheckLine: (checkId, line) =>
      commit(() => {
        const c = openCheck(checkId)
        if (!line.partNo.trim()) fail('ใส่ Part No.')
        const actual = line.actual ?? null
        if (actual !== null && !wholeQty(actual)) fail('จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ')
        const pl = Math.max(0, line.plQty ?? 0)
        if (!Number.isInteger(pl)) fail('จำนวนใน Packing List ต้องเป็นจำนวนเต็มไม่ติดลบ')
        const partNo = canonPartNo(db.master.parts, line.partNo)
        const l: CheckLine = {
          id: uid(),
          checkId,
          lineNo: c.lines.reduce((m, x) => Math.max(m, x.lineNo), 0) + 1,
          caseNo: line.caseNo.trim().toUpperCase(),
          partNo,
          description: line.description?.trim() || partName(partNo),
          plQty: pl,
          invLine: null,
          zoneId: null,
          extra: pl === 0,
          actualQty: actual,
          damagedQty: 0,
          note: line.note?.trim() || null,
          photos: [],
          checkedCode: actual === null ? null : ME,
          checkedAt: actual === null ? null : nowIso(),
          version: 0,
        }
        c.lines.push(l)
        return l
      }),
    saveCheckHeader: (checkId, patch) =>
      commit(() => {
        const c = openCheck(checkId)
        if (patch.invoiceNo !== undefined) c.invoiceNo = patch.invoiceNo.trim() || null
        if (patch.poNo !== undefined) c.poNo = patch.poNo.trim() || null
        if (patch.docDate !== undefined) c.docDate = patch.docDate || null
        if (patch.movementType !== undefined) c.movementType = patch.movementType.trim() || null
        if (patch.invoiceLines !== undefined) c.invoiceLines = invLines(patch.invoiceLines)
        if (patch.note !== undefined) c.note = patch.note.trim() || null
        if (patch.replacement !== undefined) c.replacement = patch.replacement
        if (patch.plImages) c.plImages = patch.plImages
        if (patch.invImages) c.invImages = patch.invImages
      }),
    cancelCheck: (checkId, reason) =>
      commit(() => {
        if (!reason.trim()) fail('ใส่เหตุผลที่ยกเลิก')
        const c = openCheck(checkId)
        Object.assign(c, { status: 'cancelled', cancelReason: reason.trim(), cancelledCode: ME, cancelledAt: nowIso() })
      }),
    completeCheck: (checkId) =>
      commit(() => {
        const c = db.checks.find((x) => x.id === checkId) ?? fail('ไม่พบใบตรวจรับ')
        if (c.status !== 'open') fail('ใบตรวจรับนี้ปิดแล้ว')
        const left = c.lines.filter((l) => l.actualQty === null).length
        if (left) fail(`ยังตรวจไม่ครบ ${left} รายการ`)
        if (!c.lines.some((l) => (l.actualQty ?? 0) > 0)) fail('ไม่มีของที่นับได้เลย · ถ้าของไม่มาทั้งเที่ยวให้ยกเลิกใบตรวจรับ')
        // Invoice ที่มีอยู่แล้วแต่ยังไม่มีรายการ: เติมจากใบตรวจรับ
        const inv = c.invoiceNo ? db.invoices.find((i) => i.invoiceNo === c.invoiceNo) : undefined
        if (inv && !inv.lines.length && c.invoiceLines.length) inv.lines = clone(c.invoiceLines).map((l) => ({ ...l, description: l.description ?? '' }))
        const res = receive(
          {
            modelCode: c.modelCode ?? '',
            replacement: c.replacement,
            note: c.note ?? undefined,
            packingList: { refDoc: c.plRef, soNo: c.soNo ?? undefined, packages: c.packages ?? undefined },
            invoice: c.invoiceNo
              ? { invoiceNo: c.invoiceNo, customerId: c.customerId ?? undefined, poNo: c.poNo ?? undefined, docDate: c.docDate ?? undefined, movementType: c.movementType ?? undefined, lines: c.invoiceLines.map((l) => ({ ...l, description: l.description ?? '' })) }
              : undefined,
            lines: [...c.lines]
              .sort((a, b) => a.lineNo - b.lineNo)
              .map((l) => ({ caseNo: l.caseNo, partNo: l.partNo, description: l.description ?? '', plQty: l.plQty, countedQty: l.actualQty ?? 0, damagedQty: l.damagedQty, ...(l.zoneId ? { zoneId: l.zoneId } : {}) })),
          },
          c.id,
        )
        Object.assign(c, { status: 'done', grnId: res.grnId, doneCode: ME, doneAt: nowIso() })
        return res
      }),

    mergeLpns: (ids, location) =>
      commit(() => {
        if (ids.length < 2) fail('เลือกอย่างน้อย 2 ป้ายเพื่อรวม')
        const src = ids.map(lpnById)
        if (src.some((l) => l.status !== 'active')) fail('มีป้ายที่ถูกรวมหรือใช้หมดไปแล้ว')
        // เหมือน merge_lpns (0022): ของเสียหายในพื้นที่ NG รวมกับของดีไม่ได้ · กล่องรวมอยู่พื้นที่ชนิดเดียวกับกล่องต้นทาง
        const ng = src.filter((l) => inNgArea(l)).length
        if (ng && ng < src.length) fail('รวมกล่อง NG (ของเสียหาย) กับกล่องของดีไม่ได้ · พิมพ์ป้ายแยกกัน ของ NG ต้องอยู่พื้นที่กัก NG')
        const to = location?.trim().toUpperCase() || src[0].locationCode
        if ((ng > 0) !== (db.master.locations.find((x) => x.code === to)?.kind === 'ng'))
          fail(ng ? 'กล่อง NG รวมแล้วต้องอยู่พื้นที่กัก NG · เลือกช่อง NG' : 'รวมกล่องของดีไปไว้พื้นที่กัก NG ไม่ได้')
        // กล่องรวมใช้วันรับเข้าเก่าสุดของกล่องต้นทาง · เคสเดียวกันทุกกล่อง ⇒ คงเลขเคส (เหมือน merge_lpns 0023)
        const cases = new Set(src.map((l) => l.caseNo ?? null))
        const lpn: Lpn = {
          id: uid(),
          lpnNo: nextDoc('LPN'),
          grnId: src[0].grnId,
          locationCode: to,
          hold: src.some((l) => l.hold),
          status: 'active',
          createdAt: src.map((l) => l.createdAt).sort()[0],
          caseNo: cases.size === 1 ? [...cases][0] : null,
          items: src.flatMap((l) => l.items),
        }
        lpn.items.forEach((i) => {
          i.prevLpnId = i.lpnId
          i.lpnId = lpn.id
        })
        src.forEach((l) => {
          l.status = 'merged'
          l.items = []
        })
        db.lpns.push(lpn)
        log({ kind: 'MERGE', docNo: lpn.lpnNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, toLoc: lpn.locationCode, ref: src.map((l) => l.lpnNo).join(', ') })
        return { lpnId: lpn.id, lpnNo: lpn.lpnNo }
      }),

    unmergeLpn: (lpnId) =>
      commit(() => {
        const box = lpnById(lpnId)
        if (box.status !== 'active') fail('ป้ายนี้ใช้งานไม่ได้แล้ว (อาจถูกรวมต่อ ใช้หมด หรือยกเลิกไปแล้ว)')
        const src = db.lpns.filter((l) => l.status === 'merged' && box.items.some((i) => i.prevLpnId === l.id))
        if (!src.length) fail('กล่องนี้ไม่ได้เกิดจากการรวม · ถ้าจะแบ่งของใช้ "แยกกล่อง"')
        if (db.tx.some((t) => t.kind !== 'MERGE' && (t.lpnId === lpnId || box.items.some((i) => i.id === t.lpnItemId))))
          fail('กล่องนี้มีการเคลื่อนไหวหลังรวมแล้ว (ย้าย/เบิก/แก้ยอด/ตรวจ/แยก) ยกเลิกการรวมไม่ได้ · ใช้ "แยกกล่อง" แทน')
        if (box.items.some((i) => !src.some((l) => l.id === i.prevLpnId))) fail('ไม่พบข้อมูลป้ายเดิมของบางรายการ · ใช้ "แยกกล่อง" แทน')
        for (const l of src) {
          l.items = box.items.filter((i) => i.prevLpnId === l.id)
          l.items.forEach((i) => {
            i.lpnId = l.id
            i.prevLpnId = null
          })
          l.status = 'active'
        }
        box.items = []
        box.status = 'void'
        const lpnNos = src.map((l) => l.lpnNo).sort().join(', ')
        log({ kind: 'UNMERGE', docNo: box.lpnNo, lpnId, lpnNo: box.lpnNo, fromLoc: box.locationCode, ref: lpnNos })
        return { lpnNos }
      }),

    splitLpn: (lpnId, picks) =>
      commit(() => {
        const box = lpnById(lpnId)
        if (box.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้งานไม่ได้แล้ว')
        // กล่องใหม่ใช้วันรับเข้าและเลขเคสของกล่องเดิม (เหมือน split_lpn 0023 · FIFO ไม่เพี้ยน)
        const lpn: Lpn = { id: uid(), lpnNo: nextDoc('LPN'), grnId: box.grnId, locationCode: box.locationCode, hold: box.hold, status: 'active', createdAt: box.createdAt, caseNo: box.caseNo ?? null, items: [] }
        for (const p of picks) {
          if (!(p.qty > 0)) continue
          const item = box.items.find((i) => i.id === p.itemId) ?? fail('รายการที่เลือกไม่ได้อยู่ในกล่องนี้')
          if (!Number.isInteger(p.qty)) fail('จำนวนต้องเป็นจำนวนเต็ม')
          if (p.qty > item.qty) fail(`${item.partNo} มีในกล่องแค่ ${item.qty} ชิ้น`)
          if (p.qty === item.qty) {
            box.items = box.items.filter((i) => i !== item)
            lpn.items.push({ ...item, lpnId: lpn.id, prevLpnId: null })
          } else {
            item.qty -= p.qty
            lpn.items.push({ id: uid(), lpnId: lpn.id, grnLineId: item.grnLineId, partNo: item.partNo, qty: p.qty })
          }
        }
        if (!lpn.items.length) fail('ใส่จำนวนที่จะแยกออกอย่างน้อย 1 รายการ')
        if (!box.items.some((i) => i.qty > 0)) fail('ต้องเหลือของในกล่องเดิมอย่างน้อย 1 รายการ · ถ้าจะย้ายทั้งกล่องใช้ "ย้ายที่" ในแท็บสแกน')
        if (box.hold) {
          const held = (l: Lpn) => l.items.some((i) => i.qty > 0 && db.grnLines.find((g) => g.id === i.grnLineId)?.needsQi)
          box.hold = held(box)
          lpn.hold = held(lpn)
        }
        db.lpns.push(lpn)
        log({ kind: 'SPLIT', docNo: lpn.lpnNo, lpnId, lpnNo: box.lpnNo, fromLoc: box.locationCode, toLoc: box.locationCode, ref: lpn.items.map((i) => `${i.partNo} ${i.qty}`).join(', ') })
        return { lpnId: lpn.id, lpnNo: lpn.lpnNo }
      }),

    async findLpn(no) {
      const lpn = db.lpns.find((l) => l.lpnNo === no.trim().toUpperCase())
      if (!lpn) return null
      const grn = db.grns.find((g) => g.id === lpn.grnId) ?? null
      const stored = db.grnLines.find((g) => g.id === lpn.items[0]?.grnLineId)?.homeLocation ?? null
      const now = lpn.status === 'active' ? suggestFor([lpn.id])[0]?.code : null
      return clone({ lpn: lpnOf(lpn), grn, homeLocation: now ?? stored })
    },

    scanMove: (lpnId, to, kind) =>
      commit(() => {
        const lpn = lpnById(lpnId)
        const dest = to.trim().toUpperCase()
        if (lpn.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว')
        if (!dest) fail('เลือกช่องปลายทาง')
        if (dest === lpn.locationCode) fail('กล่องอยู่ที่ช่องนี้แล้ว')
        log({ kind, lpnId, lpnNo: lpn.lpnNo, fromLoc: lpn.locationCode, toLoc: dest, via: 'scan' })
        lpn.locationCode = dest
      }),

    // เหมือน move_lpns (0020): ปลายทางต้องเป็นช่องที่มีและเปิดใช้ · จากจุดรับของ/จุดพัก = PUT
    moveLpns: (lpnIds, to) =>
      commit(() => {
        const ids = [...new Set(lpnIds)]
        if (!ids.length) fail('เลือกกล่องที่จะย้าย')
        if (ids.length > 200) fail('ย้ายได้ครั้งละไม่เกิน 200 กล่อง')
        const dest = to.trim().toUpperCase()
        const loc = db.master.locations.find((l) => l.code === dest)
        if (!loc || !loc.active || loc.blocked) fail(`ไม่พบช่อง ${dest} หรือช่องนี้ปิดใช้อยู่`)
        const boxes = ids.map((id) => db.lpns.find((l) => l.id === id) ?? fail('ไม่พบบางกล่อง · โหลดรายการใหม่')).sort((a, b) => a.lpnNo.localeCompare(b.lpnNo))
        let moved = 0
        for (const lpn of boxes) {
          if (lpn.status !== 'active') fail(`ป้าย ${lpn.lpnNo} ใช้งานไม่ได้แล้ว · โหลดรายการใหม่`)
          if (lpn.locationCode === dest) continue
          const from = db.master.locations.find((l) => l.code === lpn.locationCode)?.kind
          log({ kind: from === 'staging' || from === 'hold' ? 'PUT' : 'MOVE', lpnId: lpn.id, lpnNo: lpn.lpnNo, fromLoc: lpn.locationCode, toLoc: dest, via: 'list' })
          lpn.locationCode = dest
          moved++
        }
        return { moved, same: boxes.length - moved }
      }),
    suggestSlots: async (lpnIds) => clone(suggestFor(lpnIds)),

    // เหมือน scan_issue_req (0018): ใบเบิกจากกล่องที่สแกน · เลขใบเบิกเดียวกันวันเดียวกัน ⇒ ใบเดิม
    scanIssue: (p) =>
      commit(() => {
        if (!['line', 'qc', 'ng'].includes(p.kind)) fail('เลือกว่าเบิกไปไหน (เข้าไลน์ / QC เบิก / NG)')
        const model = p.modelCode?.trim().toUpperCase() || null
        if (p.kind === 'line' && !model) fail('เลือก Model ที่เบิกเข้าไลน์')
        if (model && !db.master.models.some((m) => m.code === model)) fail(`ไม่รู้จัก Model ${model}`)
        const { lpn, item } = itemById(p.itemId)
        if (lpn.status !== 'active') fail('ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว')
        if (lpn.hold) fail('เบิกไม่ได้ · กล่องนี้ยังไม่ผ่านการตรวจ MI3')
        if (p.kind === 'line' && inNgArea(lpn)) fail('เบิกเข้าไลน์ไม่ได้ · กล่องนี้อยู่พื้นที่กัก NG (เบิกได้เฉพาะ NG / ส่งคืน หรือ QC)')
        if (!(p.qty > 0)) fail('ใส่จำนวนที่เบิก')
        if (p.qty > item.qty) fail(`เบิกได้ไม่เกิน ${item.qty} ชิ้น`)
        const day = today()
        if (model) {
          const models = [...(db.master.parts.find((x) => x.partNo === item.partNo)?.models ?? [])].sort()
          if (models.length && !models.includes(model)) fail(`${item.partNo} ไม่ได้อยู่ใน Model ${model} (อยู่ใน ${models.join(', ')})`)
          assertOpen(model, day)
        }
        const docNo = p.docNo?.trim() || null
        const toDept = p.toDept?.trim() || null
        let req = docNo
          ? db.requisitions.find((r) => r.kind === p.kind && r.docNo === docNo && r.docDate === day && r.modelCode === model && r.status === 'posted' && !r.reconciledBy)
          : undefined
        const appended = !!req
        if (!req) {
          req = {
            id: uid(),
            kind: p.kind,
            reqNo: nextDoc('RQ'),
            docNo,
            docDate: day,
            modelCode: model,
            fgCode: null,
            fgQty: null,
            fromDept: null,
            toDept,
            note: 'สแกนเบิกจากกล่อง',
            status: 'posted',
            reconciledBy: null,
            createdCode: ME,
            createdAt: nowIso(),
            lines: [],
          }
          db.requisitions.unshift(req)
        }
        item.qty -= p.qty
        log({ kind: 'ISSUE', docNo: req.reqNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: item.id, partNo: item.partNo, qty: p.qty, fromLoc: lpn.locationCode, toLoc: toDept ?? req.toDept, ref: req.docNo ?? req.reqNo, requisitionId: req.id })
        if (lpn.items.every((i) => i.qty <= 0)) lpn.status = 'empty'
        const line = req.lines.find((l) => l.partNo === item.partNo)
        if (line) {
          line.qty += p.qty
          line.reqQty = (line.reqQty ?? 0) + p.qty
          line.balance = onHand(item.partNo)
        } else req.lines.push({ partNo: item.partNo, reqQty: p.qty, qty: p.qty, balance: onHand(item.partNo) })
        return { id: req.id, reqNo: req.reqNo, docNo: req.docNo, appended }
      }),

    scanAdjustRequest: (itemId, newQty, reason) =>
      commit(() => {
        const { lpn, item } = itemById(itemId)
        if (!(newQty >= 0)) fail('ใส่ยอดที่ถูกต้อง')
        if (!reason.trim()) fail('ระบุเหตุผลก่อนส่ง')
        if (newQty === item.qty) fail('ยอดเท่าเดิม ไม่ต้องแก้ไข')
        if (db.tx.some((t) => t.lpnItemId === itemId && t.kind === 'ADJ' && t.status === 'pending')) fail('มีคำขอแก้ไขยอดของรายการนี้รออนุมัติอยู่แล้ว')
        const doc = nextDoc('ADJ')
        log({ kind: 'ADJ', docNo: doc, lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: itemId, partNo: item.partNo, qty: item.qty, newQty, reason, status: 'pending', createdCode: 'DEMO-REQ' })
        return doc
      }),

    scanAdjustDecide: (txId, approve) =>
      commit(() => {
        const t = db.tx.find((x) => x.id === txId)
        if (!t || t.status !== 'pending') fail('รายการนี้ถูกพิจารณาไปแล้ว')
        if (approve) {
          // เหมือน scan_adjust_decide (0022): ยอดเปลี่ยนหลังส่งคำขอ ⇒ ไม่ให้อนุมัติ ให้นับใหม่
          const { lpn, item } = itemById(t!.lpnItemId!)
          if (lpn.status !== 'active' && lpn.status !== 'empty') fail(`กล่อง ${lpn.lpnNo} ถูกยกเลิกแล้ว (ยกเลิกใบรับ) · กดไม่อนุมัติคำขอนี้`)
          if (item.qty !== t!.qty) fail(`ยอด ${t!.partNo} ในกล่อง ${lpn.lpnNo} เปลี่ยนหลังส่งคำขอ (ตอนขอ ${t!.qty} · ตอนนี้ ${item.qty}) · กดไม่อนุมัติแล้วให้นับใหม่`)
          item.qty = t!.newQty ?? item.qty
          lpn.status = lpn.items.some((i) => i.qty > 0) ? 'active' : 'empty'
        }
        t!.status = approve ? 'approved' : 'rejected'
        t!.decidedCode = ME
        // บัญชีคุมลงวันที่อนุมัติ (A7)
        t!.decidedAt = nowIso()
      }),

    scanCountItem: (itemId, counted) =>
      commit(() => {
        const { lpn, item } = itemById(itemId)
        if (!(counted >= 0)) fail('ใส่จำนวนที่นับได้')
        log({ kind: 'COUNT', lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: item.id, partNo: item.partNo, qty: item.qty, newQty: counted, fromLoc: lpn.locationCode })
        return counted - item.qty
      }),

    scanQi: (lpnId, pass, ng, note) =>
      commit(() => {
        const lpn = lpnById(lpnId)
        if (lpn.status !== 'active') fail('ไม่พบป้าย')
        if (!lpn.hold) fail('กล่องนี้ไม่ต้องตรวจ หรือผ่านการตรวจแล้ว')
        if (lpn.items.length !== 1) fail('บันทึกผลตรวจได้ทีละ part · แยกกล่องก่อน')
        const item = lpn.items[0]
        if (pass < 0 || ng < 0 || pass + ng !== item.qty) fail(`ผ่าน + NG ต้องเท่ากับ ${item.qty} ชิ้น`)
        const doc = nextDoc('QI')
        log({ kind: 'QI', docNo: doc, lpnId, lpnNo: lpn.lpnNo, lpnItemId: item.id, partNo: item.partNo, qty: item.qty, passQty: pass, ngQty: ng, reason: note || null })
        item.qty = pass
        lpn.hold = false
        lpn.status = pass > 0 ? 'active' : 'empty'
        return doc
      }),

    recentTx: async (limit = 30, lpnId) => clone(db.tx.filter((t) => !lpnId || t.lpnId === lpnId).slice(0, limit)),
    pendingAdjustments: async () =>
      clone(
        db.tx
          .filter((t) => t.kind === 'ADJ' && t.status === 'pending')
          .map((t) => ({ ...t, nowQty: db.lpns.flatMap((l) => l.items).find((i) => i.id === t.lpnItemId)?.qty ?? null })),
      ),
    activeLpns: async () => db.lpns.filter((l) => l.status === 'active').map(lpnOf),

    // เหมือน findDocs / traceTx ใน supabaseApi (ไม่สนตัวพิมพ์เล็ก/ใหญ่)
    async findDocs(query) {
      const up = query.trim().toUpperCase()
      if (!up) return { grns: [], checks: [], reqs: [], invoices: [] }
      const same = (v: string | null | undefined) => !!v && v.trim().toUpperCase() === up
      const invs = db.invoices.filter((i) => same(i.invoiceNo) || same(i.poNo))
      return clone({
        grns: db.grns.filter((g) => same(g.grnNo) || same(g.plRef) || invs.some((i) => i.id === g.invoiceId)).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
        checks: db.checks.filter((c) => same(c.checkNo) || same(c.plRef)).map(checkOf),
        reqs: db.requisitions.filter((r) => same(r.reqNo) || same(r.docNo)),
        invoices: invs.map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status })),
      })
    },

    async traceTx(by) {
      const lpnIds = new Set(by.lpnIds ?? [])
      const reqIds = new Set(by.reqIds ?? [])
      // db.tx เรียงใหม่ → เก่า: กลับด้านก่อน แล้วเรียงตามเวลา (เวลาเท่ากันคงลำดับที่บันทึก)
      const rows = db.tx
        .filter((t) => (t.lpnId && lpnIds.has(t.lpnId)) || (t.requisitionId && reqIds.has(t.requisitionId)))
        .reverse()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      return clone(
        rows.map((t): TraceTx => {
          const l = db.lpns.find((x) => x.id === t.lpnId)
          const g = l ? db.grns.find((x) => x.id === l.grnId) : undefined
          const r = t.requisitionId ? db.requisitions.find((x) => x.id === t.requisitionId) : undefined
          return {
            ...t,
            box: l ? { grnId: l.grnId, grnNo: g?.grnNo ?? null, plRef: g?.plRef ?? null, invoiceNo: g?.invoiceNo ?? null, caseNo: l.caseNo ?? null, modelCode: g?.modelCode ?? null } : null,
            req: r
              ? { id: r.id, reqNo: r.reqNo, docNo: r.docNo, kind: r.kind, modelCode: r.modelCode, docDate: r.docDate, toDept: r.toDept, reconciledBy: r.reconciledBy, status: r.status }
              : null,
          }
        }),
      )
    },

    async invoiceView(query) {
      const q = query.trim()
      const pl = db.grns.find((g) => g.plRef === q)
      const inv = db.invoices.find((i) => i.invoiceNo === q || i.poNo === q || (pl && i.id === pl.invoiceId))
      if (!inv) return null
      const grns = db.grns.filter((g) => g.invoiceId === inv.id && g.status !== 'void').sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      const received = new Map<string, number>()
      for (const l of db.grnLines) if (grns.some((g) => g.id === l.grnId)) received.set(l.partNo, (received.get(l.partNo) ?? 0) + l.countedQty)
      const { lines, ...invoice } = inv
      return clone({ invoice, lines, grns, received: [...received].map(([partNo, qty]) => ({ partNo, qty })) })
    },

    invoiceSetStatus: (id, status: InvoiceStatus, note) =>
      commit(() => {
        const inv = db.invoices.find((i) => i.id === id) ?? fail('ไม่พบ Invoice')
        inv.status = status
        inv.statusNote = note || null
        inv.statusAt = nowIso()
      }),

    listInvoices: async (limit = 30) => db.invoices.slice(0, limit).map((i) => ({ id: i.id, invoiceNo: i.invoiceNo, status: i.status, createdAt: i.createdAt })),

    permissionRows: async () => clone(db.perms),
    setPermission: (role, perm, allowed) =>
      commit(() => {
        const row = db.perms.find((p) => p.role === role && p.perm === perm)
        if (row) row.allowed = allowed
        else db.perms.push({ role, perm, allowed })
      }),
    staffDirectory: async () => clone(db.staff),
    setZoneHead: (zoneId, staffId) =>
      commit(() => {
        db.master.zoneHeads = db.master.zoneHeads.filter((h) => h.zoneId !== zoneId)
        const s = db.staff.find((x) => x.id === staffId)
        if (s) db.master.zoneHeads.push({ zoneId, staffId: s.id, employeeCode: s.employeeCode, fullName: s.fullName } satisfies ZoneHead)
      }),
    setSetting: (key, value) =>
      commit(() => {
        if (key === 'wms_mode') db.settings.mode = value === 'live' ? 'live' : 'trial'
        else db.settings.qiPartTypes = value as string[]
      }),
    envSummary: async () => {
      const env = envNow()
      const counts = envCounts(db)
      const archives = [...db.archives].reverse().map((a) => ({ ...a, restorable: !a.restoredAt && a.fromEnv === env && !hasData(counts) }))
      return clone({ env, counts, archives })
    },
    archiveEnv: (confirm, note) =>
      commit(() => {
        if (confirm.trim() !== ARCHIVE_CONFIRM) fail(`พิมพ์คำว่า "${ARCHIVE_CONFIRM}" ให้ตรงเพื่อยืนยัน`)
        const counts = envCounts(db)
        if (!hasData(counts)) fail('ไม่มีข้อมูลรายการในโหมดนี้ให้ล้าง')
        const id = db.archives.reduce((m, a) => Math.max(m, a.id), 0) + 1
        db.archiveData[id] = Object.fromEntries(DATA_KEYS.map((k) => [k, db[k]])) as unknown as DemoData
        for (const k of DATA_KEYS) db[k] = []
        db.archives.push({ id, fromEnv: envNow(), counts, note: note.trim() || null, archivedCode: ME, archivedAt: nowIso(), restoredCode: null, restoredAt: null })
        return id
      }),
    restoreArchive: (id) =>
      commit(() => {
        const a = db.archives.find((x) => x.id === id)
        if (!a) fail('ไม่พบชุดข้อมูลที่เก็บไว้')
        if (a!.restoredAt) fail('ชุดนี้กู้คืนไปแล้ว')
        if (a!.fromEnv !== envNow()) fail(`ชุดนี้ล้างมาจากโหมด${envLabel(a!.fromEnv)} · สลับไปโหมดนั้นก่อนจึงจะกู้คืนได้`)
        if (hasData(envCounts(db))) fail('โหมดนี้มีข้อมูลใหม่แล้ว · ล้างข้อมูลปัจจุบันเก็บไว้ก่อน แล้วจึงกู้คืนชุดนี้')
        Object.assign(db, db.archiveData[id])
        delete db.archiveData[id]
        Object.assign(a!, { restoredCode: ME, restoredAt: nowIso() })
      }),
    upsertPart: (p) =>
      commit(() => {
        if (!p.partNo.trim() || !p.name.trim()) fail('ต้องมี Part No. และชื่อ')
        const partNo = canonPartNo(db.master.parts, p.partNo)
        const i = db.master.parts.findIndex((x) => x.partNo === partNo)
        const prev = i >= 0 ? db.master.parts[i] : null
        const uam = p.uamCode?.trim() || null
        if (uam && db.master.parts.some((x) => x.uamCode === uam && x.partNo !== partNo)) fail(`รหัส UAM ${uam} ใช้กับ part อื่นแล้ว`)
        const next = {
          ...p,
          partNo,
          revision: (!partNo.includes('/') && partRevision(p.partNo)) || prev?.revision || null,
          type: p.type?.trim().toUpperCase() || null,
          uamCode: uam,
          models: [...new Set([...(prev?.models ?? []), ...p.models])],
        }
        if (i >= 0) db.master.parts[i] = next
        else db.master.parts.push(next)
      }),
    // เหมือน master_upsert_location (0018): ปิด = ชำรุด (บันทึกผังไม่เปิดคืน) · รหัสใหม่ = ช่องพิเศษ (บันทึกผังไม่ปิด)
    upsertLocation: (l) =>
      commit(() => {
        const code = l.code.trim().toUpperCase()
        if (!code) fail('ต้องมีรหัสช่อง')
        const i = db.master.locations.findIndex((x) => x.code === code)
        const prev = i >= 0 ? db.master.locations[i] : null
        if (!prev) db.master.locations.push({ code, zoneId: l.zoneId, kind: l.kind, active: l.active, blocked: !l.active, manual: true })
        else if (prev.active || prev.blocked || prev.manual) {
          if (prev.zoneId !== l.zoneId) fail(`รหัสช่อง ${code} เป็นของโซนอื่นอยู่แล้ว`)
          db.master.locations[i] = { ...prev, kind: l.kind, active: l.active, blocked: !l.active }
        } else if (l.active) db.master.locations[i] = { ...prev, zoneId: l.zoneId, kind: l.kind, active: true, blocked: false, manual: true }
      }),
    setZoneRule: (r) =>
      commit(() => {
        const type = r.partType?.trim().toUpperCase() || null
        const i = db.master.rules.findIndex((x) => x.customerId === r.customerId && x.partType === type)
        if (i >= 0) db.master.rules[i] = { ...r, partType: type }
        else db.master.rules.push({ ...r, partType: type })
      }),
    saveFg: (fg) =>
      commit(() => {
        const code = fg.code.trim().toUpperCase()
        if (!code || !fg.name.trim()) fail('ต้องมีรหัสและชื่อชุดวงล้อ')
        const next = { ...fg, code, name: fg.name.trim(), lines: fg.lines.filter((l) => l.qtyPer > 0).map((l) => ({ ...l, partNo: canonPartNo(db.master.parts, l.partNo) })) }
        const i = db.master.fgItems.findIndex((x) => x.code === code)
        if (i >= 0) db.master.fgItems[i] = next
        else db.master.fgItems.push(next)
      }),
    postRequisition: (p) =>
      commit(() => {
        assertOpen(p.modelCode, p.docDate || today())
        const lines = p.lines.filter((l) => l.qty > 0)
        if (!lines.length) fail('ไม่มีรายการที่จะเบิก')
        const reqNo = nextDoc('RQ')
        const req: Requisition = {
          id: uid(),
          kind: p.kind,
          reqNo,
          docNo: p.docNo?.trim() || null,
          docDate: p.docDate || today(),
          modelCode: p.modelCode || null,
          fgCode: p.fgCode || null,
          fgQty: p.fgQty ?? null,
          fromDept: p.fromDept || null,
          toDept: p.toDept || null,
          note: p.note || null,
          status: 'posted',
          reconciledBy: null,
          createdCode: ME,
          createdAt: nowIso(),
          lines: [],
        }
        db.requisitions.unshift(req)
        for (const l of lines) {
          issueFifo(req.id, reqNo, req.docNo ?? reqNo, l.partNo, l.qty)
          req.lines.push({ partNo: l.partNo, reqQty: l.reqQty ?? null, qty: l.qty, balance: onHand(l.partNo) })
        }
        return { id: req.id, reqNo }
      }),
    reconcileFm005: (p) =>
      commit(() => {
        const docNo = p.docNo.trim()
        if (!docNo) fail('ใส่เลขที่ FM-P-005')
        if (!p.docDate || !p.modelCode) fail('ใส่วันที่และ Model')
        assertOpen(p.modelCode, p.docDate)
        if (db.requisitions.some((r) => r.kind === 'fm005' && r.docNo === docNo && r.status === 'posted')) fail(`FM-P-005 เลขที่ ${docNo} บันทึกไปแล้ว`)
        const subs = db.requisitions.filter((r) => r.kind === 'line' && r.status === 'posted' && !r.reconciledBy && r.docDate === p.docDate && r.modelCode === p.modelCode)
        const subIds = subs.map((r) => r.id)
        const reqNo = nextDoc('RQ')
        const fm: Requisition = {
          id: uid(),
          kind: 'fm005',
          reqNo,
          docNo,
          docDate: p.docDate,
          modelCode: p.modelCode,
          fgCode: p.fgCode || null,
          fgQty: p.fgQty ?? null,
          fromDept: p.fromDept || null,
          toDept: p.toDept || null,
          note: p.note || null,
          status: 'posted',
          reconciledBy: null,
          createdCode: ME,
          createdAt: nowIso(),
          lines: [],
        }
        db.requisitions.unshift(fm)
        const fmQty = new Map<string, number>()
        for (const l of p.lines) fmQty.set(l.partNo, (fmQty.get(l.partNo) ?? 0) + (l.qty || 0))
        const subQty = new Map<string, number>()
        for (const r of subs) for (const l of r.lines) subQty.set(l.partNo, (subQty.get(l.partNo) ?? 0) + l.qty)
        for (const part of [...new Set([...fmQty.keys(), ...subQty.keys()])].sort()) {
          const f = fmQty.get(part) ?? 0
          const sub = subQty.get(part) ?? 0
          if (f > sub) issueFifo(fm.id, reqNo, docNo, part, f - sub)
          else if (f < sub) returnLifo(fm.id, subIds, reqNo, docNo, part, sub - f)
          fm.lines.push({ partNo: part, reqQty: sub, qty: f, balance: onHand(part) })
        }
        for (const r of subs) r.reconciledBy = fm.id
        return { id: fm.id, reqNo, subs: subs.length }
      }),
    voidRequisition: (id, reason) =>
      commit(() => {
        const r = db.requisitions.find((x) => x.id === id)
        if (!r || r.status !== 'posted') fail('ไม่พบใบเบิก หรือยกเลิกไปแล้ว')
        if (r!.kind === 'fm005') fail('ยกเลิก FM-P-005 ไม่ได้ · แจ้งผู้ดูแลระบบ')
        if (r!.reconciledBy) fail('ใบนี้กระทบยอดกับ FM-P-005 แล้ว ยกเลิกไม่ได้')
        if (!reason.trim()) fail('ระบุเหตุผลที่ยกเลิก')
        assertOpen(r!.modelCode, r!.docDate)
        for (const t of db.tx.filter((x) => x.kind === 'ISSUE' && x.requisitionId === id)) putBack(t, t.qty ?? 0, r!.reqNo, t.ref, id, `ยกเลิกใบเบิก: ${reason.trim()}`)
        r!.status = 'void'
        r!.note = [r!.note, `ยกเลิก: ${reason.trim()}`].filter(Boolean).join(' · ')
      }),
    listRequisitions: async (from, to) => clone(db.requisitions.filter((r) => r.docDate >= from && r.docDate <= to)),
    dashboardActivity: async (fromDay) => {
      const grns = new Map(db.grns.filter((g) => bangkokDay(g.receivedAt) >= fromDay && !g.grnNo.startsWith('CNT-') && g.status !== 'void').map((g) => [g.id, g]))
      return {
        receipts: db.grnLines
          .filter((l) => grns.has(l.grnId) && l.countedQty > 0)
          .map((l) => {
            const g = grns.get(l.grnId)!
            return { day: bangkokDay(g.receivedAt), grnNo: g.grnNo, model: g.modelCode, partNo: l.partNo, qty: l.countedQty, replacement: !!g.replacement }
          }),
        qi: db.tx
          .filter((t) => t.kind === 'QI' && bangkokDay(t.createdAt) >= fromDay)
          .map((t) => {
            const lpn = db.lpns.find((l) => l.id === t.lpnId)
            const grn = db.grns.find((g) => g.id === lpn?.grnId)
            return { day: bangkokDay(t.createdAt), model: grn?.modelCode ?? null, partNo: t.partNo ?? '', pass: t.passQty ?? 0, ng: t.ngQty ?? 0 }
          }),
        counts: countRows(fromDay),
      }
    },
    cycleActivity: async (countsFrom, movesFrom) => ({
      counts: countRows(countsFrom),
      moves: db.tx
        .filter((t) => ['PUT', 'MOVE', 'ISSUE', 'RETURN'].includes(t.kind) && bangkokDay(t.createdAt) >= movesFrom)
        .flatMap((t) => [t.fromLoc, t.toLoc].filter((loc): loc is string => !!loc).map((loc) => ({ day: bangkokDay(t.createdAt), loc }))),
    }),
    ledgerRows: async (parts, to) => {
      const want = new Set(parts)
      const reqs = new Map(db.requisitions.map((r) => [r.id, r]))
      const rows: LedgerRow[] = []
      for (const t of [...db.tx].reverse()) {
        if (!t.partNo || !want.has(t.partNo)) continue
        const ok = ['RECEIVE', 'ISSUE', 'RETURN'].includes(t.kind) || (t.kind === 'QI' && (t.ngQty ?? 0) > 0) || (t.kind === 'ADJ' && t.status === 'approved')
        if (!ok) continue
        const lpn = db.lpns.find((l) => l.id === t.lpnId)
        const grn = db.grns.find((g) => g.id === lpn?.grnId)
        // ใบรับที่ยกเลิก: ไม่นับรับเข้า (เหมือน stock_ledger_rows 0020)
        if (t.kind === 'RECEIVE' && grn?.status === 'void') continue
        const inv = db.invoices.find((i) => i.id === grn?.invoiceId)
        const req = reqs.get(t.requisitionId ?? '')
        const reqCol = req?.kind === 'qc' ? 'qc' : req?.kind === 'ng' ? 'ng' : 'issue'
        const issue = t.kind === 'ISSUE' || t.kind === 'RETURN'
        // วันที่ลงบัญชี (เหมือน stock_ledger_entries 0023): ใบเบิก/FM-P-005 = วันที่ในเอกสาร · ปรับยอด = วันที่อนุมัติ
        const at = issue && req ? onDocDate(t.createdAt, req.docDate) : t.kind === 'ADJ' ? (t.decidedAt ?? t.createdAt) : t.createdAt
        if (at >= to) continue
        rows.push({
          at,
          partNo: t.partNo,
          kind: t.kind,
          col: t.kind === 'RECEIVE' ? (grn?.replacement ? 'recv_rep' : 'recv') : t.kind === 'ISSUE' || t.kind === 'RETURN' ? reqCol : t.kind === 'QI' ? 'ng' : 'adj',
          qty: t.kind === 'RETURN' ? -(t.qty ?? 0) : t.kind === 'QI' ? (t.ngQty ?? 0) : t.kind === 'ADJ' ? (t.newQty ?? 0) - (t.qty ?? 0) : (t.qty ?? 0),
          invNo: t.kind === 'RECEIVE' ? (inv?.invoiceNo ?? null) : null,
          orderNo: t.kind === 'RECEIVE' ? (inv?.poNo ?? null) : null,
          orderDate: t.kind === 'RECEIVE' ? (inv?.docDate ?? null) : null,
          docNo: t.kind === 'ISSUE' || t.kind === 'RETURN' ? (req?.docNo ?? req?.reqNo ?? t.ref ?? t.docNo) : t.kind === 'RECEIVE' ? (grn?.grnNo ?? null) : t.docNo,
          lot: grn?.grnNo ?? null,
          note: t.reason ?? (req?.kind === 'fm005' ? 'กระทบยอด FM-P-005' : null),
          model: (issue ? req?.modelCode : null) || itemModel(t.lpnItemId, t.lpnId, t.partNo),
        })
      }
      return rows.sort((a, b) => a.at.localeCompare(b.at))
    },
    // สาธิต: ผังเก็บในเครื่อง (useLayoutEdits) — ที่นี่ปรับเฉพาะช่องเก็บให้ตรงกับผัง (กติกาเดียวกับ layout_save)
    // ผู้ใช้สาธิตคนนี้ปิดยอดเอง / รับทราบฝั่งไหนไปแล้ว (เหมือน listClosings ฝั่งฐานข้อมูล)
    listClosings: async () =>
      clone(db.closings.map((c) => ({ ...c, mine: { closed: c.closedBy === DEMO_ME, planning: c.planningBy === DEMO_ME, account: c.accountBy === DEMO_ME } }))),
    closeMonth: async (model, month, note) => {
      if (month >= today().slice(0, 7)) fail(`ปิดยอดได้เมื่อจบเดือน ${month} แล้ว`)
      const prev = db.closings.find((c) => c.modelCode === model && c.month === month)
      if (prev?.status === 'closed') fail(`${model} เดือน ${month} ปิดยอดไปแล้ว`)
      const parts = partsOfModel(db.master, model)
      // ยอดของ Model นี้เท่านั้น (part ร่วมไม่ซ้ำในหลาย Model เหมือน ledger_month_totals 0023)
      const sheets = buildLedger(rowsOfModel(await api.ledgerRows(parts.map((p) => p.partNo), monthRange(month).to), model), parts, month)
      const totals = sheets.map((x) => ({ partNo: x.partNo, opening: x.opening, in: x.totalIn, out: x.totalOut, closing: x.closing }))
      const next: StockClosing = {
        id: prev?.id ?? uid(),
        modelCode: model,
        month,
        status: 'closed',
        totals,
        // สาธิต: ปิดยอดในนามหัวหน้าคลัง ผู้ใช้สาธิตจึงกดรับทราบได้ (คนปิดยอดรับทราบเองไม่ได้)
        closedBy: DEMO_CLOSER,
        closedAt: nowIso(),
        planningBy: null,
        planningAt: null,
        accountBy: null,
        accountAt: null,
        note: note?.trim() || null,
      }
      db.closings = [next, ...db.closings.filter((c) => c.id !== next.id)]
      save()
    },
    reopenMonth: (id, reason) =>
      commit(() => {
        const c = db.closings.find((x) => x.id === id && x.status === 'closed')
        if (!c) fail('ไม่พบรายการปิดยอด')
        if (!reason.trim()) fail('ระบุเหตุผลที่เปิดเดือน')
        c!.status = 'reopened'
        c!.note = [c!.note, `เปิดเดือน: ${reason.trim()} โดย ผู้ใช้สาธิต`].filter(Boolean).join(' · ')
      }),
    ackClosing: (id, side) =>
      commit(() => {
        const c = db.closings.find((x) => x.id === id && x.status === 'closed')
        if (!c || (side === 'planning' ? c.planningAt : c.accountAt)) fail('ไม่พบรายการ หรือรับทราบไปแล้ว')
        const who = side === 'planning' ? 'Planning' : 'บัญชี'
        // เหมือน stock_close_ack 0023: คนปิดยอดรับทราบเองไม่ได้ · คนเดียวรับทราบทั้งสองฝั่งไม่ได้
        if (c!.closedBy === DEMO_ME) fail(`คนที่ปิดยอดรับทราบเองไม่ได้ · ให้ ${who} กดรับทราบ`)
        if ((side === 'planning' ? c!.accountBy : c!.planningBy) === DEMO_ME) fail(`รับทราบอีกฝั่งไปแล้ว · ฝั่ง ${who} ต้องเป็นอีกคน`)
        if (side === 'planning') Object.assign(c!, { planningBy: DEMO_ME, planningAt: nowIso() })
        else Object.assign(c!, { accountBy: DEMO_ME, accountAt: nowIso() })
      }),
    submitStockCount: (p) =>
      commit(() => {
        if (!p.lines.length) fail('ไม่มีรายการตรวจนับ')
        const ctx = { locations: db.master.locations, zones: sampleLayout.zones }
        const count: StockCount = {
          id: uid(),
          countNo: nextDoc('CNT'),
          status: 'pending',
          note: p.note?.trim() || null,
          createdCode: ME,
          createdAt: nowIso(),
          decidedCode: null,
          decidedAt: null,
          decisionNote: null,
          grnId: null,
          lines: [],
        }
        p.lines.forEach((l, i) => {
          const where = countLocations(l.loc, ctx)
          if (!where) fail(`แถว ${i + 1}: ไม่พบช่องเก็บหรือโซน "${l.loc}"`)
          const part = resolvePart(db.master.parts, l.partNo)
          if (!part) fail(`แถว ${i + 1}: ไม่พบ part "${l.partNo}" ใน Master`)
          if (!(l.counted >= 0)) fail(`แถว ${i + 1}: จำนวนนับต้องเป็น 0 ขึ้นไป`)
          const loc = l.loc.trim().toUpperCase()
          // เหมือน stock_count_submit (0022): part เดียวกันห้ามมีแถวที่ช่องซ้อนกัน (ช่องซ้ำ หรือโซนที่มีช่องนั้น)
          const clash = count.lines.find((x) => x.partNo === part!.partNo && countLocations(x.loc, ctx)!.locs.some((c) => where!.locs.includes(c)))
          if (clash)
            fail(`แถว ${i + 1}: ${part!.partNo} ที่ ${loc} ซ้อนกับแถว ${clash.lineNo} (${clash.loc}) ในไฟล์เดียวกัน (ช่องเดียวกัน หรือโซนที่มีช่องนั้น) · part เดียวกันให้นับระดับเดียว: รายช่อง หรือทั้งโซน`)
          count.lines.push({ lineNo: i + 1, loc, zoneId: where!.zoneId, partNo: part!.partNo, systemQty: systemQty(db.lpns, where!.locs, part!.partNo), countedQty: l.counted, appliedQty: null })
        })
        db.counts.unshift(count)
        return { id: count.id, countNo: count.countNo }
      }),
    listStockCounts: async () => clone(db.counts),
    // สาธิตมีผู้ใช้คนเดียว: ไม่บังคับ "คนส่งอนุมัติเองไม่ได้" (ระบบจริงบังคับ)
    decideStockCount: (id, approve, note) =>
      commit(() => {
        const c = db.counts.find((x) => x.id === id && x.status === 'pending')
        if (!c) fail('ใบตรวจนับนี้ถูกพิจารณาไปแล้ว')
        const decided = { decidedCode: ME, decidedAt: nowIso() }
        if (!approve) {
          if (!note?.trim()) fail('ระบุเหตุผลที่ไม่อนุมัติ')
          Object.assign(c!, decided, { status: 'rejected', decisionNote: note!.trim() })
          return { changed: 0, newBoxes: 0, grnId: null }
        }
        const ctx = { locations: db.master.locations, zones: sampleLayout.zones }
        const reason = `ตรวจนับ ${c!.countNo}`
        let grn: Grn | null = null
        let changed = 0
        let newBoxes = 0
        const adj = (lpn: Lpn, item: Lpn['items'][number], from: number, to: number) =>
          log({ kind: 'ADJ', docNo: c!.countNo, lpnId: lpn.id, lpnNo: lpn.lpnNo, lpnItemId: item.id, partNo: item.partNo, qty: from, newQty: to, reason, status: 'approved', createdCode: c!.createdCode, toLoc: lpn.locationCode, decidedCode: ME, decidedAt: nowIso() })
        // ตรวจทุกบรรทัดก่อน (ไม่พอลด ⇒ ไม่ปรับเลยสักบรรทัด เหมือนธุรกรรมฝั่งฐานข้อมูล)
        for (const l of c!.lines) {
          const locs = countLocations(l.loc, ctx)!.locs
          const d = l.countedQty - l.systemQty
          if (d < 0 && systemQty(db.lpns, locs, l.partNo) < -d) fail(`${l.partNo} ที่ ${l.loc} ยอดในระบบตอนนี้ไม่พอลด ${-d} (มีการเบิก/ย้ายหลังตรวจนับ) · ไม่อนุมัติแล้วนับใหม่`)
        }
        for (const l of c!.lines) {
          const locs = countLocations(l.loc, ctx)!.locs
          const d = l.countedQty - l.systemQty
          const boxes = db.lpns
            .filter((x) => x.status === 'active' && locs.includes(x.locationCode) && x.items.some((i) => i.partNo === l.partNo))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.lpnNo.localeCompare(b.lpnNo))
          if (d < 0) {
            let left = -d
            for (const b of boxes)
              for (const item of b.items.filter((i) => i.partNo === l.partNo && i.qty > 0)) {
                if (left <= 0) break
                const take = Math.min(left, item.qty)
                adj(b, item, item.qty, item.qty - take)
                item.qty -= take
                left -= take
                if (!b.items.some((i) => i.qty > 0)) b.status = 'empty'
              }
            changed++
          } else if (d > 0) {
            const last = boxes.at(-1)
            const item = last?.items.find((i) => i.partNo === l.partNo)
            if (last && item) {
              adj(last, item, item.qty, item.qty + d)
              item.qty += d
            } else {
              if (!grn) {
                grn = { id: uid(), grnNo: c!.countNo, invoiceId: null, invoiceNo: null, plRef: c!.countNo, soNo: null, packages: null, modelCode: null, customerId: null, receivedAt: nowIso(), receiverCode: ME, note: 'กล่องใหม่จากการตรวจนับ (ยอดนับเกินระบบ)', replacement: false }
                db.grns.unshift(grn)
              }
              const used = new Set(db.lpns.filter((x) => x.status === 'active').map((x) => x.locationCode))
              const home = locs.length === 1 ? locs[0] : (locs.find((x) => x !== l.loc && !used.has(x)) ?? locs.find((x) => x !== l.loc) ?? l.loc)
              const part = db.master.parts.find((x) => x.partNo === l.partNo)
              const gl: GrnLine = { id: uid(), grnId: grn.id, lineNo: db.grnLines.filter((x) => x.grnId === grn!.id).length + 1, partNo: l.partNo, description: part?.name ?? null, partType: part?.type ?? null, plQty: 0, countedQty: d, invoiceQty: null, needsQi: false, homeLocation: home }
              db.grnLines.push(gl)
              const lpn: Lpn = { id: uid(), lpnNo: nextDoc('LPN'), grnId: grn.id, locationCode: home, hold: false, status: 'active', createdAt: nowIso(), items: [] }
              const it = { id: uid(), lpnId: lpn.id, grnLineId: gl.id, partNo: l.partNo, qty: d }
              lpn.items.push(it)
              db.lpns.push(lpn)
              adj(lpn, it, 0, d)
              newBoxes++
            }
            changed++
          }
          l.appliedQty = d
        }
        Object.assign(c!, decided, { status: 'approved', grnId: (grn as Grn | null)?.id ?? null, decisionNote: note?.trim() || null })
        return { changed, newBoxes, grnId: (grn as Grn | null)?.id ?? null }
      }),
    queuePrint: (p) =>
      commit(() => {
        const lpns = db.lpns.filter((l) => l.grnId === p.grnId)
        if (!db.grns.some((g) => g.id === p.grnId)) fail('ไม่พบใบรับสินค้า')
        if (p.format !== 'a4' && !p.lpnIds.length) fail('ยังไม่ได้เลือกป้าย')
        if (p.lpnIds.some((id) => !lpns.some((l) => l.id === id))) fail('ป้ายที่เลือกไม่อยู่ในใบรับสินค้านี้')
        const job: PrintJob = {
          id: uid(),
          format: p.format,
          grnId: p.grnId,
          lpnIds: [...p.lpnIds],
          copies: Math.max(1, Math.min(10, p.copies ?? 1)),
          title: p.title?.trim() || null,
          status: 'queued',
          requestedCode: ME,
          requestedAt: nowIso(),
          doneCode: null,
          doneAt: null,
        }
        db.printJobs.unshift(job)
        return job.id
      }),
    listPrintJobs: async () => clone(db.printJobs.slice(0, 50)),
    finishPrintJob: (id, status) =>
      commit(() => {
        const j = db.printJobs.find((x) => x.id === id && x.status === 'queued')
        if (!j) fail('งานพิมพ์นี้ถูกพิมพ์หรือยกเลิกไปแล้ว')
        Object.assign(j!, { status, doneCode: ME, doneAt: nowIso() })
      }),
    saveLayout: (p) =>
      commit(() => {
        const busy = (codes: (code: string) => boolean) => db.lpns.filter((l) => l.status === 'active' && codes(l.locationCode)).map((l) => l.lpnNo)
        for (const id of p.removed) {
          const codes = new Set(db.master.locations.filter((l) => l.zoneId === id).map((l) => l.code))
          const lpns = busy((c) => codes.has(c))
          if (lpns.length) fail(`โซน ${id} ยังมีของ (${lpns.slice(0, 5).join(', ')}) — ย้ายของออกก่อนลบ`)
          db.master.locations = db.master.locations.filter((l) => l.zoneId !== id)
        }
        // เหมือน sync_zone_locations (0018): ไม่ปิดช่องพิเศษ ไม่เปิดช่องที่หลังบ้านปิดไว้
        for (const z of p.locations) {
          const want = new Set(z.codes)
          const dropped = db.master.locations.filter((l) => l.zoneId === z.zoneId && l.active && !l.manual && !want.has(l.code)).map((l) => l.code)
          const lpns = busy((c) => dropped.includes(c))
          if (lpns.length) fail(`ช่องที่จะปิดยังมีของ (${lpns.slice(0, 5).join(', ')}) — ย้ายของออกก่อน`)
          const clash = db.master.locations.filter((l) => want.has(l.code) && l.zoneId !== z.zoneId && (l.active || l.blocked || l.manual)).map((l) => l.code)
          if (clash.length) fail(`รหัสช่อง ${clash.slice(0, 10).join(', ')} ซ้ำกับโซนอื่น`)
          const blocked = new Set(db.master.locations.filter((l) => l.blocked).map((l) => l.code))
          db.master.locations = db.master.locations
            .map((l) => (l.zoneId === z.zoneId && !l.manual && !want.has(l.code) ? { ...l, active: false } : l))
            .filter((l) => !want.has(l.code))
            .concat(z.codes.map((code) => ({ code, zoneId: z.zoneId, kind: z.kind, active: !blocked.has(code), blocked: blocked.has(code), manual: false })))
        }
      }),
  }
  if (opts.samples && !db.sampled && !db.grns.length) seedSamples()
  return api

  /** กล่องตัวอย่างผ่านขั้นตอนจริง: รับของ → จัดเก็บ → MI3 → เบิก (ย้อนวันรับของเก่าให้ดูสมจริง) */
  function seedSamples() {
    const quiet = (p: Promise<unknown>) => void p.catch(() => undefined)
    // 09:30 เวลาไทยของวันที่ย้อนไป (ไม่ขึ้นกับ timezone ของเครื่อง · ตี 0–7 เวลาไทยวันไทยนำวัน UTC อยู่ 1 วัน)
    const ago = (days: number) => new Date(`${addDays(bangkokDay(new Date().toISOString()), -days)}T09:30:00+07:00`).toISOString()
    const name = (no: string) => db.master.parts.find((p) => p.partNo === canonPartNo(db.master.parts, no))?.name ?? ''
    const receive = (model: string, ref: string, lines: [string, number][], days: number) => {
      quiet(api.createGrn({ packingList: { refDoc: ref }, modelCode: model, lines: lines.map(([partNo, qty]) => ({ partNo, description: name(partNo), plQty: qty, countedQty: qty })) }))
      const grn = db.grns[0]
      const boxes = db.lpns.filter((l) => l.grnId === grn.id)
      // จัดเก็บเข้าช่องแนะนำ (กล่องรอ MI3 ยังอยู่ที่จุดตรวจ)
      for (const l of boxes) {
        const home = db.grnLines.find((g) => g.id === l.items[0]?.grnLineId)?.homeLocation
        if (home && !l.hold) quiet(api.scanMove(l.id, home, 'PUT'))
      }
      if (days > 0) {
        const at = ago(days)
        grn.receivedAt = at
        for (const l of boxes) l.createdAt = at
        for (const t of db.tx) if (boxes.some((l) => l.id === t.lpnId)) t.createdAt = at
      }
      return boxes
    }
    const k1g = receive(
      'K1G',
      'PL-K1G-0915',
      [
        ['RAT00586', 200],
        ['RAT00586', 200],
        ['RAT00586', 200],
        ['RAJ00536', 200],
        ['RAJ00536', 200],
        ['RAT01088', 150],
        ['RAT01088', 150],
        ['RAT01088', 150],
        ['RAJ00537', 150],
        ['RAJ00537', 150],
        ['RAT00566', 6000],
        ['RAT00567', 6000],
        ['RAJ00550', 14400],
        ['150324', 1200],
      ],
      4,
    )
    receive('K1G', 'PL-K1G-TYRE', [
      ['RAJ00301', 40],
      ['RAJ00301', 40],
      ['RAJ00301', 40],
    ], 2)
    receive('J1D', 'PL-J1D-0921', [
      ['1100246', 80],
      ['1100247', 80],
      ['141109', 240],
    ], 1)
    // J1A: ขอบล้อ / ดุม ต้องผ่าน MI3 · คัดแล้ว 1 กล่อง (NG 5) ที่เหลือรอคัด
    const j1a = receive('J1A', 'PL-J1A-1016', [
      ['1100351', 60],
      ['1100351', 60],
      ['1100187', 120],
      ['1100187', 120],
    ], 0)
    const checked = j1a.find((l) => l.hold)
    if (checked) {
      quiet(api.scanQi(checked.id, 55, 5, 'ขอบบุบ (ตัวอย่าง)'))
      const home = db.grnLines.find((g) => g.id === checked.items[0]?.grnLineId)?.homeLocation
      if (home) quiet(api.scanMove(checked.id, home, 'PUT'))
    }
    receive('K1G', 'PL-K1G-1016', [['RAT00587', 150]], 0)
    // ขอบล้อเสียรอส่งคืน
    const ng = k1g.find((l) => l.items[0]?.partNo === 'RAT01088')
    if (ng) quiet(api.scanMove(ng.id, 'NG-HOLD', 'MOVE'))
    // เบิกวันนี้: สแกนเบิกเข้าไลน์ K1G (ใบเบิกเดียวกัน) + QC เบิก
    // กล่องที่มี part นี้พอเบิก (ไม่รอ MI3 ไม่อยู่ที่ NG)
    const item = (part: string, qty = 1) =>
      db.lpns.find((l) => l.status === 'active' && !l.hold && l.locationCode !== 'NG-HOLD' && l.items.some((i) => i.partNo === part && i.qty >= qty))?.items.find((i) => i.partNo === part && i.qty >= qty)
    // เบิกเข้าไลน์ย้อนหลัง 3 วัน (หน้าภาพรวมมีแนวโน้มและค่าเฉลี่ยการใช้ให้ดู)
    for (const [days, doc, lines] of [
      [3, 'MRA-0098', [['RAT00586', 80], ['RAT00566', 600]]],
      [2, 'MRA-0099', [['RAT00586', 120], ['RAT01088', 60], ['RAT00566', 700]]],
      [1, 'MRA-0100', [['RAT00586', 100], ['RAT00566', 800]]],
    ] as [number, string, [string, number][]][]) {
      const before = new Set(db.requisitions.map((r) => r.id))
      for (const [part, qty] of lines) {
        const it = item(part, qty)
        if (it) quiet(api.scanIssue({ itemId: it.id, qty, kind: 'line', modelCode: 'K1G', docNo: doc, toDept: 'ไลน์ประกอบ K1G' }))
      }
      const at = ago(days)
      for (const r of db.requisitions.filter((x) => !before.has(x.id))) {
        Object.assign(r, { docDate: bangkokDay(at), createdAt: at })
        for (const t of db.tx) if (t.requisitionId === r.id) t.createdAt = at
      }
    }
    for (const [part, qty] of [
      ['RAT00586', 100],
      ['RAT01088', 100],
      ['RAT00566', 900],
    ] as [string, number][]) {
      const it = item(part, qty)
      if (it) quiet(api.scanIssue({ itemId: it.id, qty, kind: 'line', modelCode: 'K1G', docNo: 'MRA-0001', toDept: 'ไลน์ประกอบ K1G' }))
    }
    const bearing = item('150324')
    if (bearing) quiet(api.scanIssue({ itemId: bearing.id, qty: 10, kind: 'qc', toDept: 'QC ตรวจสอบ' }))
    // ตรวจนับวนเมื่อ 2 วันก่อน: ตรง 5 รายการ ไม่ตรง 1 (ช่องนั้นขึ้นเป็น "ครั้งก่อนไม่ตรง" ในแผนนับวันนี้)
    const shelved = db.lpns.filter((l) => l.status === 'active' && !l.hold && /^RK-/.test(l.locationCode) && (l.items[0]?.qty ?? 0) > 2).slice(0, 6)
    shelved.forEach((l, i) => quiet(api.scanCountItem(l.items[0].id, l.items[0].qty - (i === 1 ? 2 : 0))))
    for (const t of db.tx) if (t.kind === 'COUNT') t.createdAt = ago(2)
    db.sampled = true
    save()
  }
}
