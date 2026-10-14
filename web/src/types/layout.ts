// โมเดลข้อมูลผังโรงงาน — ตรงกับตารางใน supabase/migrations/0001_init.sql

export type FloorId = string

export interface Floor {
  id: FloorId
  name: string
  /** ลำดับชั้น: 1 = ชั้นล่าง */
  level: number
  /** ความสูงพื้นจากระดับดิน (เมตร) */
  elevation: number
  /** อาคารหลัก หรือ ลานภายนอก */
  area: 'building' | 'yard'
  /** ขนาดพื้น (เมตร) และตำแหน่งมุม */
  x: number
  z: number
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
  /** มุมซ้ายบนของโซน (เมตร) */
  x: number
  z: number
  width: number
  depth: number
  /** โหนดทางเดินที่ใช้เข้า-ออกโซนนี้ */
  accessNodeId: string
}

export interface NavNode {
  id: string
  floorId: FloorId
  x: number
  z: number
}

export type TravelMode = 'walk' | 'stairs' | 'lift'

export interface NavEdge {
  from: string
  to: string
  mode: TravelMode
}

export interface FactoryLayout {
  siteName: string
  floors: Floor[]
  zones: Zone[]
  nodes: NavNode[]
  edges: NavEdge[]
}
