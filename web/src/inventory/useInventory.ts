import { useCallback, useEffect, useState } from 'react'
import { buildDemoState } from './demoSeed'
import { InventoryError, moveLot, receiveInvoice, type MoveInput, type ReceiveLineInput } from './ledger'
import { bangkokDate } from './reports'
import type { InventoryState, Receipt } from './types'

// demo เก็บข้อมูลในเบราว์เซอร์ของผู้ใช้เท่านั้น — ระบบจริงจะเก็บใน Supabase
const STORAGE_KEY = 'uam-inventory-demo-v2'
const OPERATOR_KEY = 'uam-inventory-operator'

function load(): InventoryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as InventoryState
  } catch {
    // เปิดแบบ private หรือบล็อก storage: ใช้ข้อมูลตัวอย่างแทน
  }
  return buildDemoState(bangkokDate(), new Date().toISOString())
}

function loadOperator(): string {
  try {
    return localStorage.getItem(OPERATOR_KEY) || 'ทีมรับเข้า'
  } catch {
    return 'ทีมรับเข้า'
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string }

export function useInventory() {
  const [state, setState] = useState<InventoryState>(load)
  /** ผู้บันทึกรายการ — ติดไปกับทุก movement เพื่อตรวจย้อนหลังได้ว่าใครทำ */
  const [operator, setOperatorState] = useState(loadOperator)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // ไม่บันทึกก็ใช้งานต่อได้
    }
  }, [state])

  // อัปเดตทันทีเมื่อแท็บ/หน้าต่างอื่นบันทึกรายการ (demo ของ realtime — ระบบจริงใช้ Supabase Realtime)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        setState(JSON.parse(e.newValue) as InventoryState)
      } catch {
        // ข้อมูลเสีย: เก็บของเดิมไว้
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setOperator = (name: string) => {
    setOperatorState(name)
    try {
      localStorage.setItem(OPERATOR_KEY, name)
    } catch {
      // ไม่บันทึกก็ใช้งานต่อได้
    }
  }

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
    operator,
    setOperator,
    receive: (receipt: Omit<Receipt, 'id' | 'receivedAt' | 'receivedBy'>, lines: ReceiveLineInput[]) =>
      run((s) => receiveInvoice(s, { ...receipt, receivedBy: operator }, lines)),
    move: (input: Omit<MoveInput, 'by'>) => run((s) => moveLot(s, { ...input, by: operator })),
    resetDemo: () => setState(buildDemoState(bangkokDate(), new Date().toISOString())),
  }
}

export type InventoryApi = ReturnType<typeof useInventory>
