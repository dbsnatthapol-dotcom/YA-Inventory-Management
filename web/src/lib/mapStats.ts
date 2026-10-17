import { palletsFor } from '../data/warehouse'
import type { FactoryLayout } from '../types/layout'
import { zonePlan } from '../wms/locations'
import type { MapActivity, ZoneContents } from '../wms/mapStock'

export interface MapStats {
  /** ของดีพร้อมใช้ (ไม่นับกล่องรอ MI3 และพื้นที่ NG) */
  boiQty: number
  /** กล่อง/พาเลท (1 ป้าย = 1 กล่อง) */
  pallets: number
  /** ช่องพาเลทบน rack ทั้งหมด / ที่ใช้อยู่ */
  slots: number
  usedSlots: number
  pendingQcQty: number
  pendingQcBoxes: number
  issuedToday: number
  receiptsToday: number
  ngWaitingQty: number
  ngFoundToday: number
}

/** ตัวเลขสรุปบนผัง 3D จากกล่องในระบบคลัง */
export function mapStats(layout: FactoryLayout, stock: Map<string, ZoneContents>, activity: MapActivity): MapStats {
  const out: MapStats = { boiQty: 0, pallets: 0, slots: 0, usedSlots: 0, pendingQcQty: 0, pendingQcBoxes: 0, ngWaitingQty: 0, ...activity }
  for (const zone of layout.zones) {
    const s = stock.get(zone.id)
    const boxes = palletsFor(s)
    out.pallets += boxes.length
    out.pendingQcBoxes += boxes.filter((b) => b.hold).length
    out.pendingQcQty += s?.pendingQcQty ?? 0
    if (zone.kind === 'ng') out.ngWaitingQty += s?.totalQty ?? 0
    else out.boiQty += (s?.totalQty ?? 0) - (s?.pendingQcQty ?? 0)
    if (zone.kind !== 'storage') continue
    const capacity = zonePlan(layout, zone).slots.length
    out.slots += capacity
    out.usedSlots += Math.min(boxes.length, capacity)
  }
  return out
}
