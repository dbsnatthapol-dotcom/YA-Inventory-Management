import { useCallback, useEffect, useState } from 'react'
import { buildDemoState } from './demoSeed'
import { InventoryError, moveLot, receiveInvoice, type MoveInput, type ReceiveLineInput } from './ledger'
import { bangkokDate } from './reports'
import type { InventoryState, Receipt } from './types'

// demo เก็บข้อมูลในเบราว์เซอร์ของผู้ใช้เท่านั้น — ระบบจริงจะเก็บใน Supabase
const STORAGE_KEY = 'uam-inventory-demo-v1'

function load(): InventoryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as InventoryState
  } catch {
    // เปิดแบบ private หรือบล็อก storage: ใช้ข้อมูลตัวอย่างแทน
  }
  return buildDemoState(bangkokDate())
}

export type ActionResult = { ok: true } | { ok: false; error: string }

export function useInventory() {
  const [state, setState] = useState<InventoryState>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ไม่บันทึกก็ใช้งานต่อได้
    }
  }, [state])

  const run = useCallback((fn: (s: InventoryState) => InventoryState): ActionResult => {
    try {
      const next = fn(state)
      setState(next)
      return { ok: true }
    } catch (e) {
      if (e instanceof InventoryError) return { ok: false, error: e.message }
      throw e
    }
  }, [state])

  return {
    state,
    receive: (receipt: Omit<Receipt, 'id' | 'receivedAt'>, lines: ReceiveLineInput[]) => run((s) => receiveInvoice(s, receipt, lines)),
    move: (input: MoveInput) => run((s) => moveLot(s, input)),
    resetDemo: () => setState(buildDemoState(bangkokDate())),
  }
}

export type InventoryApi = ReturnType<typeof useInventory>
