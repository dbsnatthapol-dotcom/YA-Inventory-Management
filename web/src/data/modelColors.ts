import { MODELS } from '../inventory/masterData'

/**
 * สีประจำ Model — ใช้ลำดับสีคงที่ 8 สีที่ผ่านการตรวจสำหรับผู้มีภาวะตาบอดสีแล้ว
 * แสดงคู่กับชื่อ Model เสมอ (ไม่ใช้สีอย่างเดียว)
 */
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

export const MODEL_COLOR: Record<string, string> = Object.fromEntries(MODELS.map((m, i) => [m.code, PALETTE[i % PALETTE.length]]))

export const modelColor = (code: string) => MODEL_COLOR[code] ?? '#94a3b8'
