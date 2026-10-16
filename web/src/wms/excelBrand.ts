import type { Workbook, Worksheet } from 'exceljs'
import logoUrl from '../assets/uam-logo.png'
import { BRAND } from '../data/brand'

/** แถวหัวบริษัทที่ทุก sheet ใช้ (ข้อมูลจริงเริ่มแถวถัดไป) */
export const BRAND_ROWS = 2

let logo: Promise<string | null> | null = null
const logoBase64 = () =>
  (logo ??= fetch(logoUrl)
    .then((r) => (r.ok ? r.blob() : null))
    .then(
      (b) =>
        b &&
        new Promise<string>((ok, bad) => {
          const fr = new FileReader()
          fr.onload = () => ok(String(fr.result))
          fr.onerror = bad
          fr.readAsDataURL(b)
        }),
    )
    .catch(() => null))

/** โลโก้ของสมุดงาน (ใช้ซ้ำทุก sheet) · โหลดไม่ได้ ⇒ มีแต่ชื่อบริษัท */
export async function brandLogo(wb: Workbook): Promise<number | null> {
  const b64 = await logoBase64()
  return b64 ? wb.addImage({ base64: b64, extension: 'png' }) : null
}

/** แถว 1–2: โลโก้ UAM + Union Autoparts Manufacturing Co., Ltd. + ชื่อเอกสาร */
export function brandHeader(ws: Worksheet, lastCol: string, logoId: number | null, subtitle = 'ระบบบริหารคลังสินค้า UAM WMS') {
  ws.getRow(1).height = 22
  ws.getRow(2).height = 16
  ws.mergeCells(`B1:${lastCol}1`)
  ws.mergeCells(`B2:${lastCol}2`)
  const name = ws.getCell('B1')
  name.value = BRAND.legalName
  name.font = { bold: true, size: 13, color: { argb: `FF${BRAND.primary.slice(1)}` } }
  name.alignment = { vertical: 'middle' }
  const sub = ws.getCell('B2')
  sub.value = subtitle
  sub.font = { size: 9, color: { argb: 'FF64748B' } }
  if (logoId !== null) ws.addImage(logoId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 44, height: 36 } })
}
