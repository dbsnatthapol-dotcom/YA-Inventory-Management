// สร้าง supabase/seed.sql จากผังใน src/data/factoryLayout.ts
// ใช้: npm run seed:generate
import { writeFileSync } from 'node:fs'
import { sampleLayout } from '../src/data/factoryLayout'

type Value = string | number | string[] | undefined
const str = (v: string) => `'${v.replace(/'/g, "''")}'`
const q = (v: Value): string =>
  v === undefined ? 'null' : Array.isArray(v) ? `array[${v.map(str).join(', ')}]::text[]` : typeof v === 'number' ? String(v) : str(v)
const rows = (table: string, cols: string[], values: Value[][]) =>
  `insert into public.${table} (${cols.join(', ')}) values\n` +
  values.map((r) => `  (${r.map(q).join(', ')})`).join(',\n') +
  ';\n'

const SITE_ID = 'UAM1'
const { floors, nodes, edges, zones, site } = sampleLayout
const sql = [
  '-- สร้างอัตโนมัติจาก web/src/data/factoryLayout.ts — อย่าแก้ไขด้วยมือ',
  rows('floors', ['id', 'name', 'level', 'elevation', 'area', 'x', 'z', 'rotation', 'width', 'depth'],
    floors.map((f) => [f.id, f.name, f.level, f.elevation, f.area, f.x, f.z, f.rotation ?? 0, f.width, f.depth])),
  rows('nav_nodes', ['id', 'floor_id', 'x', 'z'], nodes.map((n) => [n.id, n.floorId, n.x, n.z])),
  rows('nav_edges', ['from_node_id', 'to_node_id', 'mode'], edges.map((e) => [e.from, e.to, e.mode])),
  rows('zones', ['id', 'code', 'name', 'floor_id', 'kind', 'x', 'z', 'width', 'depth', 'access_node_id', 'stores'],
    zones.map((z) => [z.id, z.code, z.name, z.floorId, z.kind, z.x, z.z, z.width, z.depth, z.accessNodeId, z.stores])),
  ...(site
    ? [
        rows('sites', ['id', 'name', 'boundary'], [[SITE_ID, sampleLayout.siteName, JSON.stringify(site.boundary)]]),
        rows('site_landmarks', ['id', 'site_id', 'name', 'kind', 'x', 'z', 'width', 'depth', 'rotation', 'height'],
          site.landmarks.map((l) => [l.id, SITE_ID, l.name, l.kind, l.x, l.z, l.width, l.depth, l.rotation, l.height])),
      ]
    : []),
].join('\n')

writeFileSync(new URL('../../supabase/seed.sql', import.meta.url), sql)
console.log(`seed.sql: ${floors.length} floors, ${nodes.length} nodes, ${edges.length} edges, ${zones.length} zones`)
