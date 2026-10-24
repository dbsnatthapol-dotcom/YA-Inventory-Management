import type { WmsApi } from './api'
import { checkSummary } from './checkSheet'
import { bangkokDay } from './ledger'
import { fmt, reconcile } from './logic'
import { resolvePart } from './partCodes'
import type {
  CheckLine,
  DocMatches,
  Grn,
  GrnLine,
  InvoiceStatus,
  InvoiceView,
  LedgerRow,
  Lpn,
  MasterData,
  PartMaster,
  ReceiptCheck,
  Requisition,
  RequisitionKind,
  StockClosing,
  StorageLoc,
  TraceTx,
} from './types'

/**
 * ตามรอยเอกสาร/กล่อง: เลขเอกสารทุกใบในระบบผูกกันเป็นสาย
 *   Packing List → ใบตรวจรับ CHK → ใบรับ GRN (+ Invoice) → กล่อง LPN → ใบเบิก RQ → FM-P-005 → บัญชีคุม FM-P-537
 * ค้นจากเลขไหนก็ได้ แล้วแสดงทั้งสาย (ใบเบิก = ย้อนกลับไปหาว่าของมาจากใบรับไหน)
 */

/** ชนิดคำค้นจากรูปแบบเลขที่ระบบออก · doc = เลขเอกสารภายนอก (Packing List / Invoice / ใบเบิกกระดาษ) */
export type TraceKind = 'lpn' | 'grn' | 'check' | 'req' | 'part' | 'doc'

const DOC_NO = /\b(LPN|GRN|CHK|RQ|CNT)-\d{4}-\d{4,}\b/i

/** ข้อความจากการสแกน/พิมพ์ → คำค้น (ลิงก์ในป้าย .../t/LPN-… หรือ .../g/GRN-… ได้เลขเอกสาร) */
export function traceQuery(text: string): string {
  const t = text.trim()
  const m = t.match(DOC_NO)
  return m ? m[0].toUpperCase() : t
}

export function traceKind(q: string, parts: PartMaster[]): TraceKind {
  const t = q.trim().toUpperCase()
  if (/^LPN-\d{4}-\d{4,}$/.test(t)) return 'lpn'
  if (/^(GRN|CNT)-\d{4}-\d{4,}$/.test(t)) return 'grn'
  if (/^CHK-\d{4}-\d{4,}$/.test(t)) return 'check'
  if (/^RQ-\d{4}-\d{4,}$/.test(t)) return 'req'
  return resolvePart(parts, t) ? 'part' : 'doc'
}

// ===== กล่อง =====
/** กล่องอยู่ขั้นไหนตอนนี้ · gone = เบิกหมด / รวมเข้ากล่องอื่น / ยกเลิก */
export type BoxPlace = 'store' | 'staging' | 'mi3' | 'ng' | 'gone'

export const PLACE_LABEL: Record<BoxPlace, string> = {
  store: 'ในช่องเก็บ',
  staging: 'รอจัดเก็บ',
  mi3: 'รอตรวจ MI3',
  ng: 'พื้นที่กัก NG',
  gone: 'ไม่อยู่ในคลังแล้ว',
}

export function boxPlace(l: Pick<Lpn, 'status' | 'hold' | 'locationCode'>, locations: StorageLoc[]): BoxPlace {
  if (l.status !== 'active') return 'gone'
  if (l.hold) return 'mi3'
  const kind = locations.find((x) => x.code === l.locationCode)?.kind
  return kind === 'ng' ? 'ng' : kind === 'staging' || kind === 'hold' ? 'staging' : 'store'
}

/** สถานะกล่องที่ไม่อยู่ในคลังแล้ว */
export const GONE_LABEL: Record<Exclude<Lpn['status'], 'active'>, string> = { empty: 'เบิกหมดแล้ว', merged: 'รวมเข้ากล่องอื่นแล้ว', void: 'ยกเลิก (ยกเลิกใบรับ)' }

export interface TraceBox {
  lpn: Lpn
  place: BoxPlace
  /** ชิ้นที่เหลือในกล่อง */
  now: number
  /** เบิกออกสุทธิ (เบิก − คืน) */
  issued: number
  /** ความเคลื่อนไหวของกล่องนี้ เก่า → ใหม่ */
  events: TraceTx[]
  /** เลขกล่องที่รวมเข้าไป (กล่องที่ถูกรวม) */
  mergedInto: string | null
}

