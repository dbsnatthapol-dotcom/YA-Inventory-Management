import type { InvoiceLine } from './types'

/** บรรทัดที่จัดแล้ว: มีคำอธิบายเสมอ (ว่างได้) */
export type TidyInvoiceLine = InvoiceLine & { description: string }

interface LineIn {
  lineNo?: number | null
  partNo: string
  description?: string | null
  qty: number
}

/**
 * บรรทัด Invoice ไม่ซ้ำ (กติกาเดียวกับ check_inv_lines ใน 0022):
 * ซ้ำทุกอย่าง (เลขบรรทัด + part + จำนวน) เก็บบรรทัดแรก · ไม่มีเลขบรรทัด หรือเลขชนกับบรรทัดอื่น ⇒ ให้เลขต่อจากเลขสูงสุด
 */
export function tidyInvoiceLines(lines: LineIn[], canon: (partNo: string) => string = (p) => p.trim().toUpperCase()): TidyInvoiceLine[] {
  const valid = lines.filter((l) => l.partNo.trim())
  let max = Math.max(0, ...valid.map((l) => l.lineNo ?? 0))
  const seen = new Set<string>()
  const used = new Set<number>()
  const out: TidyInvoiceLine[] = []
  for (const l of valid) {
    const partNo = canon(l.partNo)
    const qty = Math.max(0, Number(l.qty) || 0)
    const key = `${l.lineNo ?? '-'}|${partNo}|${qty}`
    if (seen.has(key)) continue
    seen.add(key)
    let lineNo = l.lineNo ?? null
    if (lineNo === null || used.has(lineNo)) lineNo = ++max
    used.add(lineNo)
    out.push({ lineNo, partNo, description: l.description ?? '', qty })
  }
  return out
}

/**
 * หน้ารับของ: ยอด Invoice เป็นยอดทั้ง Invoice ของ part (ไม่ใช่รายเคส) เก็บไว้ทุกแถว (ทุกเคส) ของ part นั้น
 * ⇒ ส่งบรรทัด Invoice ครั้งเดียวต่อ part: ยอดจากแถวแรกที่มียอด · เลขบรรทัดแรกที่มีของ part นั้น
 */
export function invoiceLinesFromRows(rows: { partNo: string; description: string; invQty: number | null; invLine: number | null }[]): TidyInvoiceLine[] {
  const once = new Map<string, LineIn>()
  for (const r of rows) {
    const part = r.partNo.trim().toUpperCase()
    if (!part || r.invQty === null) continue
    const cur = once.get(part)
    if (!cur) once.set(part, { lineNo: r.invLine, partNo: part, description: r.description, qty: r.invQty })
    else if (cur.lineNo == null) cur.lineNo = r.invLine
  }
  return tidyInvoiceLines([...once.values()])
}
