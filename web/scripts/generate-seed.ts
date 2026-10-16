// สร้าง supabase/seed.sql จากผังใน src/data/factoryLayout.ts
// ใช้: npm run seed:generate
import { writeFileSync } from 'node:fs'
import { sampleLayout } from '../src/data/factoryLayout'
import { CUSTOMERS, MODELS, PARTS, ZONE_RULES } from '../src/inventory/masterData'
import { layoutLocations } from '../src/wms/locations'

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
  rows('floors', ['id', 'name', 'level', 'elevation', 'area', 'x', 'z', 'rotation', 'width', 'depth', 'building', 'mezzanine'],
    floors.map((f) => [f.id, f.name, f.level, f.elevation, f.area, f.x, f.z, f.rotation ?? 0, f.width, f.depth, f.building ?? 'A', f.mezzanine ? 'true' : 'false'])),
  rows('nav_nodes', ['id', 'floor_id', 'x', 'z'], nodes.map((n) => [n.id, n.floorId, n.x, n.z])),
  rows('nav_edges', ['from_node_id', 'to_node_id', 'mode'], edges.map((e) => [e.from, e.to, e.mode])),
  rows('zones', ['id', 'code', 'name', 'floor_id', 'kind', 'x', 'z', 'width', 'depth', 'access_node_id', 'stores', 'storage', 'levels', 'slots_per_level'],
    zones.map((z) => [z.id, z.code, z.name, z.floorId, z.kind, z.x, z.z, z.width, z.depth, z.accessNodeId, z.stores, z.storage, z.levels, z.slotsPerLevel])),
  ...(site
    ? [
        rows('sites', ['id', 'name', 'boundary'], [[SITE_ID, sampleLayout.siteName, JSON.stringify(site.boundary)]]),
        rows('site_landmarks', ['id', 'site_id', 'name', 'kind', 'x', 'z', 'width', 'depth', 'rotation', 'height'],
          site.landmarks.map((l) => [l.id, SITE_ID, l.name, l.kind, l.x, l.z, l.width, l.depth, l.rotation, l.height])),
      ]
    : []),
  '-- Master: ลูกค้า, Model, Part (Royal Enfield K1G) และกฎแนะนำโซน',
  rows('customers', ['id', 'name'], CUSTOMERS.map((c) => [c.id, c.name])),
  rows('product_models', ['code', 'customer_id', 'requires_inspection'],
    MODELS.map((m) => [m.code, m.customerId, m.requiresInspection ? 'true' : 'false']).map((r) => r as Value[])),
  rows('parts', ['part_no', 'name', 'part_type', 'customer_id'], PARTS.map((p) => [p.partNo, p.description, p.type, p.customerId])),
  PARTS.flatMap((p) => p.models.map((m) =>
    `insert into public.part_models (part_id, model_code) select id, ${q(m)} from public.parts where part_no = ${q(p.partNo)};`)).join('\n') + '\n',
  rows('zone_rules', ['customer_id', 'part_type', 'zone_id'], ZONE_RULES.map((r) => [r.customerId, r.type ?? undefined, r.zoneId])),
  '-- ช่องเก็บตั้งต้น (โซนเก็บ = โซน-ที่วาง-ชั้น, เต็นท์ = โซน-บล็อก) — สร้างใหม่ตามผังเมื่อกดบันทึกผัง',
  rows('locations', ['code', 'zone_id', 'kind'], layoutLocations(sampleLayout).map((l) => [l.code, l.zoneId, l.kind])),
].join('\n')

writeFileSync(new URL('../../supabase/seed.sql', import.meta.url), sql)
console.log(`seed.sql: ${floors.length} floors, ${nodes.length} nodes, ${edges.length} edges, ${zones.length} zones`)