const sign = (t: TraceTx) => (t.kind === 'ISSUE' ? 1 : t.kind === 'RETURN' ? -1 : 0)

export function traceBoxes(lpns: Lpn[], events: TraceTx[], locations: StorageLoc[]): TraceBox[] {
  return lpns.map((lpn) => {
    const own = events.filter((t) => t.lpnId === lpn.id)
    const into = lpn.status === 'merged' ? lpns.find((o) => o.id !== lpn.id && o.items.some((i) => i.prevLpnId === lpn.id)) : undefined
    return {
      lpn,
      place: boxPlace(lpn, locations),
      now: lpn.items.reduce((s, i) => s + Math.max(0, i.qty), 0),
      issued: own.reduce((s, t) => s + sign(t) * (t.qty ?? 0), 0),
      events: own,
      mergedInto: into?.lpnNo ?? null,
    }
  })
}

// ===== ใบเบิกที่ใช้ของจากกล่องชุดนี้ =====
export interface ReqUse {
  key: string
  reqId: string | null
  reqNo: string
  /** เลขใบเบิกกระดาษ */
  docNo: string | null
  kind: RequisitionKind | null
  model: string | null
  day: string
  toDept: string | null
  /** ชิ้นสุทธิ (เบิก − คืน) */
  qty: number
  parts: string[]
  boxes: string[]
  /** ใบย่อยที่กระทบ FM-P-005 แล้ว */
  reconciled: boolean
  void: boolean
}

export const REQ_KIND: Record<RequisitionKind, string> = { line: 'เบิกเข้าไลน์', qc: 'QC เบิก', ng: 'NG / ส่งคืน', fm005: 'FM-P-005' }

export function reqUses(events: TraceTx[]): ReqUse[] {
  const out = new Map<string, ReqUse>()
  for (const t of events) {
    const s = sign(t)
    if (!s) continue
    const key = t.req?.id ?? t.requisitionId ?? t.docNo ?? t.id
    const u = out.get(key) ?? {
      key,
      reqId: t.req?.id ?? t.requisitionId ?? null,
      reqNo: t.req?.reqNo ?? t.docNo ?? '-',
      docNo: t.req?.docNo ?? null,
      kind: t.req?.kind ?? null,
      model: t.req?.modelCode ?? null,
      day: t.req?.docDate ?? bangkokDay(t.createdAt),
      toDept: t.req?.toDept ?? null,
      qty: 0,
      parts: [],
      boxes: [],
      reconciled: !!t.req?.reconciledBy,
      void: t.req?.status === 'void',
    }
    u.qty += s * (t.qty ?? 0)
    if (t.partNo && !u.parts.includes(t.partNo)) u.parts.push(t.partNo)
    if (t.lpnNo && !u.boxes.includes(t.lpnNo)) u.boxes.push(t.lpnNo)
    out.set(key, u)
  }
  return [...out.values()].sort((a, b) => a.day.localeCompare(b.day) || a.reqNo.localeCompare(b.reqNo))
}

// ===== ผลการตามรอย =====
/** ตัวเลือกเมื่อเลขเดียวตรงหลายเอกสาร (เช่น PL เดียวรับสองครั้ง) */
export interface TraceOption {
  kind: 'grn' | 'check' | 'req'
  id: string
  /** เลขเอกสารที่ค้นแล้วได้ใบนี้ใบเดียว */
  query: string
  title: string
  sub: string
  /** ใบที่ใช้งานอยู่ (ไม่ใช่ใบที่ยกเลิก) */
  active: boolean
}

export interface ClosingRef {
  model: string
  month: string
  row: StockClosing | null
}

export interface ReceiptTrace {
  type: 'receipt'
  check: ReceiptCheck | null
  checkLines: CheckLine[]
  grn: Grn | null
  grnLines: GrnLine[]
  invoice: InvoiceView | null
  boxes: TraceBox[]
  reqs: ReqUse[]
  closing: ClosingRef | null
  /** เลขกล่องที่ค้น (เปิดประวัติกล่องนี้ให้) */
  focus: string | null
  /** เอกสารอื่นที่เลขเดียวกัน (เช่น ใบที่ยกเลิกไปแล้ว) */
  others: TraceOption[]
}

