import { BRAND_ROWS, brandHeader, brandLogo } from './excelBrand'
import { saveWorkbook } from './ledgerExcel'
import { BOM_HEADERS, PART_HEADERS } from './masterImport'
import { COUNT_HEADERS } from './stockImport'
import { partsOfModel } from './partCodes'
import type { MasterData } from './types'

/** แบบฟอร์ม Part: ข้อมูลปัจจุบันทั้งหมด ให้เติมรหัส UAM แล้วอัปโหลดกลับ */
export async function downloadPartTemplate(master: MasterData) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const logoId = await brandLogo(wb)
  const ws = wb.addWorksheet('Part')
  ws.columns = [16, 12, 44, 12, 26].map((width) => ({ width }))
  top(ws, 'E', logoId, 'แบบฟอร์มนำเข้า Part / รหัส UAM')
  ws.addRow(PART_HEADERS).font = { bold: true }
  for (const p of [...master.parts].sort((a, b) => a.partNo.localeCompare(b.partNo)))
    ws.addRow([p.partNo, p.uamCode ?? '', p.name, p.type ?? '', p.models.join(', ')])
  ws.views = [{ state: 'frozen', ySplit: BRAND_ROWS + 1 }]
  howTo(wb, [
    'Part No. ใช้เลขฐาน (RAT00586) · พิมพ์ /B มาก็ได้ ระบบตัด revision ออกเอง',
    'รหัส UAM = รหัสภายในในใบเบิกย่อยของ MRA (ตัวเลข เช่น 2011409) · 1 รหัสต่อ 1 part',
    'ช่องที่เว้นว่าง = ใช้ค่าเดิมในระบบ · Model ในไฟล์จะเพิ่มเข้าไป (ไม่ถอดของเดิม)',
    'เพิ่ม part ใหม่ได้ โดยใส่ Part No. + ชื่อ + Model',
  ])
  await saveWorkbook(wb, 'UAM_Part_Template.xlsx')
}

/** แบบฟอร์ม BOM: ชุดเดิม (ถ้ามี) + รายการ part แยกตาม Model ให้คัดลอกรหัส */
export async function downloadBomTemplate(master: MasterData) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const logoId = await brandLogo(wb)
  const ws = wb.addWorksheet('BOM')
  ws.columns = [16, 36, 10, 22, 14].map((width) => ({ width }))
  top(ws, 'E', logoId, 'แบบฟอร์มนำเข้า BOM ชุดวงล้อ')
  ws.addRow(BOM_HEADERS).font = { bold: true }
  for (const f of master.fgItems.filter((x) => x.active)) for (const l of f.lines) ws.addRow([f.code, f.name, f.modelCode ?? '', l.partNo, l.qtyPer])
  ws.views = [{ state: 'frozen', ySplit: BRAND_ROWS + 1 }]
  const ref = wb.addWorksheet('Part ตาม Model')
  ref.columns = [10, 16, 12, 12, 44].map((width) => ({ width }))
  top(ref, 'E', logoId, 'รายการ part แยกตาม Model (อ้างอิง)')
  ref.addRow(['Model', 'Part No.', 'รหัส UAM', 'กลุ่ม', 'รายการ']).font = { bold: true }
  for (const m of master.models) for (const p of partsOfModel(master, m.code)) ref.addRow([m.code, p.partNo, p.uamCode ?? '', p.type ?? '', p.name])
  ref.views = [{ state: 'frozen', ySplit: BRAND_ROWS + 1 }]
  howTo(wb, [
    '1 ชุดวงล้อ (FG) ใช้หลายแถว: แถวละ 1 part พร้อมจำนวนต่อ 1 วง (เช่น ลูกปืน 2, ซี่ลวด 9)',
    'รหัสชุดใช้รหัส FG ในใบเบิก เช่น 2019333 · ชื่อชุดและ Model ใส่แถวแรกของชุดก็พอ',
    'ช่อง Part ใส่ Part No. หรือรหัส UAM ก็ได้ (ดูรหัสได้ที่ sheet "Part ตาม Model")',
    'ชุดที่อยู่ในไฟล์ = BOM ครบชุด · part ที่ไม่อยู่ในไฟล์จะถูกเอาออกจากชุดนั้น',
  ])
  await saveWorkbook(wb, 'UAM_BOM_Template.xlsx')
}

