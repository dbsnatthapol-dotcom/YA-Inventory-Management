import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/layoutSource'
import { errorText } from './api'
import { demoWms } from './demoApi'
import { supabaseWms } from './supabaseApi'
import type { MasterData, Perm, Settings } from './types'
import { WmsContext } from './wmsContext'

const EMPTY_MASTER: MasterData = { parts: [], models: [], rules: [], locations: [], zoneHeads: [], fgItems: [] }

export function WmsProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => (supabase ? supabaseWms(supabase) : demoWms({ samples: true })), [])
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>({ mode: 'trial', trialRound: 1, qiPartTypes: ['RIM', 'HUB'] })
  const [master, setMaster] = useState<MasterData>(EMPTY_MASTER)
  const [perms, setPerms] = useState<string[]>([])

  const reload = useCallback(async () => {
    try {
      const [s, m, p] = await Promise.all([api.settings(), api.master(), api.myPermissions()])
      setSettings(s)
      setMaster(m)
      setPerms(p)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setReady(true)
    }
  }, [api])

  useEffect(() => {
    let alive = true
    Promise.all([api.settings(), api.master(), api.myPermissions()])
      .then(([s, m, p]) => {
        if (!alive) return
        setSettings(s)
        setMaster(m)
        setPerms(p)
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setReady(true))
    return () => {
      alive = false
    }
  }, [api])

  const can = useCallback((perm: Perm) => perms.includes('*') || perms.includes(perm), [perms])
  const value = useMemo(() => ({ api, ready, error, settings, master, can, reload }), [api, ready, error, settings, master, can, reload])
  return <WmsContext.Provider value={value}>{children}</WmsContext.Provider>
}
