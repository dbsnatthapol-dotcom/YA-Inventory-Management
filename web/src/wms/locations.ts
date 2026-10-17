import { storagePlan, type StoragePlan } from '../data/warehouse'
import { zoneClearance } from '../lib/geometry'
import type { FactoryLayout, Zone } from '../types/layout'

export type LocationKind = 'bin' | 'floor' | 'staging' | 'hold' | 'ng'

export interface StorageLocation {
  code: string
  zoneId: string
  kind: LocationKind
}

export const pad = (n: number) => String(n).padStart(2, '0')

/** จำนวนบล็อกวางของในเต็นท์: แบ่งตามแนวยาวทุก ~2.4 ม. (4–30 บล็อก) */
export const tentBlocks = (zone: Pick<Zone, 'width' | 'depth'>) => Math.max(4, Math.min(30, Math.floor(Math.max(zone.width, zone.depth) / 2.4)))

/**
 * ช่องเก็บตั้งต้นจากผัง: โซนเก็บของ = โซน-ที่วาง-ชั้น (RK-A-01-1 = ที่วางที่ 1 ชั้นล่าง) 1 ช่องต่อ 1 พาเลท
 * เต็นท์ = โซน-บล็อก (TENT-T-01) · จุดรับเข้า / MI3 / NG เป็นช่องเดียวตามรหัสโซน
 * planOf: แผนวางพาเลทของโซน (ประเภท จำนวนชั้น ที่วางต่อชั้น)
 */
export function defaultLocations(zones: Zone[], planOf: (zone: Zone) => StoragePlan = (z) => storagePlan(z)): StorageLocation[] {
  const out: StorageLocation[] = []
  for (const z of zones) {
    if (z.kind === 'storage') {
      const plan = planOf(z)
      const kind: LocationKind = plan.type === 'rack' ? 'bin' : 'floor'
      for (let p = 1; p <= plan.perLevel; p++)
        for (let l = 1; l <= plan.levels.length; l++) out.push({ code: `${z.code}-${pad(p)}-${l}`, zoneId: z.id, kind })
    } else if (z.kind === 'tent') {
      for (let b = 1; b <= tentBlocks(z); b++) out.push({ code: `${z.code}-${pad(b)}`, zoneId: z.id, kind: 'floor' })
    } else if (z.kind === 'receiving') out.push({ code: z.code, zoneId: z.id, kind: 'staging' })
    else if (z.kind === 'inspection') out.push({ code: z.code, zoneId: z.id, kind: 'hold' })
    else if (z.kind === 'ng') out.push({ code: z.code, zoneId: z.id, kind: 'ng' })
  }
  return out
}

/** แผนวางพาเลทของโซนในผัง (ระยะถึงเพดานจำกัดจำนวนชั้น เช่น บนชั้นลอย) */
export const zonePlan = (layout: Pick<FactoryLayout, 'floors'>, zone: Zone) => storagePlan(zone, zoneClearance(layout.floors, zone))

/** ช่องเก็บของทั้งผัง */
export const layoutLocations = (layout: Pick<FactoryLayout, 'zones' | 'floors'>, zones: Zone[] = layout.zones) => defaultLocations(zones, (z) => zonePlan(layout, z))

/** รหัสโซนจากรหัสช่อง: RK-C-01-1 → RK-C, TENT-T-03 → TENT-T */
export const zoneCodeOf = (loc: string) => {
  const parts = loc.split('-')
  return parts.length >= 3 ? parts.slice(0, 2).join('-') : loc
}