/** แถวหัวบริษัท (หัวตารางอยู่แถวถัดไป · ตอนอ่านกลับระบบหาแถวหัวตารางเอง) */
function top(ws: import('exceljs').Worksheet, lastCol: string, logoId: number | null, title: string) {
  for (let i = 0; i < BRAND_ROWS; i++) ws.addRow([])
  brandHeader(ws, lastCol, logoId, title)
}

function howTo(wb: import('exceljs').Workbook, lines: string[]) {
  const ws = wb.addWorksheet('วิธีกรอก')
  ws.getColumn(1).width = 100
  ws.addRow(['วิธีกรอก']).font = { bold: true, size: 13 }
  for (const l of lines) ws.addRow([`• ${l}`])
}

/** อ่าน sheet แรกของไฟล์เป็นตาราง (ข้อความตามที่เห็นในเซลล์) */
export async function readSheetRows(file: File): Promise<string[][]> {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) return []
  const rows: string[][] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = []
    for (let c = 1; c <= Math.max(5, row.cellCount); c++) cells.push(row.getCell(c).text ?? '')
    rows[n - 1] = cells
  })
  return Array.from(rows, (r) => r ?? [])
}

/** แบบฟอร์มตรวจนับ: ยอดในระบบรายช่อง/โซน ให้กรอกช่อง "นับได้" (เว้นว่าง = ไม่ได้นับ, 0 = ไม่มีของ) */
export async function downloadStockTemplate(rows: { loc: string; partNo: string; name: string; system: number }[], scope: string) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const logoId = await brandLogo(wb)
  const ws = wb.addWorksheet('ตรวจนับ')
  ws.columns = [16, 16, 40, 12, 12, 24].map((width) => ({ width }))
  top(ws, 'F', logoId, `แบบฟอร์มตรวจนับสต็อก · ${scope}`)
  ws.addRow(COUNT_HEADERS).font = { bold: true }
  for (const r of rows) ws.addRow([r.loc, r.partNo, r.name, r.system, null, ''])
  // ช่อง "นับได้" เด่น ให้กรอกง่าย
  for (let i = BRAND_ROWS + 2; i <= ws.rowCount; i++) ws.getCell(`E${i}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7D6' } }
  ws.views = [{ state: 'frozen', ySplit: BRAND_ROWS + 1 }]
  howTo(wb, [
    'กรอกเฉพาะคอลัมน์ "นับได้" (ช่องสีเหลือง) · เว้นว่าง = ไม่ได้นับ (ระบบข้าม) · 0 = นับแล้วไม่มีของ',
    'เจอของที่ไม่มีในรายการ: เพิ่มแถวใหม่ ใส่ช่องเก็บหรือรหัสโซน + Part No. (หรือรหัส UAM) + จำนวนนับ',
    'ยอดในระบบในไฟล์เป็นของตอนดาวน์โหลด · ตอนอัปโหลดระบบเทียบกับยอดล่าสุดอีกครั้ง',
    'ส่งแล้วต้องให้ผู้มีสิทธิ์อนุมัติ (ไม่ใช่คนส่ง) ระบบจึงปรับยอด และลงบัญชีคุม FM-P-537 เป็น "ปรับยอด"',
    'ยอดเกินแต่ไม่มีกล่องเดิม: ระบบสร้างกล่องใหม่ให้ พิมพ์ป้ายได้ที่ ป้าย QR & พิมพ์ (เลขเอกสาร CNT)',
  ])
  await saveWorkbook(wb, `UAM_StockCount_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
