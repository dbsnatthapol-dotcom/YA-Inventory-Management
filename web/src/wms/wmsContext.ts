import { createContext } from 'react'
import type { WmsApi } from './api'
import type { MasterData, Perm, Settings } from './types'

export interface WmsState {
  api: WmsApi
  /** โหลดครั้งแรกเสร็จหรือยัง */
  ready: boolean
  error: string | null
  settings: Settings
  master: MasterData
  can: (perm: Perm) => boolean
  /** โหลดค่าตั้ง + ข้อมูลหลัก + สิทธิ์ใหม่ (หลังหลังบ้านแก้ไข) */
  reload: () => Promise<void>
}

export const WmsContext = createContext<WmsState | null>(null)
