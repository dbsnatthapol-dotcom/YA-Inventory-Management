import { bucketBalance, pendingInspection } from '../inventory/ledger'
import { PARTS } from '../inventory/masterData'
import { basePartNo } from '../wms/partCodes'
import type { InventoryState, Lot, Part } from '../inventory/types'
import type { FactoryLayout, Zone } from '../types/layout'

export type SearchHit =
  | { kind: 'zone'; zone: Zone }
  | { kind: 'lot'; lot: Lot; part: Part | undefined; zone: Zone | undefined; boi: number; pendingQc: number }

/** ไม่สนตัวพิมพ์เล็ก/ใหญ่ ช่องว่าง ขีด และ / · revision ท้ายรหัส (RAJ00537/B) ค้นด้วยเลขฐาน */
const norm = (s: string) => s.toUpperCase().replace(/[\s/\-_#.]/g, '')

const ZONE_KINDS = new Set<Zone['kind']>(['storage', 'receiving', 'assembly', 'tent', 'inspection', 'ng', 'utility'])

/**
 * ค้นหาบนผัง: โซน (รหัส/ชื่อ) และ lot ที่ยังมีของ (part no, ชื่อ part, เลข invoice, เลข lot)
 * เรียงให้ lot ที่ part no ตรงทั้งคำขึ้นก่อน และ lot ที่ยังอยู่บนชั้นวาง (BOI) ก่อน lot ที่หมดแล้ว
 */
export function searchMap(query: string, layout: FactoryLayout, state: InventoryState, limit = 8): SearchHit[] {
  const q = norm(query)
  if (q.length < 2) return []
  const qb = norm(basePartNo(query))
  const zones = new Map(layout.zones.map((z) => [z.id, z]))

  const zoneHits: SearchHit[] = layout.zones
    .filter((z) => ZONE_KINDS.has(z.kind) && (norm(z.code).includes(q) || norm(z.name).includes(q)))
    .map((zone) => ({ kind: 'zone', zone }))

  const lotHits = state.lots
    .map((lot) => {
      const part = PARTS.find((p) => p.partNo === lot.partNo)
      const fields = [lot.partNo, lot.invoiceNo, lot.id, part?.description ?? '']
      if (!fields.some((f) => norm(f).includes(q) || norm(f).includes(qb))) return null
      const boi = bucketBalance(state, lot.id, 'BOI')
      const exact = norm(lot.partNo) === qb || norm(lot.id) === q ? 0 : 1
      return { hit: { kind: 'lot', lot, part, zone: zones.get(lot.zoneId), boi, pendingQc: pendingInspection(state, lot) } as SearchHit, rank: exact * 2 + (boi > 0 ? 0 : 1) }
    })
    .filter((x): x is { hit: SearchHit; rank: number } => x !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.hit)

  return [...zoneHits, ...lotHits].slice(0, limit)
}
