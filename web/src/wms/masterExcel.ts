import { saveWorkbook } from './ledgerExcel'
import { BOM_HEADERS, PART_HEADERS } from './masterImport'
import { partsOfModel } from './partCodes'
import type { MasterData } from './types'

/** แบบฟอร์ม Part: ข้อมูลปัจจุบันทั้งหมด ให้เติมรหัส UAM แล้วอัปโหลดกลับ */
export async function downloadPartTemplate(master: MasterData) {
  const { Workbook } = await import('exceljs')
  const wb = new Workbook()
  const ws = wb.addWorksheet('Part')
  ws.columns = [16, 12, 44, 12, 26].map((width) => ({ width }))
  ws.addRow(PART_HEADERS).font = { bold: true }
  for (const p of [...master.parts].sort((a, b) => a.partNo.localeCompare(b.partNo)))
    ws.addRow([p.partNo, p.uamCode ?? '', p.name, p.type ?? '', p.models.join(', ')])
  ws.views = [{ state: 'frozen', ySplit: 1 }]
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
  const ws = wb.addWorksheet('BOM')
  ws.columns = [16, 36, 10, 22, 14].map((width) => ({ width }))
  ws.addRow(BOM_HEADERS).font = { bold: true }
  for (const f of master.fgItems.filter((x) => x.active)) for (const l of f.lines) ws.addRow([f.code, f.name, f.modelCode ?? '', l.partNo, l.qtyPer])
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  const ref = wb.addWorksheet('Part ตาม Model')
  ref.columns = [10, 16, 12, 12, 44].map((width) => ({ width }))
  ref.addRow(['Model', 'Part No.', 'รหัส UAM', 'กลุ่ม', 'รายการ']).font = { bold: true }
  for (const m of master.models) for (const p of partsOfModel(master, m.code)) ref.addRow([m.code, p.partNo, p.uamCode ?? '', p.type ?? '', p.name])
  ref.views = [{ state: 'frozen', ySplit: 1 }]
  howTo(wb, [
    '1 ชุดวงล้อ (FG) ใช้หลายแถว: แถวละ 1 part พร้อมจำนวนต่อ 1 วง (เช่น ลูกปืน 2, ซี่ลวด 9)',
    'รหัสชุดใช้รหัส FG ในใบเบิก เช่น 2019333 · ชื่อชุดและ Model ใส่แถวแรกของชุดก็พอ',
    'ช่อง Part ใส่ Part No. หรือรหัส UAM ก็ได้ (ดูรหัสได้ที่ sheet "Part ตาม Model")',
    'ชุดที่อยู่ในไฟล์ = BOM ครบชุด · part ที่ไม่อยู่ในไฟล์จะถูกเอาออกจากชุดนั้น',
  ])
  await saveWorkbook(wb, 'UAM_BOM_Template.xlsx')
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
