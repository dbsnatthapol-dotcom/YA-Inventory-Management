import type { InvoiceView, MasterData, Tx } from './types'

export const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toLocaleString('en-US'))

/** แปลงข้อความจากการสแกน (ลิงก์ .../t/LPN-2610-000001 หรือรหัสเปล่า) เป็นเลข LPN */
export function lpnFromScan(text: string): string {
  const t = text.trim()
  const m = t.match(/LPN-\d{4}-\d{4,}/i)
  return (m ? m[0] : t).toUpperCase()
}

/** ลิงก์ที่ฝังใน QR: เปิดแล้วไปหน้าสแกนของป้ายนั้น (ต้อง login ก่อน) */
export const lpnUrl = (lpnNo: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/t/${lpnNo}`

/** รหัสโซนจากรหัสช่อง: RK-C-01-1 → RK-C */
export const zoneCodeOfLoc = (loc: string) => {
  const p = loc.split('-')
  return p.length >= 3 ? p.slice(0, 2).join('-') : loc
}

/** กลุ่ม part ที่ต้องตรวจ MI3: Model ที่ต้องตรวจ และ part อยู่ในกลุ่มที่ตั้งไว้ (ค่าเริ่มต้น RIM, HUB) */
export function needsQi(master: MasterData, qiTypes: string[], modelCode: string, partNo: string) {
  const model = master.models.find((m) => m.code === modelCode)
  const type = master.parts.find((p) => p.partNo === partNo)?.type
  return !!type && (model?.requiresInspection ?? true) && qiTypes.includes(type)
}

/** โซนที่จะแนะนำตามกฎ (ลูกค้า + กลุ่ม part) — ช่องจริงเลือกตอนยืนยัน */
export function suggestedZone(master: MasterData, customerId: string | undefined, partNo: string): string | null {
  const type = master.parts.find((p) => p.partNo === partNo)?.type ?? null
  const rule =
    master.rules.find((r) => r.customerId === customerId && r.partType === type) ?? master.rules.find((r) => r.customerId === customerId && r.partType === null)
  return rule?.zoneId ?? null
}

export interface ReconRow {
  lineNo: number | null
  partNo: string
  description: string | null
  invoiceQty: number | null
  receivedQty: number
  diff: number
}

/**
 * กระทบยอด: invoice เทียบยอดรับจริงรวมทุกเที่ยว (จับคู่ด้วย Part No.)
 * part เดียวกันหลายบรรทัด: แบ่งยอดรับให้ทีละบรรทัดตามลำดับ (ไม่เกินยอดบรรทัด) · บรรทัดสุดท้ายของ part รับส่วนที่เหลือทั้งหมด
 */
export function reconcile(view: InvoiceView): ReconRow[] {
  const got = new Map(view.received.map((r) => [r.partNo, r.qty]))
  const last = new Map(view.lines.map((l, i) => [l.partNo, i]))
  const rows: ReconRow[] = view.lines.map((l, i) => {
    const left = got.get(l.partNo) ?? 0
    const r = last.get(l.partNo) === i ? left : Math.min(left, l.qty)
    got.set(l.partNo, left - r)
    return { lineNo: l.lineNo, partNo: l.partNo, description: l.description, invoiceQty: l.qty, receivedQty: r, diff: r - l.qty }
  })
  for (const [partNo, qty] of got) if (!last.has(partNo)) rows.push({ lineNo: null, partNo, description: 'ไม่มีใน Invoice', invoiceQty: null, receivedQty: qty, diff: qty })
  return rows
}

export function discrepancyText(view: InvoiceView, rows: ReconRow[]): string {
  const off = rows.filter((r) => r.diff !== 0)
  const pad = (s: string, n: number) => s.padEnd(n)
  return [
    'เรื่อง: แจ้งผลกระทบยอดสินค้ารับเข้า เทียบ Invoice',
    `Invoice ${view.invoice.invoiceNo}${view.invoice.poNo ? ` · PO ${view.invoice.poNo}` : ''}${view.invoice.docDate ? ` · ลงวันที่ ${view.invoice.docDate}` : ''}`,
    `รับจริงตาม ${view.grns.map((g) => `${g.grnNo} (PL ${g.plRef}, ${new Date(g.receivedAt).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })})`).join(', ') || '-'}`,
    '',
    'บรรทัด | Part No.    | Invoice | รับจริง | ต่าง',
    ...off.map((r) => `${pad(String(r.lineNo ?? '-'), 6)} | ${pad(r.partNo, 11)} | ${String(r.invoiceQty ?? '-').padStart(7)} | ${String(r.receivedQty).padStart(7)} | ${r.diff > 0 ? '+' : ''}${r.diff}`),
    '',
    off.length ? `รวม ${off.length} รายการที่ไม่ตรง · รบกวนตรวจสอบและออก Invoice ฉบับแก้ไข` : 'ทุกรายการตรงกับ Invoice',
    'Union Autoparts Manufacturing · แผนกคลังสินค้า',
  ].join('\n')
}

export const TX_LABEL: Record<Tx['kind'], string> = {
  RECEIVE: 'รับเข้า',
  PUT: 'จัดเก็บ',
  MOVE: 'ย้ายที่',
  ISSUE: 'เบิก',
  ADJ: 'แก้ไขยอด',
  COUNT: 'ตรวจนับ',
  QI: 'ผล MI3',
  MERGE: 'รวมกล่อง',
  UNMERGE: 'ยกเลิกการรวม',
  SPLIT: 'แยกกล่อง',
  RETURN: 'คืนเข้าสต็อก',
}

export function txSummary(t: Tx): string {
  switch (t.kind) {
    case 'RECEIVE':
      return `${t.partNo} ${fmt(t.qty)} → ${t.toLoc}`
    case 'PUT':
    case 'MOVE':
      return `${t.fromLoc} → ${t.toLoc}`
    case 'ISSUE':
      return `${t.partNo} −${fmt(t.qty)}${t.ref ? ` · ${t.ref}` : ''}${t.toLoc ? ` · ${t.toLoc}` : ''}`
    case 'ADJ':
      return `${t.partNo} ${fmt(t.qty)} → ${fmt(t.newQty)} · ${t.reason ?? ''}`
    case 'COUNT':
      return `${t.partNo ? `${t.partNo} ` : ''}นับได้ ${fmt(t.newQty)} · ระบบ ${fmt(t.qty)}${t.newQty !== t.qty ? ' (ไม่ตรง)' : ''}`
    case 'QI':
      return `${t.partNo} ผ่าน ${fmt(t.passQty)} · NG ${fmt(t.ngQty)}`
    case 'MERGE':
      return `รวม ${t.ref ?? ''}`
    case 'UNMERGE':
      return `คืนป้ายเดิม ${t.ref ?? ''}`
    case 'SPLIT':
      return `→ ${t.docNo ?? ''} · ${t.ref ?? ''}`
    case 'RETURN':
      return `${t.partNo} +${fmt(t.qty)}${t.ref ? ` · ${t.ref}` : ''}`
  }
}
