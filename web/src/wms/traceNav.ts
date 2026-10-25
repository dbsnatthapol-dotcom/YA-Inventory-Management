import { createContext, useContext } from 'react'

/** เปิดหน้าตามรอยด้วยเลขเอกสาร/กล่องจากหน้าจออื่น · หน้าหลัก (คอม/มือถือ) ใส่ให้ · ไม่มี = ไม่แสดงปุ่มตามรอย */
export const TraceContext = createContext<((query: string) => void) | null>(null)

export const useOpenTrace = () => useContext(TraceContext)
