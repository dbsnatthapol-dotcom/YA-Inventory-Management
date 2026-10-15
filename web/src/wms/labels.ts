import type { Grn, GrnLine, MasterData } from './types'

/** ข้อมูลประกอบป้าย: ชื่อ part, ช่องเก็บแนะนำ, หัวหน้าโซน */
export interface LabelContext {
  grn: Grn | null
  lines: GrnLine[]
  master: MasterData
  trial: boolean
}

export function zoneHeadOf(master: MasterData, locationCode: string): string {
  const zoneId = master.locations.find((l) => l.code === locationCode)?.zoneId
  const head = master.zoneHeads.find((h) => h.zoneId === zoneId)
  return head ? `${head.fullName} (${head.employeeCode})` : 'ยังไม่กำหนดหัวหน้าโซน'
}

export type PrintFormat = 'label' | 'sheet' | 'a4'

export const FORMAT_NAME: Record<PrintFormat, string> = {
  label: 'ป้าย 100×150 มม.',
  sheet: 'A4 · 4 ป้ายต่อแผ่น',
  a4: 'A4 ใบรับสินค้า (GRN)',
}
