import { useEffect, useState } from 'react'
import { errorText } from './api'
import type { PrintJob } from './types'
import { useWms } from './useWms'

const POLL_MS = 10_000

/** งานในคิวพิมพ์ (ดึงใหม่ทุก 10 วินาที) */
export function usePrintQueue(enabled: boolean, ver = 0) {
  const { api } = useWms()
  const [jobs, setJobs] = useState<PrintJob[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () =>
      api
        .listPrintJobs()
        .then((j) => {
          if (!alive) return
          setJobs(j)
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
  return { queued: jobs.filter((j) => j.status === 'queued').reverse(), jobs, error }
}
