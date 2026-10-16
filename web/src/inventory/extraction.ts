import { MODELS, PARTS, SAMPLE_INVOICES, ZONE_RULES } from './masterData'
import { basePartNo, canonPartNo } from '../wms/partCodes'
import type { ExtractedInvoice, Part } from './types'

/**
 * ตัวอ่าน invoice: ตอนนี้ใช้แบบจำลอง ภายหลังสลับเป็น Qwen-VL ผ่าน Supabase Edge Function
 * (supabase/functions/extract-invoice) โดยไม่ต้องแก้หน้าจอ เพราะคืนค่ารูปแบบเดียวกัน
 */
export interface InvoiceReader {
  read(image: File | null, sampleKey?: keyof typeof SAMPLE_INVOICES): Promise<ExtractedInvoice>
}

export const mockInvoiceReader: InvoiceReader = {
  async read(_image, sampleKey = 'k1g') {
    await new Promise((r) => setTimeout(r, 600)) // จำลองเวลาที่ AI ใช้อ่านภาพ
    return { ...structuredClone(SAMPLE_INVOICES[sampleKey]), provider: 'mock' }
  },
}

/** ปรับรหัสให้เทียบกันได้: ตัวพิมพ์ใหญ่, ตัดช่องว่าง, แก้ตัวอักษรที่ OCR สับสนบ่อย (O→0, I/L→1) */
export function normalizePartNo(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

export type MatchStatus = 'exact' | 'corrected' | 'unknown'

export interface MatchedLine {
  readPartNo: string
  description: string
  qty: number
  status: MatchStatus
  part: Part | null
  /** ข้อความอธิบายให้พนักงานตรวจ */
  message: string
  zoneId: string | null
  /** part นี้ใช้กับ Model ของ invoice หรือไม่ */
  modelMismatch: boolean
}

/** เทียบรหัสที่อ่านได้กับ Part Master */
export function matchPart(readPartNo: string, parts: Part[] = PARTS): { status: MatchStatus; part: Part | null } {
  // revision (/A /B) ไม่นับ: RAT00586/B ตรงกับ RAT00586
  const canon = canonPartNo(parts, readPartNo)
  const exact = parts.find((p) => p.partNo === canon)
  if (exact) return { status: 'exact', part: exact }
  const norm = normalizePartNo(basePartNo(readPartNo))
  const normalized = parts.find((p) => normalizePartNo(basePartNo(p.partNo)) === norm)
  if (normalized) return { status: 'corrected', part: normalized }
  const near = parts
    .map((p) => ({ p, d: editDistance(normalizePartNo(basePartNo(p.partNo)), norm) }))
    .sort((a, b) => a.d - b.d)[0]
  if (near && near.d <= 1) return { status: 'corrected', part: near.p }
  return { status: 'unknown', part: null }
}

/** แนะนำโซนตามกฎ ลูกค้า + กลุ่มสินค้า แล้วจึงใช้ค่าเริ่มต้นของลูกค้า */
export function suggestZone(part: Part): string | null {
  return (
    ZONE_RULES.find((r) => r.customerId === part.customerId && r.type === part.type)?.zoneId ??
    ZONE_RULES.find((r) => r.customerId === part.customerId && r.type === null)?.zoneId ??
    null
  )
}

export function matchInvoice(invoice: ExtractedInvoice): MatchedLine[] {
  return invoice.lines.map((line) => {
    const { status, part } = matchPart(line.partNo)
    const modelMismatch = !!part && !part.models.includes(invoice.model)
    const message =
      status === 'exact'
        ? 'ตรงกับ Master'
        : status === 'corrected'
          ? `อ่านได้ "${line.partNo}" ระบบแก้เป็น ${part!.partNo} — กรุณายืนยัน`
          : `ไม่พบ "${line.partNo}" ใน Master — เลือก part ที่ถูกต้องก่อนรับเข้า`
    return {
      readPartNo: line.partNo,
      description: line.description,
      qty: line.qty,
      status,
      part,
      message: modelMismatch ? `${message} · part นี้ไม่ได้ใช้กับ Model ${invoice.model}` : message,
      zoneId: part ? suggestZone(part) : null,
      modelMismatch,
    }
  })
}

export const modelRequiresInspection = (model: string) => MODELS.find((m) => m.code === model)?.requiresInspection ?? true
