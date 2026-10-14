import type { ZoneKind } from '../types/layout'

export const ZONE_STYLE: Record<ZoneKind, { color: string; height: number; label: string }> = {
  storage: { color: '#38bdf8', height: 2.5, label: 'ชั้นวาง/Rack' },
  receiving: { color: '#facc15', height: 0.6, label: 'รับเข้า' },
  assembly: { color: '#f472b6', height: 1.2, label: 'ไลน์ประกอบ' },
  tent: { color: '#a3e635', height: 4, label: 'เต็นท์' },
  stairs: { color: '#94a3b8', height: 1.5, label: 'บันได' },
  lift: { color: '#c084fc', height: 3, label: 'ลิฟต์' },
  inspection: { color: '#fb923c', height: 1, label: 'ตรวจ MI3' },
  ng: { color: '#ef4444', height: 1.8, label: 'กัก NG' },
  utility: { color: '#94a3b8', height: 1.5, label: 'ชาร์จรถยก/พาเลทเปล่า' },
}
