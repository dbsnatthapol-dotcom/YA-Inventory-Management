import { useEffect, useState } from 'react'
import { errorText } from './api'
import type { StockCount, Tx } from './types'
import { useWms } from './useWms'

const POLL_MS = 30_000

/** คิวรออนุมัติปรับยอดคิวเดียว: คำขอจากหน้าสแกน (ตรวจนับ / แก้ไขยอด) + ใบตรวจนับ Excel · ดึงใหม่ทุก 30 วินาที */
export function useApprovals(enabled: boolean, ver = 0) {
  const { api } = useWms()
  const [adj, setAdj] = useState<Tx[]>([])
  const [sheets, setSheets] = useState<StockCount[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      Promise.all([api.pendingAdjustments(), api.listStockCounts()])
        .then(([a, c]) => {
          if (!alive) return
          setAdj(a)
          setSheets(c)
          setError(null)
        })
        .catch((e) => alive && setError(errorText(e)))
    void load()
    const t = window.setInterval(load, POLL_MS)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [api, enabled, ver])
  const pendingSheets = sheets.filter((c) => c.status === 'pending')
  return { adj, sheets, pendingSheets, total: adj.length + pendingSheets.length, error }
}
