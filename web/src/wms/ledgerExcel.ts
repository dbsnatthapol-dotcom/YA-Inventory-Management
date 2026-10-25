import type { Borders, Workbook, Worksheet } from 'exceljs'
import { brandHeader, brandLogo } from './excelBrand'
import type { LedgerSheet } from './ledger'
import type { PartMaster, Requisition, StockClosing } from './types'

/**
 * Export Excel: บัญชีคุม FM-P-537 (1 ไฟล์ต่อ Model, sheet สรุป + 1 sheet ต่อ part ตามแบบฟอร์มเดิม)
 * และสรุปยอดเบิก FM-P-005 ส่ง Planning · โหลด exceljs เฉพาะตอนกด Export
 */

const THIN: Partial<Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
}
const NUM = '#,##0;[Red]-#,##0;""'
const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

/** 'YYYY-MM' → 'ตุลาคม 2569' */
export const monthLabel = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS_TH[m - 1]} ${y + 543}`
}
/** 'YYYY-MM-DD' → '15/10/26' (แบบที่เขียนในเอกสาร) */
const shortDate = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '')
/** วันเวลาไทยแบบสั้น */
const stamp = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }) : '')

/** ชื่อ sheet ต้องไม่มี / \ ? * [ ] : และยาวไม่เกิน 31 ตัว ไม่ซ้ำ */
function sheetName(wb: Workbook, raw: string) {
  const base = raw.replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Part'
  let name = base
  for (let i = 2; wb.getWorksheet(name); i++) name = `${base.slice(0, 28)}~${i}`
  return name
}

export function saveWorkbook(wb: Workbook, filename: string) {
  return wb.xlsx.writeBuffer().then((buf) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}

const box = (ws: Worksheet, from: string, to: string) => {
  const [c1, r1] = [from.charCodeAt(0), Number(from.slice(1))]
  const [c2, r2] = [to.charCodeAt(0), Number(to.slice(1))]
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(`${String.fromCharCode(c)}${r}`).border = THIN
}

/** 1 sheet ตามแบบ FM-P-537: หัวกระดาษ, ตารางรับ/เบิก, สรุปสิ้นเดือน */
function partSheet(wb: Workbook, model: string, month: string, s: LedgerSheet, logoId: number | null) {
  const ws = wb.addWorksheet(sheetName(wb, s.partNo), { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.columns = [10, 14, 14, 16, 10, 10, 10, 8, 9, 18, 12].map((width) => ({ width }))
  brandHeader(ws, 'K', logoId, 'บัญชีคุมสินค้า FM-P-537')
  ws.mergeCells('A3:K3')
  ws.getCell('A3').value = `STOCK PARTS ${model}   ${monthLabel(month)}`
  ws.getCell('A3').font = { bold: true, size: 14 }
  ws.getCell('A3').alignment = { horizontal: 'center' }
  ws.mergeCells('A4:K4')
  ws.getCell('A4').value = `PART : ${s.partNo}   ${s.name}${s.uamCode ? `   (UAM ${s.uamCode})` : ''}`
  ws.getCell('A4').font = { bold: true, size: 12 }

  const head: [string, string, string?][] = [
    ['A6', 'Date'],
    ['B6', 'เลขที่'],
    ['B7', 'INV.'],
    ['C6', 'วันที่'],
    ['C7', 'Order  No.'],
    ['D6', 'เลขที่ใบเบิก'],
    ['E6', 'รับเข้า'],
    ['E7', 'ปกติ'],
    ['F7', 'ทดแทน'],
    ['G6', 'เบิก'],
    ['H6', 'NG'],
    ['I6', 'QC เบิก'],
    ['J6', 'LOT'],
    ['K6', 'Stock'],
    ['K7', '(Pcs.)'],
  ]
  for (const m of ['A6:A7', 'D6:D7', 'E6:F6', 'G6:G7', 'H6:H7', 'I6:I7', 'J6:J7']) ws.mergeCells(m)
  for (const [cell, text] of head) {
    const c = ws.getCell(cell)
    c.value = text
    c.font = { bold: true }
    c.alignment = { horizontal: 'center', vertical: 'middle' }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF4FA' } }
  }
  box(ws, 'A6', 'K7')

  ws.getCell('A8').value = 'Stock  ยกมา'
  ws.getCell('A8').font = { bold: true }
  ws.getCell('K8').value = s.opening
  let row = 9
  for (const l of s.lines) {
    const r = ws.getRow(row++)
    r.values = [
      shortDate(l.date),
      l.invNo ?? '',
      l.orderNo ?? '',
      l.docNo ?? '',
      l.recv || null,
      l.recvRep || null,
      l.issue || null,
      l.ng || null,
      l.qc || null,
      l.lot ?? '',
      l.stock,
    ]
    if (l.note) r.getCell(12).value = l.note
  }
  const last = Math.max(row - 1, 8)
  box(ws, 'A8', `K${last}`)
  for (let r = 8; r <= last; r++) for (const c of ['E', 'F', 'G', 'H', 'I', 'K']) ws.getCell(`${c}${r}`).numFmt = NUM

  // สรุปสิ้นเดือน
  const f = last + 2
  ws.mergeCells(`A${f}:B${f}`)
  ws.getCell(`A${f}`).value = ' ณ  สิ้นเดือน'
  ;(['Stock ยกมา', 'งานเข้า', 'เบิกใช้', 'คงเหลือ'] as const).forEach((t, i) => {
    const c = ws.getCell(f, 3 + i)
    c.value = t
    c.font = { bold: true }
    c.alignment = { horizontal: 'center' }
  })
  ws.mergeCells(`A${f + 1}:B${f + 1}`)
  ws.getCell(`A${f + 1}`).value = 'ยอดรวมทั้งหมด'
  ;[s.opening, s.totalIn, s.totalOut, s.closing].forEach((v, i) => {
    const c = ws.getCell(f + 1, 3 + i)
    c.value = v
    c.numFmt = NUM
    c.font = { bold: true }
  })
  box(ws, `A${f}`, `F${f + 1}`)
  ws.getCell(`A${f + 3}`).value = 'FM-P-537'
  ws.getCell(`K${f + 3}`).value = 'Rev.:01'
  ws.getCell(`A${f + 4}`).value = `ออกจากระบบ ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`
  ws.getCell(`A${f + 4}`).font = { size: 9, color: { argb: 'FF64748B' } }
}

/** บัญชีคุม FM-P-537 ของ Model ทั้งเดือน: sheet สรุป + 1 sheet ต่อ part */
export async function exportLedger(model: string, month: string, sheets: LedgerSheet[], closing?: StockClosing | null) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  wb.creator = 'UAM WMS'
  const sum = wb.addWorksheet('สรุป')
  sum.columns = [
    { header: 'Part No.', width: 16 },
    { header: 'รหัส UAM', width: 12 },
    { header: 'รายการ', width: 36 },
    { header: 'ยกมา', width: 11 },
    { header: 'งานเข้า', width: 11 },
    { header: 'เบิกใช้', width: 11 },
    { header: 'คงเหลือ', width: 11 },
  ]
  sum.spliceRows(1, 0, [], [], [`บัญชีคุมสินค้า ${model} · ${monthLabel(month)} (FM-P-537)`], [])
  const logoId = await brandLogo(wb)
  brandHeader(sum, 'G', logoId)
  sum.mergeCells('A3:G3')
  sum.getCell('A3').font = { bold: true, size: 14 }
  sum.getRow(5).font = { bold: true }
  for (const s of sheets) sum.addRow([s.partNo, s.uamCode ?? '', s.name, s.opening, s.totalIn, s.totalOut, s.closing])
  box(sum, 'A5', `G${5 + sheets.length}`)
  for (let r = 6; r <= 5 + sheets.length; r++) for (const c of ['D', 'E', 'F', 'G']) sum.getCell(`${c}${r}`).numFmt = NUM
  // ลายเซ็นในระบบ: ปิดยอด / Planning / บัญชี รับทราบ
  sum.addRow([])
  const signed = (by: string | null, at: string | null) => (by ? `${by} · ${stamp(at)}` : 'ยังไม่รับทราบ')
  for (const [k, v] of closing?.status === 'closed'
    ? [
        ['ปิดยอดโดย', signed(closing.closedBy, closing.closedAt)],
        ['Planning รับทราบ', signed(closing.planningBy, closing.planningAt)],
        ['บัญชี รับทราบ', signed(closing.accountBy, closing.accountAt)],
      ]
    : [['สถานะ', 'ยังไม่ปิดยอด (ตัวเลขอาจเปลี่ยน)']])
    sum.addRow([k, '', v]).getCell(1).font = { bold: true }
  for (const s of sheets) partSheet(wb, model, month, s, logoId)
  await saveWorkbook(wb, `FM-P-537_${model}_${month}.xlsx`)
}

/** สรุป FM-P-005 ส่ง Planning: 1 แถวต่อ part ต่อใบ */
export async function exportPlanning(fm: Requisition[], parts: PartMaster[], from: string, to: string) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet('สรุปเบิก FM-P-005')
  ws.columns = [12, 12, 10, 8, 16, 12, 34, 12, 12, 10, 12].map((width) => ({ width }))
  ws.addRow([])
  ws.addRow([])
  brandHeader(ws, 'K', await brandLogo(wb))
  ws.addRow([`สรุปยอดเบิกตาม FM-P-005 ส่ง Planning · ${from === to ? from : `${from} ถึง ${to}`}`])
  ws.mergeCells('A3:K3')
  ws.getCell('A3').font = { bold: true, size: 14 }
  ws.addRow([])
  const header = ws.addRow(['วันที่', 'เลขที่ FM-P-005', 'Model', 'จำนวนวง', 'Part No.', 'รหัส UAM', 'รายการ', 'รวมใบย่อย', 'FM-P-005', 'ส่วนต่าง', 'คงเหลือ'])
  header.font = { bold: true }
  const name = new Map(parts.map((p) => [p.partNo, p]))
  for (const r of fm)
    for (const l of r.lines)
      ws.addRow([shortDate(r.docDate), r.docNo ?? '', r.modelCode ?? '', r.fgQty ?? '', l.partNo, name.get(l.partNo)?.uamCode ?? '', name.get(l.partNo)?.name ?? '', l.reqQty ?? 0, l.qty, l.qty - (l.reqQty ?? 0), l.balance ?? ''])
  box(ws, 'A5', `K${ws.rowCount}`)
  for (let r = 6; r <= ws.rowCount; r++) for (const c of ['H', 'I', 'J', 'K']) ws.getCell(`${c}${r}`).numFmt = NUM
  await saveWorkbook(wb, `FM-P-005_Planning_${from}${from === to ? '' : `_${to}`}.xlsx`)
}
