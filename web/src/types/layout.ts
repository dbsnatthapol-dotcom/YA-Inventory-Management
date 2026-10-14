// โมเดลข้อมูลผังโรงงาน — ตรงกับตารางใน supabase/migrations/

export type FloorId = string

/**
 * ระบบพิกัด: หน่วยเมตร มุมมองจากด้านบน แกน x ชี้ไปทางขวาของภาพดาวเทียม และแกน z ชี้ลงล่าง (ไปทางถนน)
 * แต่ละชั้นมีพิกัดภายใน (local) ของตัวเอง จุด (0,0) ของชั้นอยู่ที่ตำแหน่ง (x, z) ของ site
 * และหมุนตาม rotation (องศา) เพื่อให้อาคารที่วางเอียงยังวาด rack/ทางเดินแบบตั้งฉากได้
 */
export interface Floor {
  id: FloorId
  name: string
  /** ลำดับชั้น: 1 = ชั้นล่าง */
  level: number
  /** ความสูงพื้นจากระดับดิน (เมตร) */
  elevation: number
  /** ชั้นของอาคาร หรือ ลานภายนอก (ลานใช้พิกัด site โดยตรง) */
  area: 'building' | 'yard'
  /** จุดเริ่มต้นของพิกัดภายในชั้น (พิกัด site) */
  x: number
  z: number
  /** หมุนรอบจุดเริ่มต้น (องศา, ตามเข็มนาฬิกาเมื่อมองจากด้านบน) */
  rotation?: number
  /** ขนาดพื้น (พิกัดภายใน) */
  width: number
  depth: number
}

export type ZoneKind =
  | 'storage' // ชั้นวาง / rack เก็บ part
  | 'receiving' // จุดรับเข้าสินค้า
  | 'assembly' // ไลน์ประกอบ (ปลายทางที่ต้องส่ง part)
  | 'tent' // เต็นท์เก็บของลานนอก
  | 'stairs'
  | 'lift'

export interface Zone {
  id: string
  code: string
  name: string
  floorId: FloorId
  kind: ZoneKind
  /** มุมของโซนในพิกัดภายในชั้น (เมตร) */
  x: number
  z: number
  width: number
  depth: number
  /** โหนดทางเดินที่ใช้เข้า-ออกโซนนี้ */
  accessNodeId: string
  /** ประเภทของที่เก็บ เช่น FG, Component */
  stores?: string[]
}

export interface NavNode {
  id: string
  floorId: FloorId
  /** พิกัดภายในชั้น */
  x: number
  z: number
}

export type TravelMode = 'walk' | 'stairs' | 'lift'

export interface NavEdge {
  from: string
  to: string
  mode: TravelMode
}

/** สิ่งประกอบฉากที่ไม่ใช่พื้นที่เก็บของ เช่น สำนักงาน ถนน อาคารข้างเคียง */
export interface Landmark {
  id: string
  name: string
  kind: 'office' | 'building' | 'road' | 'area'
  /** จุดกึ่งกลาง (พิกัด site) */
  x: number
  z: number
  width: number
  depth: number
  rotation: number
  height: number
}

export interface Site {
  /** เส้นขอบที่ดิน (พิกัด site) */
  boundary: [number, number][]
  landmarks: Landmark[]
}

export interface FactoryLayout {
  siteName: string
  site?: Site
  floors: Floor[]
  zones: Zone[]
  nodes: NavNode[]
  edges: NavEdge[]
}
