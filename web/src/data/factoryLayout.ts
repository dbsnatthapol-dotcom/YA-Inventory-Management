import type { FactoryLayout, Floor, NavEdge, NavNode, Zone } from '../types/layout'

/**
 * ผังโรงงาน "ตัวอย่าง" ของ Union Autoparts Manufacturing
 *
 * ⚠️ ขนาดและตำแหน่งทั้งหมดเป็นค่าสมมติ (placeholder) เพื่อให้เห็นโครงร่างก่อน
 * เมื่อได้แบบแปลนจริง (ขนาดอาคาร, ตำแหน่งบันได/ลิฟต์, ตำแหน่ง rack, ไลน์ประกอบ)
 * ให้แก้ไขไฟล์นี้ หรือย้ายข้อมูลไปเก็บใน Supabase
 *
 * หน่วย: เมตร  แกน x = ความยาวอาคาร, แกน z = ความกว้างอาคาร
 */

const FLOOR_HEIGHT = 4.5
const BUILDING = { x: 0, z: 0, width: 60, depth: 40 }

// กริดทางเดินภายในอาคาร: 3 แถว (z) x 6 คอลัมน์ (x)
const AISLE_ROWS = [8, 20, 32]
const AISLE_COLS = [5, 15, 25, 35, 45, 55]

const floors: Floor[] = [
  { id: 'F1', name: 'ชั้น 1', level: 1, elevation: 0, area: 'building', ...BUILDING },
  { id: 'F2', name: 'ชั้น 2', level: 2, elevation: FLOOR_HEIGHT, area: 'building', ...BUILDING },
  { id: 'F3', name: 'ชั้น 3', level: 3, elevation: FLOOR_HEIGHT * 2, area: 'building', ...BUILDING },
  { id: 'YARD', name: 'ลานนอกอาคาร', level: 1, elevation: 0, area: 'yard', x: 64, z: 0, width: 30, depth: 40 },
]

const node = (floorId: string, row: number, col: number) => `${floorId}-r${row}c${col}`

function buildFloorGrid(floorId: string): { nodes: NavNode[]; edges: NavEdge[] } {
  const nodes: NavNode[] = []
  const edges: NavEdge[] = []
  AISLE_ROWS.forEach((z, r) =>
    AISLE_COLS.forEach((x, c) => {
      nodes.push({ id: node(floorId, r, c), floorId, x, z })
      if (c > 0) edges.push({ from: node(floorId, r, c - 1), to: node(floorId, r, c), mode: 'walk' })
      if (r > 0) edges.push({ from: node(floorId, r - 1, c), to: node(floorId, r, c), mode: 'walk' })
    }),
  )
  // บันได (มุมซ้าย) และ ลิฟต์ขนของ (มุมขวาล่าง)
  nodes.push({ id: `${floorId}-ST`, floorId, x: 2, z: 20 })
  nodes.push({ id: `${floorId}-LF`, floorId, x: 58, z: 36 })
  edges.push({ from: `${floorId}-ST`, to: node(floorId, 1, 0), mode: 'walk' })
  edges.push({ from: `${floorId}-LF`, to: node(floorId, 2, 5), mode: 'walk' })
  return { nodes, edges }
}

const buildingFloors = ['F1', 'F2', 'F3']
const grids = buildingFloors.map(buildFloorGrid)

const verticalEdges: NavEdge[] = [
  { from: 'F1-ST', to: 'F2-ST', mode: 'stairs' },
  { from: 'F2-ST', to: 'F3-ST', mode: 'stairs' },
  { from: 'F1-LF', to: 'F2-LF', mode: 'lift' },
  { from: 'F2-LF', to: 'F3-LF', mode: 'lift' },
]

// ลานนอกอาคาร: ประตูชั้น 1 → ลาน → เต็นท์ 2 หลัง
const yardNodes: NavNode[] = [
  { id: 'F1-DOOR', floorId: 'F1', x: 60, z: 20 },
  { id: 'Y-GATE', floorId: 'YARD', x: 66, z: 20 },
  { id: 'Y-J1', floorId: 'YARD', x: 72, z: 20 },
  { id: 'Y-T1', floorId: 'YARD', x: 72, z: 9 },
  { id: 'Y-T2', floorId: 'YARD', x: 72, z: 31 },
]
const yardEdges: NavEdge[] = [
  { from: node('F1', 1, 5), to: 'F1-DOOR', mode: 'walk' },
  { from: 'F1-DOOR', to: 'Y-GATE', mode: 'walk' },
  { from: 'Y-GATE', to: 'Y-J1', mode: 'walk' },
  { from: 'Y-J1', to: 'Y-T1', mode: 'walk' },
  { from: 'Y-J1', to: 'Y-T2', mode: 'walk' },
]

