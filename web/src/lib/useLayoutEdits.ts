import { useCallback, useEffect, useState } from 'react'
import { emptyEdits, withPatch, withRemoved, type LayoutEdits, type ZonePatch } from './layoutEdit'
import type { Zone } from '../types/layout'

const STORAGE_KEY = 'uam-layout-edits-v1'
/** จำนวนขั้นที่ย้อนกลับได้ */
const HISTORY_LIMIT = 50

function load(): LayoutEdits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...emptyEdits(), ...JSON.parse(raw) }
  } catch {
    // เปิดแบบไม่ให้เก็บข้อมูล (private mode) — ใช้ผังเริ่มต้น
  }
  return emptyEdits()
}

interface History {
  past: LayoutEdits[]
  present: LayoutEdits
  future: LayoutEdits[]
}

/** ผังที่ผู้ใช้แก้ไข เก็บในเครื่อง (demo) พร้อมย้อนกลับ/ทำซ้ำ — ระบบจริงบันทึกลงตาราง zones ใน Supabase */
export function useLayoutEdits() {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: load(), future: [] }))
  const edits = history.present

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(edits))
    } catch {
      // ไม่มีที่เก็บ: ใช้ได้เฉพาะรอบนี้
    }
  }, [edits])

  // เปิดหลายแท็บแล้วเห็นผังเดียวกัน (แท็บอื่นแก้ ⇒ เริ่มประวัติใหม่)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setHistory({ past: [], present: load(), future: [] })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const apply = useCallback(
    (change: (e: LayoutEdits) => LayoutEdits) =>
      setHistory((h) => {
        const next = change(h.present)
        if (next === h.present) return h
        return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [] }
      }),
    [],
  )

  return {
    edits,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    update: useCallback((id: string, patch: ZonePatch) => apply((e) => withPatch(e, id, patch)), [apply]),
    add: useCallback((zone: Zone) => apply((e) => ({ ...e, added: [...e.added, zone] })), [apply]),
    remove: useCallback((id: string) => apply((e) => withRemoved(e, id)), [apply]),
    reset: useCallback(() => apply(() => emptyEdits()), [apply]),
    undo: useCallback(
      () =>
        setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)),
      [],
    ),
    redo: useCallback(() => setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []),
  }
}

export type LayoutEditsApi = ReturnType<typeof useLayoutEdits>