/** ที่มาของของที่เบิก: กล่อง → ใบรับ → Packing List / Invoice */
export interface ReqSource {
  lpnId: string | null
  lpnNo: string
  partNo: string
  qty: number
  fromLoc: string | null
  grnNo: string | null
  plRef: string | null
  invoiceNo: string | null
  caseNo: string | null
  /** ใบเบิกที่ตัดของชิ้นนี้ (FM-P-005 = รวมใบย่อยของวัน) */
  reqNo: string
}

export interface ReqTrace {
  type: 'req'
  req: Requisition
  /** FM-P-005 ที่กระทบใบนี้แล้ว */
  fm005: Requisition | null
  /** ใบย่อยที่ FM-P-005 ใบนี้กระทบ */
  subs: Requisition[]
  sources: ReqSource[]
  closing: ClosingRef | null
  others: TraceOption[]
}

export interface PartTrace {
  type: 'part'
  part: PartMaster
  boxes: { lpn: Lpn; place: BoxPlace; qty: number }[]
  byPlace: Record<BoxPlace, number>
  /** ความเคลื่อนไหวในบัญชีคุม ใหม่ → เก่า */
  rows: LedgerRow[]
}

export type TraceResult = ReceiptTrace | ReqTrace | PartTrace | { type: 'pick'; options: TraceOption[] } | { type: 'none'; query: string }

const DAY = (iso: string) => bangkokDay(iso)

/** ตัวเลือกจากเอกสารที่ตรง · ใบตรวจรับที่ออก GRN ในชุดแล้วไม่ซ้ำ (ดูผ่าน GRN) */
export function docOptions(m: DocMatches): TraceOption[] {
  const grnIds = new Set(m.grns.map((g) => g.id))
  const opts: TraceOption[] = [
    ...m.grns.map((g) => ({
      kind: 'grn' as const,
      id: g.id,
      query: g.grnNo,
      title: `ใบรับ ${g.grnNo}`,
      sub: `PL ${g.plRef}${g.modelCode ? ` · ${g.modelCode}` : ''} · รับ ${DAY(g.receivedAt)}${g.status === 'void' ? ' · ยกเลิกแล้ว' : ''}`,
      active: g.status !== 'void',
    })),
    ...m.checks
      .filter((c) => !c.grnId || !grnIds.has(c.grnId))
      .map((c) => ({
        kind: 'check' as const,
        id: c.id,
        query: c.checkNo,
        title: `ใบตรวจรับ ${c.checkNo}`,
        sub: `PL ${c.plRef}${c.modelCode ? ` · ${c.modelCode}` : ''} · ${c.status === 'open' ? `กำลังตรวจ ${c.checkedCount}/${c.lineCount}` : c.status === 'done' ? 'ตรวจเสร็จ' : 'ยกเลิก'}`,
        active: c.status !== 'cancelled',
      })),
    ...m.reqs.map((r) => ({
      kind: 'req' as const,
      id: r.id,
      query: r.reqNo,
      title: `${REQ_KIND[r.kind]} ${r.reqNo}`,
      sub: `${r.docNo ? `ใบ ${r.docNo} · ` : ''}${r.modelCode ?? '-'} · ${r.docDate}${r.status === 'void' ? ' · ยกเลิกแล้ว' : ''}`,
      active: r.status !== 'void',
    })),
  ]
  return opts.sort((a, b) => Number(b.active) - Number(a.active))
}

export async function loadTrace(api: WmsApi, master: MasterData, text: string): Promise<TraceResult> {
  const q = traceQuery(text)
  if (!q) return { type: 'none', query: q }
  const kind = traceKind(q, master.parts)
  if (kind === 'lpn') {
    const hit = await api.findLpn(q)
    return hit ? receiptTrace(api, master, { grnId: hit.lpn.grnId, focus: hit.lpn }) : { type: 'none', query: q }
  }
  if (kind === 'part') return partTrace(api, master, resolvePart(master.parts, q)!)
  const m = await api.findDocs(q)
  const options = docOptions(m)
  if (!options.length) return { type: 'none', query: q }
  // เลขตรงใบเดียว (พิมพ์เลข GRN / CHK / RQ) หรือมีใบที่ใช้งานอยู่ใบเดียว (ที่เหลือยกเลิกแล้ว) ⇒ เปิดเลย
  const exact = options.filter((o) => o.query.toUpperCase() === q.toUpperCase())
  const live = options.filter((o) => o.active)
  const pick = exact.length === 1 ? exact[0] : options.length === 1 ? options[0] : live.length === 1 ? live[0] : null
  if (!pick) return { type: 'pick', options }
  const others = options.filter((o) => o !== pick)
  if (pick.kind === 'req') return reqTrace(api, m.reqs.find((r) => r.id === pick.id)!, others)
  return receiptTrace(api, master, pick.kind === 'grn' ? { grnId: pick.id, others } : { checkId: pick.id, others })
}

