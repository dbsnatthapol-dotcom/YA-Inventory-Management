import { palletsFor, planRack } from '../data/warehouse'
import { bucketBalance } from '../inventory/ledger'
import { dashboardSummary, type ZoneContents } from '../inventory/reports'
import type { InventoryState } from '../inventory/types'
import type { FactoryLayout } from '../types/layout'

export interface MapStats {
  boiQty: number
  pallets: number
  /** ช่องพาเลทบน rack ทั้งหมด / ที่ใช้อยู่ */
  slots: number
  usedSlots: number
  pendingQcQty: number
  pendingQcLots: number
  issuedToday: number
  receiptsToday: number
  ngWaitingQty: number
  ngFoundToday: number
}

/** ตัวเลขสรุปที่แสดงบนผัง 3D */
export function mapStats(layout: FactoryLayout, state: InventoryState, stock: Map<string, ZoneContents>, today: string): MapStats {
  const day = dashboardSummary(state, today)
  let slots = 0
  let usedSlots = 0
  let pallets = 0
  for (const zone of layout.zones) {
    const n = palletsFor(stock.get(zone.id)).length
    pallets += n
    if (zone.kind !== 'storage') continue
    const capacity = planRack(zone.width, zone.depth).slots.length
    slots += capacity
    usedSlots += Math.min(n, capacity)
  }
  const pendingLots = [...stock.values()].flatMap((z) => z.items).filter((i) => i.pendingQc > 0)
  return {
    boiQty: state.lots.reduce((s, l) => s + bucketBalance(state, l.id, 'BOI'), 0),
    pallets,
    slots,
    usedSlots,
    pendingQcQty: day.pendingQcQty,
    pendingQcLots: pendingLots.length,
    issuedToday: day.issuedQty,
    receiptsToday: day.receipts,
    ngWaitingQty: state.lots.reduce((s, l) => s + bucketBalance(state, l.id, 'NG_CUSTOMER') + bucketBalance(state, l.id, 'NG_SUPPLIER'), 0),
    ngFoundToday: day.ngFoundQty,
  }
}
