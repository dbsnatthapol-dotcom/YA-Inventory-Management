import { palletsFor } from '../data/warehouse'
import type { FactoryLayout } from '../types/layout'
import { zonePlan } from '../wms/locations'
import type { MapActivity, ZoneContents } from '../wms/mapStock'
import { goodOf, stockMix, stockPartOf, type StockMix, type StockPart } from '../wms/stockMix'

export interface MapStats {
  /** ของดีพร้อมใช้ (ไม่นับกล่องรอ MI3 และพื้นที่ NG) */
  boiQty: number
  /** กล่องของดี (1 ป้าย = 1 กล่อง) นิยามเดียวกับ boiQty และหน้าภาพรวม */
  pallets: number
  /** องค์ประกอบสต็อก: ในช่องเก็บ / รอจัดเก็บ / รอ MI3 / NG */
  mix: StockMix
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

/**
 * ตัวเลขสรุปบนผัง 3D จากกล่องในระบบคลัง
 * unplaced = กล่องที่อยู่รหัสช่องที่ไม่มีบนผัง (วาดไม่ได้ แต่ยังเป็นของในคลัง · หน้าภาพรวมนับด้วย)
 */
export function mapStats(layout: FactoryLayout, stock: Map<string, ZoneContents>, activity: MapActivity, unplaced: { hold: boolean; qty: number }[] = []): MapStats {
  const parts: { part: StockPart; qty: number }[] = unplaced.map((b) => ({ part: stockPartOf(b.hold, undefined), qty: b.qty }))
  const out: Omit<MapStats, 'mix'> = { boiQty: 0, pallets: 0, slots: 0, usedSlots: 0, pendingQcQty: 0, pendingQcBoxes: 0, ngWaitingQty: 0, ...activity }
  for (const zone of layout.zones) {
    const s = stock.get(zone.id)
    const boxes = palletsFor(s)
    for (const b of boxes) parts.push({ part: stockPartOf(b.hold, zone.kind), qty: b.qty })
    out.pendingQcBoxes += boxes.filter((b) => b.hold).length
    out.pendingQcQty += s?.pendingQcQty ?? 0
    if (zone.kind === 'ng') out.ngWaitingQty += s?.totalQty ?? 0
    else out.boiQty += (s?.totalQty ?? 0) - (s?.pendingQcQty ?? 0)
    if (zone.kind !== 'storage') continue
    const capacity = zonePlan(layout, zone).slots.length
    out.slots += capacity
    out.usedSlots += Math.min(boxes.length, capacity)
  }
  for (const b of unplaced) {
    if (b.hold) {
      out.pendingQcBoxes++
      out.pendingQcQty += b.qty
    } else out.boiQty += b.qty
  }
  const mix = stockMix(parts)
  return { ...out, pallets: goodOf(mix).boxes, mix }
}
