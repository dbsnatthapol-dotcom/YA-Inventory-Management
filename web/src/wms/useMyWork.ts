import { useEffect, useMemo, useState } from 'react'
import { errorText } from './api'
import { COUNT_HISTORY, MOVE_WINDOW, planCycleCount } from './cycleCount'
import { addDays, bangkokDay } from './ledger'
import { workQueues } from './myWork'
import type { CycleActivity, Lpn } from './types'
import { useWms } from './useWms'

const POLL_MS = 60_000

interface Snapshot {
  today: string
  at: string
  lpns: Lpn[]
  activity: CycleActivity | null
}

/** งานวันนี้: กล่องที่ต้องจัดเก็บ / รอ MI3 / NG และแผนนับวน · ดึงใหม่ทุก 1 นาที และทุกครั้งที่กลับมาที่หน้าจอ */
export function useMyWork(ver = 0) {
  const { api, master, can, ready } = useWms()
  const counting = can('scan.count')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ready) return
    let alive = true
    const load = () => {
      const now = new Date().toISOString()
      const today = bangkokDay(now)
      Promise.all([api.activeLpns(), counting ? api.cycleActivity(addDays(today, -COUNT_HISTORY), addDays(today, -MOVE_WINDOW)) : Promise.resolve(null)])
        .then(([lpns, activity]) => {
          if (!alive) return
          setSnap({ today, at: now, lpns, activity })
          setError(null)
        })
        .catch((e) => alive && setError(errorText(e)))
    }
    load()
    const t = window.setInterval(load, POLL_MS)
    const onShow = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onShow)
    return () => {
      alive = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onShow)
    }
  }, [api, ready, counting, ver])

  const queues = useMemo(() => (snap ? workQueues(snap.lpns, master.locations, snap.today) : null), [snap, master.locations])
  const plan = useMemo(() => (snap?.activity ? planCycleCount({ today: snap.today, lpns: snap.lpns, locations: master.locations, activity: snap.activity }) : null), [snap, master.locations])
  return { queues, plan, at: snap?.at ?? null, today: snap?.today ?? null, error }
}
