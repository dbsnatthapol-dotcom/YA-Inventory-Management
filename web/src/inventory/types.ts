// ข้อมูลหลัก (Master) จากใบรายงาน STOCK เดิมของแผนก — ใช้สร้าง supabase/seed.sql และข้อมูลหน้าสาธิต

export interface Customer {
  id: string
  name: string
}

export interface ProductModel {
  code: string
  customerId: string
  /** ต้องผ่าน MI3 ก่อนเบิกเข้าไลน์หรือไม่ */
  requiresInspection: boolean
}

export interface Part {
  partNo: string
  type: string
  description: string
  customerId: string
  /** Model ที่ใช้ part นี้ */
  models: string[]
  /** revision ในต้นฉบับ (ตัวหลัง /) — ระบบอ้างอิงด้วยเลขฐาน */
  revision?: string | null
}

/** กฎแนะนำโซนจัดเก็บ: ลูกค้า + กลุ่มสินค้า (type = null คือค่าเริ่มต้นของลูกค้า) */
export interface ZoneRule {
  customerId: string
  type: string | null
  zoneId: string
}