const coreZones: Zone[] = buildingFloors.flatMap((f) => [
  { id: `${f}-STAIRS`, code: `${f}-STAIRS`, name: 'บันได', floorId: f, kind: 'stairs', x: 0, z: 16, width: 4, depth: 8, accessNodeId: `${f}-ST` },
  { id: `${f}-LIFT`, code: `${f}-LIFT`, name: 'ลิฟต์ขนของ', floorId: f, kind: 'lift', x: 56, z: 34, width: 4, depth: 4, accessNodeId: `${f}-LF` },
])

const zones: Zone[] = [
  ...coreZones,
  // ชั้น 1 — รับเข้า + คลังหลัก
  { id: 'RCV-01', code: 'RCV-01', name: 'จุดรับเข้าสินค้า', floorId: 'F1', kind: 'receiving', x: 48, z: 1, width: 10, depth: 5, accessNodeId: node('F1', 0, 5) },
  { id: 'F1-RK-A', code: 'RK-A', name: 'Rack A - น็อต/สกรู', floorId: 'F1', kind: 'storage', x: 10, z: 10, width: 20, depth: 8, accessNodeId: node('F1', 1, 1) },
  { id: 'F1-RK-B', code: 'RK-B', name: 'Rack B - ดุมล้อ', floorId: 'F1', kind: 'storage', x: 10, z: 22, width: 20, depth: 8, accessNodeId: node('F1', 1, 2) },
  { id: 'F1-RK-C', code: 'RK-C', name: 'Rack C - กระทะล้อ', floorId: 'F1', kind: 'storage', x: 34, z: 22, width: 16, depth: 8, accessNodeId: node('F1', 1, 4) },
  // ชั้น 2 — ไลน์ประกอบวงล้อ 2
  { id: 'F2-RK-D', code: 'RK-D', name: 'Rack D - Supermarket ชั้น 2', floorId: 'F2', kind: 'storage', x: 10, z: 10, width: 10, depth: 8, accessNodeId: node('F2', 1, 1) },
  { id: 'F2-RK-E', code: 'RK-E', name: 'Rack E - ซีล/ลูกปืน', floorId: 'F2', kind: 'storage', x: 30, z: 10, width: 20, depth: 8, accessNodeId: node('F2', 0, 3) },
  { id: 'F2-ASM', code: 'ASM-W2', name: 'ไลน์ประกอบวงล้อ ชั้น 2', floorId: 'F2', kind: 'assembly', x: 30, z: 22, width: 24, depth: 8, accessNodeId: node('F2', 1, 4) },
  // ชั้น 3 — ไลน์ประกอบวงล้อ 3
  { id: 'F3-RK-F', code: 'RK-F', name: 'Rack F - ชิ้นส่วนสำรอง', floorId: 'F3', kind: 'storage', x: 10, z: 22, width: 20, depth: 8, accessNodeId: node('F3', 1, 2) },
  { id: 'F3-ASM', code: 'ASM-W3', name: 'ไลน์ประกอบวงล้อ ชั้น 3', floorId: 'F3', kind: 'assembly', x: 30, z: 10, width: 24, depth: 8, accessNodeId: node('F3', 1, 4) },
  // ลานนอก — เต็นท์ 2 หลัง
  { id: 'TENT-1', code: 'TENT-1', name: 'เต็นท์ 1', floorId: 'YARD', kind: 'tent', x: 74, z: 2, width: 14, depth: 14, accessNodeId: 'Y-T1' },
  { id: 'TENT-2', code: 'TENT-2', name: 'เต็นท์ 2', floorId: 'YARD', kind: 'tent', x: 74, z: 24, width: 14, depth: 14, accessNodeId: 'Y-T2' },
]

export const sampleLayout: FactoryLayout = {
  siteName: 'Union Autoparts Manufacturing',
  floors,
  zones,
  nodes: [...grids.flatMap((g) => g.nodes), ...yardNodes],
  edges: [...grids.flatMap((g) => g.edges), ...verticalEdges, ...yardEdges],
}
