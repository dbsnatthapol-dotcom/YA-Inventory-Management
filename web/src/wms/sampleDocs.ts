/**
 * เอกสารจริงจากหน้างาน (Royal Enfield ส่ง component ล้อ TWIN) ใช้ลองระบบโดยไม่ต้องถ่ายรูป
 * อ่านจากภาพถ่าย 14/10/2026 — จำนวนใน Invoice ตั้งแต่บรรทัด 4 เลื่อนไม่ตรง part (รอยืนยันกับต้นฉบับ)
 */
type Row = [plNo: number, partNo: string, description: string, plQty: number, invLine: number, invQty: number]

const ROWS: Row[] = [
  [1, 'H6906002/B', 'HEX HEAD BOLT, M8X1.25X30', 500, 1, 500],
  [2, 'RAB00076/A', 'BRAKE DISC, 320MM', 100, 2, 100],
  [3, 'RAB00374/A', 'FRONT TONER WHEEL - DF30 WSS', 100, 3, 100],
  [4, '141109/1', 'GREASE SEAL 25X40X7', 100, 4, 300],
  [5, '150324/A', 'WHEEL BEARING 6203 (17 X 40X 12)', 300, 5, 400],
  [6, '585514/A', 'NR 61- FRONT HUB BEARING SPACER ASSEMBLY', 400, 6, 100],
  [7, '585216/C', 'TONER - REAR WHEEL', 100, 9, 600],
  [8, '587395/B', 'REAR DISC PLATE', 100, 10, 400],
  [9, '587605/B', 'SOCKET HEAD BOLT M8*1.25*20', 100, 11, 100],
  [10, 'RAT00035/C', 'RUBBER CUSHION', 600, 12, 100],
  [11, '146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB', 400, 13, 100],
  [12, '148650/D', 'RIM TAPE', 100, 14, 100],
  [13, '585328/C', 'RIM TAPE', 100, 15, 100],
  [14, 'RAJ00005/B', 'TUBE, TYRE, 3x18', 100, 16, 100],
  [15, '585304/B', 'NR61 REAR TUBE - 130/80-18"', 100, 17, 3600],
  [16, '148537/A', 'RIM, 2.5 x 18", BLACK', 100, 18, 3600],
  [17, '148640/A', 'SPOKE, WHEEL', 3600, 19, 100],
  [18, '585179/A', 'NR61 NIPPLE 3.6 MM', 3600, 20, 100],
  [19, 'RAJ00030/A', 'HUB, FRONT WHEEL, BLACK', 100, 21, 100],
  [20, '148529/F', 'HUB, REAR WHEEL, BLACK', 100, 22, 3600],
  [21, '148532/A', 'RIM, 3.5 X 18", BLACK', 100, 23, 3600],
  [22, '593393/A', 'NIPPLE', 3600, 24, 100],
  [23, 'RAT00259/A', 'SPOKE, REAR WHEEL', 3600, 25, 100],
  [24, '148543/A', 'TYRE-FRONT 100/90 18" - PIRELLI PHANTOM', 100, 7, 100],
  [25, '148544/A', 'TYRE-REAR 130/70 18", PIRELLI PHANTOM', 100, 8, 100],
]

export const SAMPLE_PACKING_LIST = {
  refDoc: '55035596',
  soNo: '838399',
  packages: 'F28-F40',
  title: 'TWIN 36 SET (72 Wheels)',
  lines: ROWS.map(([, partNo, description, qty]) => ({ partNo, description, qty })),
}

export const SAMPLE_INVOICE = {
  invoiceNo: '4957930126',
  poNo: '4824000131',
  docDate: '2026-10-09',
  movementType: '541',
  customerId: 'RE',
  lines: ROWS.map(([, partNo, description, , lineNo, qty]) => ({ lineNo, partNo, description, qty })).sort((a, b) => a.lineNo - b.lineNo),
}

export const SAMPLE_MODEL = 'TWIN'
