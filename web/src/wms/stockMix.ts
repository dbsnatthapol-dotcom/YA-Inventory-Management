import type { ZoneKind } from '../types/layout'

/** ส่วนของสต็อก (นิยามเดียวทุกหน้า: ภาพรวม · ผังคลัง 2D · ผัง 3D) */
export type StockPart = 'ready' | 'putaway' | 'mi3' | 'ng'
export const STOCK_PARTS: StockPart[] = ['ready', 'putaway', 'mi3', 'ng']
export const STOCK_PART_LABEL: Record<StockPart, string> = { ready: 'ในช่องเก็บ', putaway: 'รอจัดเก็บ', mi3: 'รอตรวจ MI3', ng: 'พื้นที่ NG' }
/** สีส่วนของสต็อก (ตรวจแยกสีสำหรับตาบอดสีแล้ว · สีฟ้าอ่อนต้องมีป้ายตัวเลขข้าง ๆ เสมอ) */
export const STOCK_PART_COLOR: Record<StockPart, string> = { ready: '#1d4ed8', putaway: '#0ea5e9', mi3: '#d97706', ng: '#b91c1c' }

/**
 * กล่องนี้อยู่ส่วนไหน: รอ MI3 (ยังเบิกไม่ได้) → พื้นที่ NG (ห้ามเข้าไลน์) → จุดรับของ / จุดตรวจ (เบิกได้ แต่ยังไม่เข้าช่อง) → ในช่องเก็บ
 * ของดีคงคลัง (พร้อมเบิก) = ในช่องเก็บ + รอจัดเก็บ
 */
export function stockPartOf(hold: boolean, zoneKind: ZoneKind | undefined): StockPart {
  if (hold) return 'mi3'
  if (zoneKind === 'ng') return 'ng'
  if (zoneKind === 'receiving' || zoneKind === 'inspection') return 'putaway'
  return 'ready'
}

export type StockMix = Record<StockPart, { boxes: number; qty: number }>

export function stockMix(boxes: { part: StockPart; qty: number }[]): StockMix {
  const mix = Object.fromEntries(STOCK_PARTS.map((p) => [p, { boxes: 0, qty: 0 }])) as StockMix
  for (const b of boxes) {
    mix[b.part].boxes++
    mix[b.part].qty += b.qty
  }
  return mix
}

/** ของดีคงคลัง (ไม่รวมรอ MI3 และพื้นที่ NG) */
export const goodOf = (mix: StockMix) => ({ boxes: mix.ready.boxes + mix.putaway.boxes, qty: mix.ready.qty + mix.putaway.qty })
