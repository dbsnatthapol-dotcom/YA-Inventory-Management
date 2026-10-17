import { useEffect, useMemo, useState } from 'react'
import type { FactoryLayout } from '../types/layout'
import { bangkokDay } from './ledger'
import { buildZoneStock, NO_ACTIVITY, todayActivity, type MapActivity } from './mapStock'
import type { Lpn } from './types'
import { useWms } from './useWms'

const POLL_MS = 60_000

/**
 * กล่องในคลัง + ตัวเลขของวัน สำหรับผังคลัง 2D ผัง 3D หน้าปรับผัง และช่องค้นหาบนหัวเว็บ
 * ดึงใหม่ทุก 1 นาทีขณะเปิดใช้ และทุกครั้งที่ refreshKey เปลี่ยน (เช่น สลับหน้า: รับของเสร็จกลับมาผังเห็นทันที)
 */
export function useMapStock(enabled: boolean, layout: Pick<FactoryLayout, 'zones'>, refreshKey = '') {
  const { api, master, ready } = useWms()
  const [lpns, setLpns] = useState<Lpn[]>([])
  const [activity, setActivity] = useState<MapActivity>(NO_ACTIVITY)
  /** โหลดกล่องครั้งแรกเสร็จแล้ว (ผังคลังแสดง "กำลังโหลด" จนกว่าจะเสร็จ) */
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!enabled || !ready) return
    let alive = true
    const load = async () => {
      const day = bangkokDay(new Date().toISOString())
      const [l, reqs, grns, tx] = await Promise.all([api.activeLpns(), api.listRequisitions(day, day), api.listGrns(200), api.recentTx(300)])
      if (!alive) return
      setLpns(l)
      setActivity(todayActivity(reqs, grns, tx, day))
      setLoaded(true)
    }
    const run = () => void load().catch(() => undefined)
    run()
    const t = window.setInterval(run, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [api, enabled, ready, refreshKey])
  const stock = useMemo(() => buildZoneStock(lpns, master, layout), [lpns, master, layout])
  return { lpns, stock, activity, loaded }
}
