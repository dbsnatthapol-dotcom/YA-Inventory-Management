import type { FactoryLayout, Floor, Landmark, NavEdge, NavNode, Zone } from '../types/layout'

/**
 * ผังโรงงาน Union Autoparts Manufacturing (UAM1) — ระดับภาพรวม
 *
 * ที่มา: ภาพดาวเทียม docs/site/site-zones-draft.png
 * สเกลประมาณ 0.2 ม./พิกเซล (เทียบจากขนาดรถยนต์/รถบรรทุกบนถนน) ⇒ คลาดเคลื่อนได้ ±20%
 * ยืนยันกับเจ้าของแล้ว: อาคาร A = อาคารหลัก 3 ชั้น, B และ C = เต็นท์เก็บ FG/Component,
 *                   ทางเดินจากเต็นท์เข้าอาคาร A ใช้ประตูด้านหน้า (ฝั่งถนน)
 * ⚠️ สมมติฐาน (รอยืนยันหน้างาน): ตำแหน่งประตู, บันได, ลิฟต์, rack และไลน์ประกอบภายในอาคาร A
 *
 * พิกัด site: x = ไปทางขวาของภาพดาวเทียม, z = ลงล่าง (ไปทางถนน)
 */

const FLOOR_HEIGHT = 4.5

// อาคาร A: จุดมุมหลังซ้าย (ฝั่งทิศเหนือ) วางเอียงตามแนวที่ดิน ~12°
// พิกัดภายใน: x = ความกว้าง 62 ม. (ซ้าย→ขวา), z = ความยาว 98 ม. (ด้านหลัง→ด้านหน้าติดถนน)
const BUILDING_A = { x: 100, z: 19, rotation: 12, width: 62, depth: 98 }

// กริดทางเดินภายในอาคาร A (พิกัดภายใน)
const AISLE_COLS = [6, 18, 31, 44, 56]
const AISLE_ROWS = [8, 26, 44, 62, 80, 92]

