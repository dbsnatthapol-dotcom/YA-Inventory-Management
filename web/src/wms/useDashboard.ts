import { useEffect, useState } from 'react'
import { errorText } from './api'
import { fetchFrom } from './dashboard'
import { bangkokDay } from './ledger'
import type { DashActivity, Requisition, StockClosing } from './types'
import { useWms } from './useWms'

const POLL_MS = 60_000

export interface DashSource {
  /** วันนี้ (เวลาไทย) ตอนดึงข้อมูล */
  today: string
  reqs: Requisition[]
  activity: DashActivity
  pending: { adjustments: number; countSheets: number }
  closings: StockClosing[]
  /** เวลาที่ดึงล่าสุด (ISO) */
  at: string
}

/**
 * ข้อมูลหน้าภาพรวม (นอกจากกล่องในคลังที่ใช้ร่วมกับผัง): ใบเบิก รับเข้า ผลตรวจ MI3 งานรออนุมัติ และปิดยอด
 * ตั้งแต่ต้นเดือนหรือ 14 วันย้อนหลัง · ดึงใหม่ทุก 1 นาทีขณะเปิดหน้า และเมื่อกดอัปเดต
 */
export function useDashboard(enabled: boolean) {
  const { api, ready } = useWms()
  const [source, setSource] = useState<DashSource | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!enabled || !ready) return
    let alive = true
    const load = async () => {
      const today = bangkokDay(new Date().toISOString())
      const from = fetchFrom(today)
      setLoading(true)
      try {
        const [reqs, activity, adj, counts, closings] = await Promise.all([
          api.listRequisitions(from, today),
          api.dashboardActivity(from),
          api.pendingAdjustments(),
          api.listStockCounts(),
          api.listClosings(),
        ])
        if (!alive) return
        setSource({ today, reqs, activity, pending: { adjustments: adj.length, countSheets: counts.filter((c) => c.status === 'pending').length }, closings, at: new Date().toISOString() })
        setError(null)
      } catch (e) {
        if (alive) setError(errorText(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [api, enabled, ready, tick])
  return { source, loading, error, refresh: () => setTick((t) => t + 1) }
}
