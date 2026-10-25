import { useEffect, useState } from 'react'
import { bangkokDay } from '../wms/ledger'

const now = () => bangkokDay(new Date().toISOString())

/**
 * วันนี้ (เวลาไทย) ที่เดินตามนาฬิกา · ตรวจทุกนาที และทุกครั้งที่กลับมาที่หน้า (เปิดหน้าค้างข้ามคืน)
 * ใช้เตือนว่าวันที่ในฟอร์มไม่ใช่วันนี้แล้ว (ไม่เปลี่ยนค่าในฟอร์มเอง กันของที่กรอกค้างหาย)
 */
export function useToday(): string {
  const [day, setDay] = useState(now)
  useEffect(() => {
    const tick = () => setDay(now())
    const t = window.setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(t)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return day
}