const closingOf = (closings: StockClosing[], model: string | null | undefined, day: string): ClosingRef | null =>
  model ? { model, month: day.slice(0, 7), row: closings.find((c) => c.modelCode === model && c.month === day.slice(0, 7)) ?? null } : null

export async function receiptTrace(api: WmsApi, master: MasterData, p: { grnId?: string | null; checkId?: string; focus?: Lpn; others?: TraceOption[] }): Promise<ReceiptTrace> {
  // ค้นจากใบตรวจรับ: ใบที่ออก GRN แล้วต่อไปที่ GRN นั้น
  const first = !p.grnId && p.checkId ? await api.checkDetail(p.checkId) : null
  const grnId = p.grnId ?? first?.check.grnId ?? null
  const detail = grnId ? await api.grnDetail(grnId) : null
  const grn = detail?.grn ?? null
  const lpns = [...(detail?.lpns ?? [])]
  // กล่องที่ค้นอาจถูกรวม/ยกเลิกไปแล้ว (หน้ารายการใบรับไม่แสดง) ⇒ ใส่ไว้ด้วย
  if (p.focus && !lpns.some((l) => l.id === p.focus!.id)) lpns.push(p.focus)
  const checkId = grn?.checkId ?? p.checkId ?? null
  const [check, events, invoice, closings] = await Promise.all([
    first ? Promise.resolve(first) : checkId ? api.checkDetail(checkId) : Promise.resolve(null),
    lpns.length ? api.traceTx({ lpnIds: lpns.map((l) => l.id) }) : Promise.resolve([] as TraceTx[]),
    grn?.invoiceNo ? api.invoiceView(grn.invoiceNo).catch(() => null) : Promise.resolve(null),
    grn?.modelCode ? api.listClosings().catch(() => [] as StockClosing[]) : Promise.resolve([] as StockClosing[]),
  ])
  return {
    type: 'receipt',
    check: check?.check ?? null,
    checkLines: check?.lines ?? [],
    grn,
    grnLines: detail?.lines ?? [],
    invoice,
    boxes: traceBoxes(lpns, events, master.locations),
    reqs: reqUses(events),
    closing: grn ? closingOf(closings, grn.modelCode, DAY(grn.receivedAt)) : null,
    focus: p.focus?.lpnNo ?? null,
    others: p.others ?? [],
  }
}

export async function reqTrace(api: WmsApi, req: Requisition, others: TraceOption[] = []): Promise<ReqTrace> {
  // FM-P-005 กับใบย่อยลงวันเดียวกัน (วัน + Model)
  const sameDay = req.kind === 'fm005' || req.reconciledBy ? await api.listRequisitions(req.docDate, req.docDate) : []
  const subs = req.kind === 'fm005' ? sameDay.filter((r) => r.reconciledBy === req.id) : []
  const [events, closings] = await Promise.all([
    api.traceTx({ reqIds: [req.id, ...subs.map((s) => s.id)] }),
    req.modelCode ? api.listClosings().catch(() => [] as StockClosing[]) : Promise.resolve([] as StockClosing[]),
  ])
  const by = new Map<string, ReqSource>()
  for (const t of events) {
    const s = sign(t)
    if (!s || !t.partNo) continue
    const k = `${t.lpnId ?? t.lpnNo}|${t.partNo}`
    const src = by.get(k) ?? {
      lpnId: t.lpnId,
      lpnNo: t.lpnNo ?? '-',
      partNo: t.partNo,
      qty: 0,
      fromLoc: t.fromLoc ?? t.toLoc,
      grnNo: t.box?.grnNo ?? null,
      plRef: t.box?.plRef ?? null,
      invoiceNo: t.box?.invoiceNo ?? null,
      caseNo: t.box?.caseNo ?? null,
      reqNo: t.req?.reqNo ?? t.docNo ?? '-',
    }
    src.qty += s * (t.qty ?? 0)
    by.set(k, src)
  }
  return {
    type: 'req',
    req,
    fm005: req.reconciledBy ? (sameDay.find((r) => r.id === req.reconciledBy) ?? null) : null,
    subs,
    sources: [...by.values()].filter((s) => s.qty !== 0).sort((a, b) => a.partNo.localeCompare(b.partNo) || a.lpnNo.localeCompare(b.lpnNo)),
    closing: closingOf(closings, req.modelCode, req.docDate),
    others,
  }
}

