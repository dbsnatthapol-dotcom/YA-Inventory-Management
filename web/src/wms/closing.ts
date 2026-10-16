import type { LedgerSheet } from './ledger'
import type { Perm, StockClosing } from './types'

export const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)
/** วันแรกที่ปิดยอดเดือนนั้นได้ (d/mm/yyyy) */
export const nextMonthStart = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `1/01/${y + 1}` : `1/${String(mo + 1).padStart(2, '0')}/${y}`
}

/** ปิดยอดที่รอผู้ใช้คนนี้กดรับทราบ (ตามสิทธิ์ Planning / บัญชี) */
export const pendingAcks = (closings: StockClosing[], can: (p: Perm) => boolean) =>
  closings.filter((c) => c.status === 'closed' && ((can('ledger.ack.planning') && !c.planningAt) || (can('ledger.ack.account') && !c.accountAt)))

/** part ที่ยอดปัจจุบันต่างจากตอนปิด (มีรายการย้อนหลังหลังปิด) */
export function closingDiffs(c: StockClosing, sheets: LedgerSheet[]) {
  const now = new Map(sheets.map((s) => [s.partNo, s.closing]))
  return c.totals.filter((t) => (now.get(t.partNo) ?? 0) !== t.closing).map((t) => ({ partNo: t.partNo, closed: t.closing, now: now.get(t.partNo) ?? 0 }))
}

