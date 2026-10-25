import type { LedgerCol, LedgerRow, PartMaster } from './types'

/** 1 บรรทัดในบัญชีคุม FM-P-537 */
export interface LedgerLine {
  /** วันที่ (YYYY-MM-DD เวลาไทย) */
  date: string
  invNo: string | null
  orderNo: string | null
  docNo: string | null
  recv: number
  recvRep: number
  issue: number
  ng: number
  qc: number
  lot: string | null
  stock: number
  note: string | null
}

export interface LedgerSheet {
  partNo: string
  name: string
  uamCode: string | null
  opening: number
  lines: LedgerLine[]
  /** งานเข้า (รับปกติ + ทดแทน + ปรับเพิ่ม) */
  totalIn: number
  /** เบิกใช้ (เบิก + NG + QC + ปรับลด) */
  totalOut: number
  closing: number
}

const IN_COLS: LedgerCol[] = ['recv', 'recv_rep']
/** ผลต่อสต็อก: รับ/ปรับยอด = ตามเครื่องหมาย, เบิก/NG/QC = ลด */
export const ledgerDelta = (r: Pick<LedgerRow, 'col' | 'qty'>) => (IN_COLS.includes(r.col) || r.col === 'adj' ? r.qty : -r.qty)

export const bangkokDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' })

/** วันที่ลงบัญชีของรายการจากเอกสารลงวันที่ (ใบเบิก / FM-P-005): วันที่ในเอกสาร + เวลาที่บันทึก (เหมือน stock_ledger_entries 0023) */
export const onDocDate = (createdAt: string, docDate: string) =>
  new Date(Date.parse(createdAt) + Date.parse(`${docDate}T00:00:00Z`) - Date.parse(`${bangkokDay(createdAt)}T00:00:00Z`)).toISOString()

/** ตัวเลือกในหน้าบัญชีคุม: part ร่วมที่ระบุ Model ไม่ได้ (เช่น ของเกินจากการตรวจนับ) */
export const NO_MODEL = '-'

/** รายการที่เข้าบัญชีคุมของ Model นี้ (ตาม Model ของเอกสาร · part ร่วมไม่ซ้ำในหลาย Model) */
export const rowsOfModel = (rows: LedgerRow[], model: string) => rows.filter((r) => (model === NO_MODEL ? r.model === null : r.model === model))

/** part ที่ใช้มากกว่า 1 Model */
export const isShared = (p: Pick<PartMaster, 'models'>) => new Set(p.models).size > 1

/** เลื่อนวัน 'YYYY-MM-DD' ไป n วัน */
export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** ช่วงเดือน (เวลาไทย) ของ 'YYYY-MM' เป็น ISO สำหรับกรองรายการ */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: new Date(`${month}-01T00:00:00+07:00`).toISOString(), to: new Date(`${next}-01T00:00:00+07:00`).toISOString() }
}

/**
 * สร้างบัญชีคุมรายเดือนต่อ part จากรายการเคลื่อนไหวทั้งหมดก่อนสิ้นเดือน
 * ยกมา = ผลรวมก่อนต้นเดือน · รายการในเดือนรวมบรรทัดของเอกสารเดียวกันในวันเดียวกัน (เบิก FIFO หลายกล่อง = 1 บรรทัด)
 */
export function buildLedger(rows: LedgerRow[], parts: Pick<PartMaster, 'partNo' | 'name' | 'uamCode'>[], month: string): LedgerSheet[] {
  const { from, to } = monthRange(month)
  const t0 = Date.parse(from)
  const t1 = Date.parse(to)
  return parts.map((p) => {
    const own = rows.filter((r) => r.partNo === p.partNo).sort((a, b) => a.at.localeCompare(b.at))
    const before = own.filter((r) => Date.parse(r.at) < t0)
    const inMonth = own.filter((r) => Date.parse(r.at) >= t0 && Date.parse(r.at) < t1)
    const opening = before.reduce((s, r) => s + ledgerDelta(r), 0)

    const lines: LedgerLine[] = []
    const keys: string[] = []
    let stock = opening
    let totalIn = 0
    let totalOut = 0
    for (const r of inMonth) {
      const date = bangkokDay(r.at)
      const d = ledgerDelta(r)
      // บรรทัดเดียวกัน = วันเดียวกัน เอกสารเดียวกัน ช่องเดียวกัน ทิศเดียวกัน (ติดกัน)
      const key = `${date}|${r.docNo ?? ''}|${r.col}|${d >= 0 ? '+' : '-'}`
      let line = keys.at(-1) === key ? lines.at(-1)! : null
      if (!line) {
        line = { date, invNo: r.invNo, orderNo: r.orderNo, docNo: r.docNo, recv: 0, recvRep: 0, issue: 0, ng: 0, qc: 0, lot: r.lot, stock, note: r.note }
        lines.push(line)
        keys.push(key)
      }
      if (r.col === 'recv') line.recv += r.qty
      else if (r.col === 'recv_rep') line.recvRep += r.qty
      else if (r.col === 'ng') line.ng += r.qty
      else if (r.col === 'qc') line.qc += r.qty
      else if (r.col === 'adj') {
        // ปรับยอด: เพิ่ม = ลงช่องรับเข้า, ลด = ลงช่องเบิก
        if (d > 0) line.recv += d
        else line.issue += -d
        if (!line.note?.includes('ปรับยอด')) line.note = [line.note, 'ปรับยอด'].filter(Boolean).join(' · ')
      } else line.issue += r.qty // เบิก (คืน = ติดลบ)
      if (r.lot && !(line.lot ?? '').split(', ').includes(r.lot)) line.lot = [line.lot, r.lot].filter(Boolean).join(', ')
      stock += d
      line.stock = stock
      if (r.col === 'issue' || r.col === 'ng' || r.col === 'qc') totalOut -= d
      else if (d > 0) totalIn += d
      else totalOut -= d
    }
    return { partNo: p.partNo, name: p.name, uamCode: p.uamCode ?? null, opening, lines, totalIn, totalOut, closing: stock }
  })
}
