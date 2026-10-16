import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/** โหมดหน้าจอ: mobile = หน้างาน (สแกน รับของ ค้นหา ผัง 2D) · desktop = จอคอม (ผัง 3D ปรับผัง หลังบ้าน) */
export type ViewMode = 'mobile' | 'desktop'
export type ViewPref = 'auto' | ViewMode

const KEY = 'uam-view-mode'
/** จอแคบกว่านี้ถือเป็นมือถือ (แท็บเล็ตแนวนอนใช้โหมดคอม) */
const MOBILE_QUERY = '(max-width: 767px)'

/** ค่าที่เครื่องนี้เลือกไว้ · null = ยังไม่เคยเลือก (ถามครั้งแรกหลังเข้าระบบ) */
const loadPref = (): ViewPref | null => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'mobile' || v === 'desktop' || v === 'auto' ? v : null
  } catch {
    // ไม่มีที่เก็บ (โหมดส่วนตัว): ไม่ถาม ใช้ตามขนาดจอ
    return 'auto'
  }
}

const narrow = () => typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches

/**
 * เลือกโหมดตามที่ผู้ใช้เลือกไว้ในเครื่องนี้ (หรืออัตโนมัติตามขนาดจอ)
 * chosen = false ⇒ เครื่องนี้ยังไม่เคยเลือก: หน้าแอปถามครั้งเดียวแล้วจำ
 */
export function useViewModeState() {
  const [stored, setStored] = useState<ViewPref | null>(loadPref)
  const pref: ViewPref = stored ?? 'auto'
  const [isNarrow, setNarrow] = useState(narrow)

  useEffect(() => {
    const mq = window.matchMedia?.(MOBILE_QUERY)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const setPref = useCallback((p: ViewPref) => {
    setStored(p)
    try {
      localStorage.setItem(KEY, p)
    } catch {
      // ไม่มีที่เก็บ: ใช้ได้เฉพาะรอบนี้
    }
  }, [])

  const mode: ViewMode = pref === 'auto' ? (isNarrow ? 'mobile' : 'desktop') : pref
  return { mode, pref, setPref, chosen: stored !== null, narrow: isNarrow }
}

export const ViewModeContext = createContext<ViewMode>('desktop')

/** หน้าจอย่อย (เช่น รับของ สแกน) ใช้ปรับรูปแบบให้เหมาะกับมือถือ */
export const useIsMobile = () => useContext(ViewModeContext) === 'mobile'
