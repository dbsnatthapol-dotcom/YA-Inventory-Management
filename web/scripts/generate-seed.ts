// สร้าง supabase/seed.sql จากผังตัวอย่างใน src/data/factoryLayout.ts
// ใช้: npm run seed:generate
import { writeFileSync } from 'node:fs'
import { sampleLayout } from '../src/data/factoryLayout'

const q = (v: string | number) => (typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`)
const rows = (table: string, cols: string[], values: (string | number)[][]) =>
  `insert into public.${table} (${cols.join(', ')}) values\n` +
  values.map((r) => `  (${r.map(q).join(', ')})`).join(',\n') +
  ';\n'

const { floors, nodes, edges, zones } = sampleLayout
const sql = [
  '-- สร้างอัตโนมัติจาก web/src/data/factoryLayout.ts — อย่าแก้ไขด้วยมือ',
  rows('floors', ['id', 'name', 'level', 'elevation', 'area', 'x', 'z', 'width', 'depth'],
    floors.map((f) => [f.id, f.name, f.level, f.elevation, f.area, f.x, f.z, f.width, f.depth])),
  rows('nav_nodes', ['id', 'floor_id', 'x', 'z'], nodes.map((n) => [n.id, n.floorId, n.x, n.z])),
  rows('nav_edges', ['from_node_id', 'to_node_id', 'mode'], edges.map((e) => [e.from, e.to, e.mode])),
  rows('zones', ['id', 'code', 'name', 'floor_id', 'kind', 'x', 'z', 'width', 'depth', 'access_node_id'],
    zones.map((z) => [z.id, z.code, z.name, z.floorId, z.kind, z.x, z.z, z.width, z.depth, z.accessNodeId])),
].join('\n')

writeFileSync(new URL('../../supabase/seed.sql', import.meta.url), sql)
console.log(`seed.sql: ${floors.length} floors, ${nodes.length} nodes, ${edges.length} edges, ${zones.length} zones`)
