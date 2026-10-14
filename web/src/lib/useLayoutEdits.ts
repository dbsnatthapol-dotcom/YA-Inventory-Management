import { useCallback, useEffect, useState } from 'react'
import { emptyEdits, withPatch, withRemoved, type LayoutEdits, type ZonePatch } from './layoutEdit'
import type { Zone } from '../types/layout'

const STORAGE_KEY = 'uam-layout-edits-v1'

function load(): LayoutEdits {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...emptyEdits(), ...JSON.parse(raw) }
  } catch {
    // เปิดแบบไม่ให้เก็บข้อมูล (private mode) — ใช้ผังเริ่มต้น
  }
  return emptyEdits()
}

/** ผังที่ผู้ใช้แก้ไข เก็บในเครื่อง (demo) — ระบบจริงบันทึกลงตาราง zones ใน Supabase */
export function useLayoutEdits() {
  const [edits, setEdits] = useState<LayoutEdits>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(edits))
    } catch {
      // ไม่มีที่เก็บ: ใช้ได้เฉพาะรอบนี้
    }
  }, [edits])

  // เปิดหลายแท็บแล้วเห็นผังเดียวกัน
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEdits(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return {
    edits,
    update: useCallback((id: string, patch: ZonePatch) => setEdits((e) => withPatch(e, id, patch)), []),
    add: useCallback((zone: Zone) => setEdits((e) => ({ ...e, added: [...e.added, zone] })), []),
    remove: useCallback((id: string) => setEdits((e) => withRemoved(e, id)), []),
    reset: useCallback(() => setEdits(emptyEdits()), []),
  }
}

export type LayoutEditsApi = ReturnType<typeof useLayoutEdits>