const floors: Floor[] = [
  { id: 'F1', name: 'อาคาร A ชั้น 1', level: 1, elevation: 0, area: 'building', ...BUILDING_A },
  { id: 'F2', name: 'อาคาร A ชั้น 2', level: 2, elevation: FLOOR_HEIGHT, area: 'building', ...BUILDING_A },
  { id: 'F3', name: 'อาคาร A ชั้น 3', level: 3, elevation: FLOOR_HEIGHT * 2, area: 'building', ...BUILDING_A },
  { id: 'YARD', name: 'ลานนอกอาคาร', level: 1, elevation: 0, area: 'yard', x: 0, z: 0, width: 225, depth: 165 },
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
  // สมมติ: บันไดอยู่ด้านหน้าซ้ายใกล้ประตู, ลิฟต์ขนของอยู่กลางอาคารฝั่งขวา
  nodes.push({ id: `${floorId}-ST`, floorId, x: 2, z: 92 })
  nodes.push({ id: `${floorId}-LF`, floorId, x: 59, z: 44 })
  edges.push({ from: `${floorId}-ST`, to: node(floorId, 5, 0), mode: 'walk' })
  edges.push({ from: `${floorId}-LF`, to: node(floorId, 2, 4), mode: 'walk' })
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

// ทางเดินลานนอก: เต็นท์ B/C → ลาน → ทางเดินข้างอาคาร A → ประตูหน้า (ฝั่งถนน)
const yardNodes: NavNode[] = [
  { id: 'F1-DOOR', floorId: 'F1', x: 8, z: 98 }, // สมมติ: ประตูหน้าอาคาร A ฝั่งซ้าย
  { id: 'Y-B', floorId: 'YARD', x: 62, z: 51 }, // หน้าเต็นท์ B
  { id: 'Y-C', floorId: 'YARD', x: 58, z: 64 }, // หน้าเต็นท์ C
  { id: 'Y-J1', floorId: 'YARD', x: 63, z: 72 },
  { id: 'Y-J2', floorId: 'YARD', x: 83, z: 80 }, // ทางเดินระหว่างพื้นที่ G กับอาคาร A
  { id: 'Y-J3', floorId: 'YARD', x: 83, z: 113 },
]
const yardEdges: NavEdge[] = [
  { from: node('F1', 5, 0), to: 'F1-DOOR', mode: 'walk' },
  { from: 'F1-DOOR', to: 'Y-J3', mode: 'walk' },
  { from: 'Y-J3', to: 'Y-J2', mode: 'walk' },
  { from: 'Y-J2', to: 'Y-J1', mode: 'walk' },
  { from: 'Y-J1', to: 'Y-B', mode: 'walk' },
  { from: 'Y-J1', to: 'Y-C', mode: 'walk' },
]

const coreZones: Zone[] = buildingFloors.flatMap((f) => [
  { id: `${f}-STAIRS`, code: `${f}-STAIRS`, name: 'บันได', floorId: f, kind: 'stairs', x: 0, z: 87, width: 4, depth: 10, accessNodeId: `${f}-ST` },
  { id: `${f}-LIFT`, code: `${f}-LIFT`, name: 'ลิฟต์ขนของ', floorId: f, kind: 'lift', x: 58, z: 40, width: 4, depth: 8, accessNodeId: `${f}-LF` },
])

const zones: Zone[] = [
  ...coreZones,
  // อาคาร A ชั้น 1 — รับเข้า + คลังหลัก (ตำแหน่งสมมติ)
  { id: 'RCV-01', code: 'RCV-01', name: 'จุดรับเข้าสินค้า', floorId: 'F1', kind: 'receiving', x: 22, z: 94, width: 18, depth: 3.5, accessNodeId: node('F1', 5, 2) },
  { id: 'F1-RK-A', code: 'RK-A', name: 'Rack A', floorId: 'F1', kind: 'storage', x: 10, z: 12, width: 18, depth: 10, accessNodeId: node('F1', 1, 1), stores: ['Component'] },
  { id: 'F1-RK-B', code: 'RK-B', name: 'Rack B', floorId: 'F1', kind: 'storage', x: 34, z: 12, width: 18, depth: 10, accessNodeId: node('F1', 1, 3), stores: ['Component'] },
  { id: 'F1-RK-C', code: 'RK-C', name: 'Rack C', floorId: 'F1', kind: 'storage', x: 10, z: 48, width: 18, depth: 10, accessNodeId: node('F1', 2, 1), stores: ['Component'] },
  // ชั้น 2 — ไลน์ประกอบวงล้อ
  { id: 'F2-RK-D', code: 'RK-D', name: 'Rack D - Supermarket ชั้น 2', floorId: 'F2', kind: 'storage', x: 10, z: 66, width: 14, depth: 10, accessNodeId: node('F2', 3, 1), stores: ['Component'] },
  { id: 'F2-RK-E', code: 'RK-E', name: 'Rack E', floorId: 'F2', kind: 'storage', x: 34, z: 12, width: 18, depth: 10, accessNodeId: node('F2', 1, 3), stores: ['Component'] },
  { id: 'F2-ASM', code: 'ASM-W2', name: 'ไลน์ประกอบวงล้อ ชั้น 2', floorId: 'F2', kind: 'assembly', x: 30, z: 48, width: 24, depth: 10, accessNodeId: node('F2', 2, 3) },
  // ชั้น 3 — ไลน์ประกอบวงล้อ
  { id: 'F3-RK-F', code: 'RK-F', name: 'Rack F', floorId: 'F3', kind: 'storage', x: 10, z: 30, width: 18, depth: 10, accessNodeId: node('F3', 1, 1), stores: ['Component'] },
  { id: 'F3-ASM', code: 'ASM-W3', name: 'ไลน์ประกอบวงล้อ ชั้น 3', floorId: 'F3', kind: 'assembly', x: 30, z: 66, width: 24, depth: 10, accessNodeId: node('F3', 3, 3) },
  // ลานนอก — เต็นท์ (พิกัด site)
  { id: 'TENT-B', code: 'TENT-B', name: 'เต็นท์ B', floorId: 'YARD', kind: 'tent', x: 36, z: 23, width: 31, depth: 25, accessNodeId: 'Y-B', stores: ['FG', 'Component'] },
  { id: 'TENT-C', code: 'TENT-C', name: 'เต็นท์ C', floorId: 'YARD', kind: 'tent', x: 27, z: 49, width: 29, depth: 30, accessNodeId: 'Y-C', stores: ['FG', 'Component'] },
]

// เส้นขอบที่ดินตามเส้นสีแดงในภาพดาวเทียม
const boundary: [number, number][] = [
  [2, 86], [28, 16], [98, 17], [100, 8.4], [220, 10], [221, 34], [171, 23], [129, 160],
]

const landmarks: Landmark[] = [
  { id: 'E', name: 'สำนักงานใหญ่ (E)', kind: 'office', x: 101.4, z: 134, width: 35, depth: 18.6, rotation: 25.4, height: 8 },
  { id: 'D', name: 'อาคาร D', kind: 'building', x: 76.5, z: 44, width: 17, depth: 38, rotation: 0, height: 6 },
  { id: 'G', name: 'พื้นที่ G', kind: 'area', x: 44, z: 98, width: 66, depth: 24, rotation: 4, height: 0.2 },
  { id: 'F', name: 'พื้นที่ F', kind: 'area', x: 174, z: 21, width: 92, depth: 14, rotation: 6, height: 0.2 },
  { id: 'ROAD', name: 'ถ.ปู่เจ้าสมิงพราย', kind: 'road', x: 55.4, z: 140.3, width: 260, depth: 35, rotation: 30.2, height: 0.05 },
]

export const sampleLayout: FactoryLayout = {
  siteName: 'Union Autoparts Manufacturing',
  site: { boundary, landmarks },
  floors,
  zones,
  nodes: [...grids.flatMap((g) => g.nodes), ...yardNodes],
  edges: [...grids.flatMap((g) => g.edges), ...verticalEdges, ...yardEdges],
}
