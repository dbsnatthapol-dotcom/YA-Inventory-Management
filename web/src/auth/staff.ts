/** บทบาทพนักงาน — ตรงกับ staff_profiles.role (supabase/migrations/0008_wms_receiving.sql) */
export type Role = 'warehouse' | 'mi3' | 'production' | 'planner' | 'engineer' | 'manager' | 'admin'

export const ROLES: Role[] = ['warehouse', 'mi3', 'production', 'planner', 'engineer', 'manager', 'admin']

export const ROLE_LABEL: Record<Role, string> = {
  warehouse: 'คลัง',
  mi3: 'MI3 คัดงาน',
  production: 'ผลิต',
  planner: 'วางแผน',
  engineer: 'วิศวกร',
  manager: 'ผู้จัดการ',
  admin: 'ผู้ดูแลระบบ',
}

export const ROLE_DUTY: Record<Role, string> = {
  warehouse: 'รับเข้า, จัดของ, ส่งของตามใบเบิก, รับของคืน',
  mi3: 'ดึงของจาก BOI มาคัด, บันทึกผลคัด (ผ่าน / NG), ส่งของผ่านกลับ BOI',
  production: 'ขอเบิก, ยืนยันรับของ, คืนของ, แจ้ง NG ที่เจอในไลน์',
  planner: 'ลงแผนผลิต',
  engineer: 'อนุมัติการแก้ไขยอด, ปิด Invoice ที่รับครบ',
  manager: 'ดูทุกอย่าง, อนุมัติปรับยอด, ดูประวัติเข้าใช้',
  admin: 'สร้างบัญชีพนักงาน, รีเซ็ตรหัสผ่าน, แก้ผังโรงงาน',
}

export interface StaffProfile {
  id: string
  employee_code: string
  full_name: string
  role: Role
  active: boolean
  must_change_password: boolean
}

/** พนักงาน login ด้วยรหัสพนักงาน — Supabase Auth ต้องใช้อีเมล จึงแปลงเป็นอีเมลภายใน (ไม่มีการส่งอีเมลจริง) */
export const staffEmail = (employeeCode: string) => `${employeeCode.trim().toLowerCase()}@staff.uam.local`

export const MIN_PASSWORD = 8

export type Action = 'manageUsers' | 'viewAccessLog'

const ALLOWED: Record<Action, Role[]> = {
  manageUsers: ['admin'],
  viewAccessLog: ['admin', 'manager'],
}

/** คนหน้างาน (คลัง / MI3 / ผลิต) เปิดเจอผังคลัง 2D รายช่องก่อน · ผู้จัดการ วิศวกร วางแผน ผู้ดูแล และโหมดสาธิต เปิดเจอผังโรงงาน 3D */
const PLAN_FIRST: Role[] = ['warehouse', 'mi3', 'production']

export const homePage = (role: Role | null): 'plan' | 'map' => (role && PLAN_FIRST.includes(role) ? 'plan' : 'map')

/** role = null คือโหมดสาธิต (ไม่ได้ต่อ Supabase) — เปิดทุกอย่างเพื่อทดลองใช้ */
export const can = (role: Role | null, action: Action) => role === null || ALLOWED[action].includes(role)