export async function partTrace(api: WmsApi, master: MasterData, part: PartMaster): Promise<PartTrace> {
  // ทุกรายการจนถึงตอนนี้ (เผื่อนาฬิกาเครื่องช้ากว่าเซิร์ฟเวอร์ 1 วัน ไม่ให้รายการล่าสุดหลุด)
  const [lpns, rows] = await Promise.all([api.activeLpns(), api.ledgerRows([part.partNo], new Date(Date.now() + 86_400_000).toISOString())])
  const boxes = lpns
    .map((lpn) => ({ lpn, place: boxPlace(lpn, master.locations), qty: lpn.items.filter((i) => i.partNo === part.partNo).reduce((s, i) => s + i.qty, 0) }))
    .filter((b) => b.qty > 0)
    .sort((a, b) => a.lpn.createdAt.localeCompare(b.lpn.createdAt) || a.lpn.lpnNo.localeCompare(b.lpn.lpnNo))
  const byPlace: Record<BoxPlace, number> = { store: 0, staging: 0, mi3: 0, ng: 0, gone: 0 }
  for (const b of boxes) byPlace[b.place] += b.qty
  return { type: 'part', part, boxes, byPlace, rows: [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60) }
}

// ===== สายเอกสารสำหรับภาพ (ใบรับ) =====
export type StepKey = 'pl' | 'check' | 'grn' | 'invoice' | 'boxes' | 'issue' | 'fm005' | 'ledger'
export type StepTone = 'ok' | 'work' | 'warn' | 'bad' | 'none'

export interface ChainStep {
  key: StepKey
  title: string
  /** เลขเอกสาร (null = ไม่มีขั้นนี้) */
  code: string | null
  lines: string[]
  tone: StepTone
}

const INVOICE_STATUS: Record<InvoiceStatus, string> = { open: 'ยังไม่ปิด', complete: 'รับครบแล้ว', discrepancy_reported: 'แจ้งความต่างแล้ว', closed: 'ปิดแล้ว' }

export function closingText(c: ClosingRef | null): { text: string; tone: StepTone } {
  if (!c) return { text: 'ไม่มี Model', tone: 'none' }
  const r = c.row
  if (!r || r.status !== 'closed') return { text: r?.status === 'reopened' ? 'เปิดเดือนแก้ไขอยู่' : 'เดือนนี้ยังไม่ปิดยอด', tone: r?.status === 'reopened' ? 'warn' : 'none' }
  const acked = !!r.planningAt && !!r.accountAt
  return {
    text: acked ? 'ปิดยอดแล้ว · Planning / บัญชีรับทราบแล้ว' : `ปิดยอดแล้ว · รอรับทราบ${r.planningAt ? '' : ' Planning'}${r.accountAt ? '' : ' บัญชี'}`,
    tone: acked ? 'ok' : 'work',
  }
}

