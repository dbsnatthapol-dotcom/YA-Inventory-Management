/**
 * โทนสีองค์กรและวัสดุอาคาร — สกัดจากโลโก้ UAM และภาพถ่ายหน้าโรงงาน
 * ถ้ามีรหัสสี CI ทางการ ให้แก้ค่าที่ไฟล์นี้ที่เดียว
 */
export const BRAND = {
  companyName: 'UNION AUTOPARTS MANUFACTURING CO.,LTD.',
  shortName: 'UAM',
  logoBlue: '#0099ff', // สีโลโก้
  primary: '#0b5aa8', // สีหลักของหน้าจอ (น้ำเงินเข้มจากโลโก้ เพื่อให้อ่านตัวอักษรขาวได้ชัด)
  signBlue: '#1565c5', // ตัวอักษรป้ายบนอาคาร
  roofBlue: '#2f8fdf', // หลังคา ชายคา และแถบระหว่างชั้น
  trimBlue: '#1f74c9', // แถบคั่นชั้นด้านล่าง
  siding: '#eef2f5', // ผนังเมทัลชีทสีขาว ลอนแนวนอน
  white: '#f4f6f8', // ผนังปูน / เสา
  green: '#2baf75', // แถบผนังล่างและพื้น epoxy
  safetyYellow: '#f4a20d', // ทางเดินพื้น epoxy และป้ายประตู
} as const

export const MATERIAL = {
  roofSkylight: '#cfe3f3',
  tentGrey: '#9aa1ad',
  tentDark: '#5c606d',
  glass: '#2f4157',
  concrete: '#bdb6aa',
  asphalt: '#3a3d43',
  grass: '#7f9268',
  fenceGreen: '#3f6a45',
  epoxyGreen: '#1f8a52',
  trunk: '#6b4f3a',
  foliage: '#4f7a3c',
  sky: '#e8f0f8',
} as const
