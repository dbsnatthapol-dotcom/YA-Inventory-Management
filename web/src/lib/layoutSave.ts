import type { FactoryLayout } from '../types/layout'
import { layoutLocations, type LocationKind } from '../wms/locations'
import { applyLayoutEdits, layoutChanges, type LayoutEdits, type LayoutSave } from './layoutEdit'

export interface LayoutSavePayload extends LayoutSave {
  /** ช่องเก็บที่ควรมีของโซนที่แก้ (ช่องอื่นของโซนปิดใช้ — ถ้ายังมีของ ระบบไม่ให้บันทึก) */
  locations: { zoneId: string; kind: LocationKind; codes: string[] }[]
}

/** แปลงการแก้ผังเป็นข้อมูลส่ง layout_save */
export function layoutSavePayload(base: FactoryLayout, edits: LayoutEdits): LayoutSavePayload {
  const save = layoutChanges(base, edits)
  const locs = layoutLocations(applyLayoutEdits(base, edits), save.zones)
  const locations = save.zones
    .filter((z) => ['storage', 'tent', 'receiving', 'inspection', 'ng'].includes(z.kind))
    .map((z) => {
      const own = locs.filter((l) => l.zoneId === z.id)
      const kind: LocationKind = own[0]?.kind ?? (z.storage === 'rack' ? 'bin' : 'floor')
      return { zoneId: z.id, kind, codes: own.map((l) => l.code) }
    })
  return { ...save, locations }
}