export function receiptSteps(t: ReceiptTrace): ChainStep[] {
  const plRef = t.grn?.plRef ?? t.check?.plRef ?? null
  const count = t.grn?.grnNo.startsWith('CNT-') ?? false
  const sum = t.checkLines.length ? checkSummary(t.checkLines) : null
  const counted = t.grnLines.reduce((s, l) => s + l.countedQty, 0)
  const damaged = t.grnLines.reduce((s, l) => s + (l.damagedQty ?? 0), 0)
  const off = t.invoice ? reconcile(t.invoice).filter((r) => r.diff !== 0).length : 0
  const live = t.boxes.filter((b) => b.place !== 'gone')
  const at = (p: BoxPlace) => t.boxes.filter((b) => b.place === p).length
  const issued = t.boxes.reduce((s, b) => s + b.issued, 0)
  const left = t.boxes.reduce((s, b) => s + b.now, 0)
  const reqs = t.reqs.filter((r) => !r.void && r.qty !== 0)
  const subs = reqs.filter((r) => r.kind === 'line')
  const lateSubs = subs.filter((r) => !r.reconciled)
  const close = closingText(t.closing)
  const boxLine = [
    at('store') && `ในช่อง ${at('store')}`,
    at('staging') && `รอจัดเก็บ ${at('staging')}`,
    at('mi3') && `MI3 ${at('mi3')}`,
    at('ng') && `NG ${at('ng')}`,
    at('gone') && `หมด/ปิด ${at('gone')}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return [
    {
      key: 'pl',
      title: count ? 'ใบตรวจนับ' : 'Packing List',
      code: plRef,
      lines: count ? ['กล่องใหม่จากยอดนับเกินระบบ'] : [t.grn?.packages ?? t.check?.packages ?? t.check?.title ?? 'เอกสารที่มากับรถ'].filter((s): s is string => !!s),
      tone: plRef ? 'ok' : 'none',
    },
    {
      key: 'check',
      title: 'ใบตรวจรับ',
      code: t.check?.checkNo ?? null,
      lines: !t.check
        ? [count ? 'ไม่ต้องตรวจรับ' : 'รับตรงไม่ผ่านใบตรวจรับ']
        : [
            t.check.status === 'open'
              ? `กำลังตรวจ ${sum?.checked ?? 0}/${sum?.lines ?? 0} บรรทัด`
              : t.check.status === 'done'
                ? 'ตรวจเสร็จ ออก GRN แล้ว'
                : `ยกเลิก: ${t.check.cancelReason ?? '-'}`,
            ...(sum?.issueLines ? [`ไม่ตรง PL ${sum.issueLines} บรรทัด`] : []),
          ],
      tone: !t.check ? 'none' : t.check.status === 'cancelled' ? 'bad' : t.check.status === 'open' ? 'work' : sum?.issueLines ? 'warn' : 'ok',
    },
    {
      key: 'grn',
      title: count ? 'เอกสารกล่องใหม่' : 'ใบรับสินค้า GRN',
      code: t.grn?.grnNo ?? null,
      lines: !t.grn
        ? ['ยังไม่ออก GRN']
        : t.grn.status === 'void'
          ? [`ยกเลิกแล้ว: ${t.grn.voidReason ?? '-'}`]
          : [
              `รับ ${fmt(counted)} ชิ้น · ${t.grnLines.length} รายการ`,
              ...(damaged ? [`เสียหาย → NG ${fmt(damaged)} ชิ้น`] : []),
              `${DAY(t.grn.receivedAt)}${t.grn.modelCode ? ` · ${t.grn.modelCode}` : ''}`,
            ],
      tone: !t.grn ? 'none' : t.grn.status === 'void' ? 'bad' : damaged ? 'warn' : 'ok',
    },
    {
      key: 'invoice',
      title: 'Invoice',
      code: t.invoice?.invoice.invoiceNo ?? t.grn?.invoiceNo ?? null,
      lines: !t.invoice
        ? [t.grn?.invoiceNo ? 'โหลด Invoice ไม่ได้' : 'ไม่มี Invoice']
        : [INVOICE_STATUS[t.invoice.invoice.status], off ? `ต่างจาก Invoice ${off} รายการ` : 'ยอดรับตรง Invoice'],
      tone: !t.invoice ? 'none' : off && t.invoice.invoice.status === 'open' ? 'warn' : t.invoice.invoice.status === 'open' ? 'work' : 'ok',
    },
    {
      key: 'boxes',
      title: 'กล่อง & ป้าย QR',
      code: t.boxes.length ? `${t.boxes.length} กล่อง` : null,
      lines: t.boxes.length ? [boxLine, `เหลือ ${fmt(left)} ชิ้น`] : ['ยังไม่มีกล่อง'],
      tone: !t.boxes.length ? 'none' : at('mi3') || at('staging') ? 'work' : at('ng') ? 'warn' : 'ok',
    },
    {
      key: 'issue',
      title: 'เบิกเข้าไลน์',
      code: reqs.length ? `${reqs.length} ใบเบิก` : null,
      lines: reqs.length
        ? [`เบิกไปแล้ว ${fmt(issued)} ชิ้น`, ...(subs.length ? [lateSubs.length ? `รอกระทบ FM-P-005 ${lateSubs.length} ใบ` : 'กระทบ FM-P-005 ครบ'] : [])]
        : [live.length ? 'ยังไม่ถูกเบิก' : 'ไม่มีการเบิก'],
      tone: !reqs.length ? 'none' : lateSubs.length ? 'work' : 'ok',
    },
    {
      key: 'ledger',
      title: 'บัญชีคุม FM-P-537',
      code: t.closing ? `${t.closing.model} ${t.closing.month}` : null,
      lines: [close.text],
      tone: close.tone,
    },
  ]
}

// ===== สายเอกสารสำหรับภาพ (ใบเบิก: ย้อนกลับไปหาที่มา) =====
const uniq = (list: (string | null)[]) => [...new Set(list.filter((x): x is string => !!x))]
const listed = (xs: string[], n = 3) => (xs.length > n ? `${xs.slice(0, n).join(', ')} +${xs.length - n}` : xs.join(', '))

export function reqSteps(t: ReqTrace): ChainStep[] {
  const r = t.req
  const pls = uniq(t.sources.map((s) => s.plRef))
  const grns = uniq(t.sources.map((s) => s.grnNo))
  const boxes = uniq(t.sources.map((s) => s.lpnNo))
  const qty = t.sources.reduce((s, x) => s + x.qty, 0)
  const close = closingText(t.closing)
  const fm =
    r.kind === 'fm005'
      ? { code: r.reqNo, lines: [`กระทบใบย่อย ${t.subs.length} ใบ`], tone: 'ok' as StepTone }
      : r.kind !== 'line'
        ? { code: null, lines: ['ไม่ต้องกระทบ (QC / NG)'], tone: 'none' as StepTone }
        : t.fm005
          ? { code: t.fm005.reqNo, lines: ['กระทบแล้ว', t.fm005.docNo ? `ใบ ${t.fm005.docNo}` : ''].filter(Boolean), tone: 'ok' as StepTone }
          : { code: null, lines: [r.status === 'void' ? 'ใบเบิกยกเลิกแล้ว' : 'รอกระทบตอนจบวัน'], tone: (r.status === 'void' ? 'none' : 'work') as StepTone }
  return [
    {
      key: 'pl',
      title: 'Packing List',
      code: pls.length ? listed(pls) : null,
      lines: pls.length ? [`${pls.length} ชุดที่ส่งมา`] : ['ไม่พบที่มา'],
      tone: pls.length ? 'ok' : 'none',
    },
    {
      key: 'grn',
      title: 'ใบรับสินค้า GRN',
      code: grns.length ? listed(grns) : null,
      lines: grns.length ? [`รับเข้า ${grns.length} ใบ`] : ['-'],
      tone: grns.length ? 'ok' : 'none',
    },
    {
      key: 'boxes',
      title: 'กล่องที่ตัดของ',
      code: boxes.length ? `${boxes.length} กล่อง` : null,
      lines: boxes.length ? [`ตัดจากกล่องรับเข้าก่อน (FIFO) ${fmt(qty)} ชิ้น`] : ['ไม่มีการตัดสต็อก'],
      tone: boxes.length ? 'ok' : 'none',
    },
    {
      key: 'issue',
      title: REQ_KIND[r.kind],
      code: r.reqNo,
      lines: [r.docNo ? `ใบ ${r.docNo}` : 'ไม่มีเลขใบกระดาษ', `${r.modelCode ?? '-'} · ${r.docDate}`, ...(r.status === 'void' ? ['ยกเลิกแล้ว'] : [])],
      tone: r.status === 'void' ? 'bad' : 'ok',
    },
    { key: 'fm005', title: 'FM-P-005', ...fm },
    { key: 'ledger', title: 'บัญชีคุม FM-P-537', code: t.closing ? `${t.closing.model} ${t.closing.month}` : null, lines: [close.text], tone: close.tone },
  ]
}
