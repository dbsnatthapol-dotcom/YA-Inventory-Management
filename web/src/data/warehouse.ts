import type { ZoneContents } from '../inventory/reports'

/**
 * ขนาดอุปกรณ์คลังสินค้าที่ใช้วาดโมเดล 3D และคำนวณจำนวนพาเลท
 * ⚠️ สมมติฐาน (รอยืนยันหน้างาน): ขนาด rack, จำนวนชั้น และจำนวนชิ้นต่อพาเลทของแต่ละประเภท
 */
export const RACK = {
  /** ความยาวคาน 1 ช่อง (bay) วางพาเลทได้ 2 ตัว */
  bayLength: 2.7,
  palletsPerBay: 2,
  /** ความลึก rack แถวเดี่ยว / แถวคู่หลังชนหลัง */
  singleDepth: 1.1,
  doubleDepth: 2.2,
  /** ทางเดินรถยกระหว่างแถว rack */
  aisle: 2.8,
  /** ระดับพื้นที่วางพาเลท (ม.) — ชั้นล่างวางบนพื้น */
  levels: [0, 1.45, 2.9],
  height: 4.2,
  palletLoadHeight: 1.0,
} as const

/** จำนวนชิ้นต่อพาเลท (สมมติ) — ใช้แปลงยอดคงคลังเป็นจำนวนพาเลทบนชั้นวาง */
export const PIECES_PER_PALLET: Record<string, number> = {
  RIM: 60,
  'ALLOY RIM': 40,
  CAST: 40,
  HUB: 120,
  DISC: 150,
  TONER: 300,
  SPOKE: 4000,
  NIPPLE: 10000,
  BOLT: 3000,
  BEARING: 2000,
  SPACER: 2000,
  SEAL: 3000,
  VALVE: 3000,
  RUBBER: 2000,
  TYRE: 40,
  TUBE: 300,
  STICKER: 5000,
  'RIM TAPE': 1000,
}
const DEFAULT_PIECES_PER_PALLET = 500

export const piecesPerPallet = (type: string | undefined) => PIECES_PER_PALLET[type ?? ''] ?? DEFAULT_PIECES_PER_PALLET

export interface RackRow {
  /** ระยะจากขอบโซนตามแนวสั้น */
  offset: number
  /** 1 = แถวเดี่ยว, 2 = แถวคู่หลังชนหลัง */
  units: 1 | 2
}

export interface RackSlot {
  /** ตำแหน่งกึ่งกลางพาเลท: u = ตามแนวยาวของโซน, v = ตามแนวสั้น, y = ระดับพื้นวาง */
  u: number
  v: number
  y: number
}

export interface RackPlan {
  length: number
  span: number
  bays: number
  /** จุดเริ่มต้นของ bay แรก (จัดกึ่งกลางตามแนวยาว) */
  start: number
  rows: RackRow[]
  slots: RackSlot[]
}

/**
 * จัดวาง rack ในโซน: แถวเดี่ยวชิดขอบ แล้วสลับ ทางเดิน → แถวคู่ ไปเรื่อย ๆ
 * โซน 18 × 10 ม. ⇒ แถวเดี่ยว + ทางเดิน + แถวคู่ + ทางเดิน + แถวเดี่ยว, 6 bay, 3 ระดับ = 144 ช่องพาเลท
 */
export function planRack(width: number, depth: number): RackPlan {
  const length = Math.max(width, depth)
  const span = Math.min(width, depth)
  const rows: RackRow[] = []
  let cursor = 0
  if (span >= RACK.singleDepth) {
    rows.push({ offset: 0, units: 1 })
    cursor = RACK.singleDepth
  }
  for (;;) {
    const room = span - cursor - RACK.aisle
    if (room >= RACK.doubleDepth) {
      rows.push({ offset: cursor + RACK.aisle, units: 2 })
      cursor += RACK.aisle + RACK.doubleDepth
    } else if (room >= RACK.singleDepth - 1e-9) {
      rows.push({ offset: cursor + RACK.aisle, units: 1 })
      cursor += RACK.aisle + RACK.singleDepth
    } else break
  }
  // พื้นที่เหลือแบ่งเท่ากันสองข้าง
  const shift = (span - cursor) / 2
  rows.forEach((r) => (r.offset += shift))

  const bays = Math.max(0, Math.floor((length + 1e-9) / RACK.bayLength))
  const start = (length - bays * RACK.bayLength) / 2
  const slots: RackSlot[] = []
  for (const y of RACK.levels)
    for (const row of rows)
      for (let unit = 0; unit < row.units; unit++)
        for (let b = 0; b < bays; b++)
          for (let p = 0; p < RACK.palletsPerBay; p++)
            slots.push({
              u: start + b * RACK.bayLength + ((p + 0.5) * RACK.bayLength) / RACK.palletsPerBay,
              v: row.offset + (unit + 0.5) * RACK.singleDepth,
              y,
            })
  return { length, span, bays, start, rows, slots }
}

export interface PalletLoad {
  model: string
  partNo: string
}

/** แปลงของในโซนเป็นรายการพาเลท (ปัดขึ้นต่อ lot) เรียงตาม Model */
export function palletsFor(stock: ZoneContents | undefined): PalletLoad[] {
  if (!stock) return []
  return stock.items.flatMap((i) =>
    Array.from({ length: Math.ceil(i.qty / piecesPerPallet(i.part?.type)) }, () => ({ model: i.lot.model, partNo: i.lot.partNo })),
  )
}
