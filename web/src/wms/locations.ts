import { planRack, RACK, rackSpec } from '../data/warehouse'
import { zoneClearance } from '../lib/geometry'
import type { FactoryLayout, Zone } from '../types/layout'

export type LocationKind = 'bin' | 'floor' | 'staging' | 'hold' | 'ng'

export interface StorageLocation {
  code: string
  zoneId: string
  kind: LocationKind
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * ช่องเก็บตั้งต้นจากผัง: Rack = โซน-ช่อง-ชั้น (RK-A-01-1), เต็นท์ = โซน-บล็อก (TENT-T-01)
 * levelsOf: ระดับชั้นวางของแต่ละโซน (rack บนชั้นลอยเตี้ยกว่า ⇒ มีชั้นน้อยกว่า)
 * จุดรับเข้า / MI3 / NG เป็นช่องเดียวตามรหัสโซน
 */
export function defaultLocations(zones: Zone[], levelsOf: (zone: Zone) => readonly number[] = () => RACK.levels): StorageLocation[] {
  const out: StorageLocation[] = []
  for (const z of zones) {
    if (z.kind === 'storage') {
      const levels = levelsOf(z)
      const plan = planRack(z.width, z.depth, levels)
      const faces = plan.rows.reduce((s, r) => s + r.units, 0)
      const bays = Math.max(1, plan.bays * faces)
      for (let b = 1; b <= bays; b++)
        for (let l = 1; l <= levels.length; l++) out.push({ code: `${z.code}-${pad(b)}-${l}`, zoneId: z.id, kind: 'bin' })
    } else if (z.kind === 'tent') {
      const blocks = Math.max(4, Math.min(30, Math.floor(Math.max(z.width, z.depth) / 2.4)))
      for (let b = 1; b <= blocks; b++) out.push({ code: `${z.code}-${pad(b)}`, zoneId: z.id, kind: 'floor' })
    } else if (z.kind === 'receiving') out.push({ code: z.code, zoneId: z.id, kind: 'staging' })
    else if (z.kind === 'inspection') out.push({ code: z.code, zoneId: z.id, kind: 'hold' })
    else if (z.kind === 'ng') out.push({ code: z.code, zoneId: z.id, kind: 'ng' })
  }
  return out
}

/** ช่องเก็บของทั้งผัง (จำนวนชั้นวางตามระยะถึงเพดานของแต่ละโซน) */
export const layoutLocations = (layout: Pick<FactoryLayout, 'zones' | 'floors'>) =>
  defaultLocations(layout.zones, (z) => rackSpec(zoneClearance(layout.floors, z)).levels)

/** รหัสโซนจากรหัสช่อง: RK-C-01-1 → RK-C, TENT-T-03 → TENT-T */
export const zoneCodeOf = (loc: string) => {
  const parts = loc.split('-')
  return parts.length >= 3 ? parts.slice(0, 2).join('-') : loc
}
