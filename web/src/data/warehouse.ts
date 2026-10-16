import type { ZoneContents } from '../wms/mapStock'
import type { StorageType, Zone } from '../types/layout'

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
export function planRack(width: number, depth: number, levels: readonly number[] = RACK.levels): RackPlan {
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
  for (const y of levels)
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

/** ค่าเริ่มต้นของโซนเก็บของ: พาเลทวางพื้นซ้อน 2 ชั้น (ใกล้กับหน้างานจริง) */
export const DEFAULT_STORAGE: StorageType = 'floor'
export const DEFAULT_FLOOR_STACK = 2
/** ความสูงพาเลท 1 ชั้นเมื่อวางซ้อน (ฐานพาเลท + ของ) */
export const STACK_STEP = RACK.palletLoadHeight + 0.15
/** จำนวนชั้นสูงสุดเมื่อไม่มีเพดานจำกัด (ชั้นบนสุดของอาคาร) */
const MAX_LEVELS: Record<StorageType, number> = { floor: 4, rack: 6 }
const MIN_RACK_SPACING = 0.9

export const STORAGE_LABEL: Record<StorageType, string> = { floor: 'พาเลทวางพื้น', rack: 'Rack (ชั้นวาง)' }

export interface StoragePlan extends RackPlan {
  type: StorageType
  /** ระดับพื้นวางพาเลทแต่ละชั้น (ม.) */
  levels: number[]
  /** ความสูงโครง rack / กองพาเลท */
  height: number
  /** ที่วางพาเลทต่อชั้นที่ใช้จริง และที่วางได้สูงสุดตามขนาดโซน */
  perLevel: number
  maxPerLevel: number
  /** จำนวนชั้นสูงสุดที่ตั้งได้ตามระยะถึงเพดาน */
  maxLevels: number
}

/**
 * แผนการวางพาเลทของโซน: แถว/ทางเดินแบบเดียวกับ rack (ให้รถยกเข้าถึงทุกพาเลท)
 * พาเลทวางพื้นซ้อนทีละ 1.15 ม., rack ระดับห่าง 1.45 ม. (บีบลงเมื่อเพดานเตี้ย เช่น ชั้นลอย)
 * จำนวนที่วางต่อชั้นลดได้ แต่เพิ่มได้ไม่เกินพื้นที่โซน (ขยายโซนเพื่อเพิ่ม)
 */
export function storagePlan(zone: Pick<Zone, 'width' | 'depth' | 'storage' | 'levels' | 'slotsPerLevel'>, clearance = Infinity): StoragePlan {
  const type = zone.storage ?? DEFAULT_STORAGE
  const avail = Number.isFinite(clearance) ? clearance - 0.15 : Infinity
  // rack ระดับห่างได้น้อยสุด 0.9 ม. (ของเตี้ย เช่น กล่อง component) · พาเลทวางพื้นต้องเว้นเต็มความสูงพาเลท
  const step = type === 'rack' ? MIN_RACK_SPACING : STACK_STEP
  const fit = Number.isFinite(avail) ? Math.max(1, 1 + Math.floor((avail - STACK_STEP + 1e-9) / step)) : Infinity
  const maxLevels = Math.min(fit, MAX_LEVELS[type])
  const wanted = zone.levels ?? (type === 'rack' ? RACK.levels.length : DEFAULT_FLOOR_STACK)
  const n = Math.max(1, Math.min(Math.round(wanted), maxLevels))
  let levels: number[]
  let height: number
  if (type === 'rack') {
    const spacing = n > 1 ? Math.min(1.45, (avail - STACK_STEP) / (n - 1)) : 1.45
    levels = Array.from({ length: n }, (_, i) => Math.round(i * spacing * 100) / 100)
    height = Math.max(1.2, Math.min(avail, levels[n - 1] + 1.3))
  } else {
    levels = Array.from({ length: n }, (_, i) => Math.round(i * STACK_STEP * 100) / 100)
    height = n * STACK_STEP
  }
  const base = planRack(zone.width, zone.depth, [0])
  const maxPerLevel = base.slots.length
  const perLevel = Math.max(0, Math.min(maxPerLevel, Math.round(zone.slotsPerLevel ?? maxPerLevel)))
  const spots = base.slots.slice(0, perLevel)
  const slots = levels.flatMap((y) => spots.map((s) => ({ ...s, y })))
  return { ...base, slots, type, levels, height, perLevel, maxPerLevel, maxLevels }
}

export interface PalletLoad {
  model: string
  partNo: string
  /** ป้ายกล่อง (1 ป้าย = 1 กล่อง/พาเลทบนผัง) */
  lpnNo: string
  qty: number
  /** รอตรวจ MI3 */
  hold: boolean
}

/** ของในโซน → กล่อง/พาเลทบนผัง (1 ป้าย LPN = 1 พาเลท) เรียงตาม Model */
export function palletsFor(stock: ZoneContents | undefined): PalletLoad[] {
  if (!stock) return []
  const boxes = new Map<string, PalletLoad>()
  for (const i of stock.items) {
    const b = boxes.get(i.lpnNo)
    if (b) b.qty += i.qty
    else boxes.set(i.lpnNo, { model: i.model, partNo: i.partNo, lpnNo: i.lpnNo, qty: i.qty, hold: i.pendingQc > 0 })
  }
  return [...boxes.values()]
}
