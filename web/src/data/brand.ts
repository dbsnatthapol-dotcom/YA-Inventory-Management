/**
 * โทนสีองค์กรและวัสดุอาคาร — สกัดจากภาพถ่ายหน้าโรงงาน UAM1 และภาพดาวเทียม
 * ถ้ามีรหัสสี CI หรือไฟล์โลโก้ทางการ ให้แก้ค่าที่ไฟล์นี้ที่เดียว
 */
export const BRAND = {
  companyName: 'UNION AUTOPARTS MANUFACTURING CO.,LTD.',
  shortName: 'UAM',
  navy: '#1d3768', // โลโก้และตัวอักษรบนป้าย
  steelBlue: '#6d8db3', // ชายคาและแถบระหว่างชั้น
  cladBlue: '#3f6e9f', // ผนังเมทัลชีทสีฟ้า
  cream: '#e4ded0', // ผนังเมทัลชีทอาคาร A
  white: '#eeede8', // ผนังปูนชั้นล่าง / สำนักงาน
  safetyYellow: '#f2b51d', // ป้ายประตู
} as const

export const MATERIAL = {
  roofRust: '#8b685d', // หลังคาอาคาร A (ภาพดาวเทียม)
  roofSkylight: '#b9b2a6',
  tentGrey: '#9aa1ad',
  tentDark: '#5c606d',
  glass: '#2f4157',
  concrete: '#bdb6aa',
  asphalt: '#3a3d43',
  grass: '#7f9268',
  fenceGreen: '#3f6a45',
  trunk: '#6b4f3a',
  foliage: '#4f7a3c',
  sky: '#d6e6f4',
} as const
