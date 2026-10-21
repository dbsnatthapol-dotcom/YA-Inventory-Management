import type { CheckLine, InvoiceLine } from './types'

/** ของไม่ตรงที่ตรวจพบ · ขาด/เกิน = จำนวนในเคสไม่ตรง Packing List */
export type LineIssue = 'short' | 'over' | 'missing' | 'extra' | 'damaged'

export const ISSUE_LABEL: Record<LineIssue, string> = {
  short: 'ขาด',
  over: 'เกิน',
  missing: 'ไม่มีมา',
  extra: 'ไม่มีใน PL',
  damaged: 'เสียหาย',
}

/** ปัญหาของบรรทัดที่ตรวจแล้ว (ยังไม่ตรวจ = ไม่มี) */
export function lineIssues(l: CheckLine): LineIssue[] {
  if (l.actualQty === null) return []
  const out: LineIssue[] = []
  if (l.extra) out.push('extra')
  else if (l.actualQty === 0 && l.plQty > 0) out.push('missing')
  else if (l.actualQty < l.plQty) out.push('short')
  else if (l.actualQty > l.plQty) out.push('over')
  if (l.damagedQty > 0) out.push('damaged')
  return out
}

export interface CaseGroup {
  caseNo: string
  lines: CheckLine[]
  checked: number
  issues: number
  /** todo = ยังไม่เริ่ม · partial = ตรวจไปบางบรรทัด · ok = ครบและตรง · issue = ครบแต่มีของไม่ตรง */
  state: 'todo' | 'partial' | 'ok' | 'issue'
}

const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

export const caseName = (caseNo: string) => (caseNo ? `เคส ${caseNo}` : 'ไม่ระบุเคส')

/** จัดบรรทัดเป็นเคส เรียงเลขเคสแบบคนอ่าน (Pallet-2 ก่อน Pallet-10) · บรรทัดที่ไม่ระบุเคสไว้ท้าย */
export function groupCases(lines: CheckLine[]): CaseGroup[] {
  const byCase = new Map<string, CheckLine[]>()
  for (const l of lines) byCase.set(l.caseNo, [...(byCase.get(l.caseNo) ?? []), l])
  return [...byCase.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : natural.compare(a, b)))
    .map(([caseNo, list]) => {
      const sorted = [...list].sort((a, b) => a.lineNo - b.lineNo)
      const checked = sorted.filter((l) => l.actualQty !== null).length
      const issues = sorted.filter((l) => lineIssues(l).length > 0).length
      const state = checked === 0 ? 'todo' : checked < sorted.length ? 'partial' : issues ? 'issue' : 'ok'
      return { caseNo, lines: sorted, checked, issues, state }
    })
}

export interface CheckSummary {
  lines: number
  checked: number
  cases: number
  casesDone: number
  /** จำนวนบรรทัดต่อปัญหา */
  issues: Record<LineIssue, number>
  /** บรรทัดที่มีปัญหาอย่างน้อย 1 อย่าง */
  issueLines: number
  plQty: number
  /** รวมเฉพาะบรรทัดที่ตรวจแล้ว */
  actualQty: number
  damagedQty: number
}

export function checkSummary(lines: CheckLine[]): CheckSummary {
  const issues: Record<LineIssue, number> = { short: 0, over: 0, missing: 0, extra: 0, damaged: 0 }
  let issueLines = 0
  for (const l of lines) {
    const found = lineIssues(l)
    if (found.length) issueLines++
    for (const i of found) issues[i]++
  }
  const cases = groupCases(lines)
  return {
    lines: lines.length,
    checked: lines.filter((l) => l.actualQty !== null).length,
    cases: cases.length,
    casesDone: cases.filter((c) => c.checked === c.lines.length).length,
    issues,
    issueLines,
    plQty: lines.reduce((s, l) => s + l.plQty, 0),
    actualQty: lines.reduce((s, l) => s + (l.actualQty ?? 0), 0),
    damagedQty: lines.reduce((s, l) => s + l.damagedQty, 0),
  }
}

export interface PartCompare {
  partNo: string
  description: string | null
  pl: number
  /** null = ยังตรวจไม่ครบทุกบรรทัดของ part นี้ */
  actual: number | null
  /** null = Invoice ไม่มีรายการของ part นี้ (หรือไม่มีรายการเลย) */
  invoice: number | null
}

/** เทียบต่อ part: ยอด PL รวม · นับได้รวม · Invoice รวม (Invoice 1 บรรทัดอาจครอบหลายเคส) */
export function compareParts(lines: CheckLine[], invoice: InvoiceLine[]): PartCompare[] {
  const parts = new Map<string, PartCompare & { open: boolean }>()
  for (const l of lines) {
    const p = parts.get(l.partNo) ?? { partNo: l.partNo, description: l.description, pl: 0, actual: 0, invoice: null, open: false }
    p.pl += l.plQty
    if (l.actualQty === null) p.open = true
    else p.actual = (p.actual ?? 0) + l.actualQty
    parts.set(l.partNo, p)
  }
  for (const i of invoice) {
    const p = parts.get(i.partNo) ?? { partNo: i.partNo, description: i.description, pl: 0, actual: 0, invoice: null, open: false }
    p.invoice = (p.invoice ?? 0) + i.qty
    parts.set(i.partNo, p)
  }
  return [...parts.values()].map(({ open, ...p }) => ({ ...p, actual: open ? null : p.actual }))
}

/** part ที่นับได้ไม่ตรง Invoice (นับครบแล้วเท่านั้น) */
export const offInvoice = (rows: PartCompare[]) => rows.filter((r) => r.invoice !== null && r.actual !== null && r.actual !== r.invoice)
