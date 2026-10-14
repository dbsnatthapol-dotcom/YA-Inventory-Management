import { createClient } from '@supabase/supabase-js'
import { sampleLayout } from '../data/factoryLayout'
import type { FactoryLayout } from '../types/layout'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase = url && anonKey ? createClient(url, anonKey) : null

export interface LoadedLayout {
  layout: FactoryLayout
  source: 'supabase' | 'sample'
}

/** โหลดผังจาก Supabase ถ้าตั้งค่าไว้และมีข้อมูล ไม่เช่นนั้นใช้ผังตัวอย่าง */
export async function loadLayout(): Promise<LoadedLayout> {
  if (!supabase) return { layout: sampleLayout, source: 'sample' }

  const [floors, zones, nodes, edges, sites, landmarks] = await Promise.all([
    supabase.from('floors').select('id, name, level, elevation, area, x, z, rotation, width, depth').order('level'),
    supabase.from('zones').select('id, code, name, floorId:floor_id, kind, x, z, width, depth, accessNodeId:access_node_id, stores'),
    supabase.from('nav_nodes').select('id, floorId:floor_id, x, z'),
    supabase.from('nav_edges').select('from:from_node_id, to:to_node_id, mode'),
    supabase.from('sites').select('id, name, boundary').limit(1),
    supabase.from('site_landmarks').select('id, name, kind, x, z, width, depth, rotation, height'),
  ])
  const error = floors.error ?? zones.error ?? nodes.error ?? edges.error ?? sites.error ?? landmarks.error
  if (error) {
    console.warn('โหลดผังจาก Supabase ไม่สำเร็จ ใช้ผังตัวอย่างแทน:', error.message)
    return { layout: sampleLayout, source: 'sample' }
  }
  if (!floors.data?.length) return { layout: sampleLayout, source: 'sample' }

  const site = sites.data?.[0]
  return {
    source: 'supabase',
    layout: {
      siteName: site?.name ?? sampleLayout.siteName,
      site: site ? { boundary: site.boundary, landmarks: landmarks.data ?? [] } : undefined,
      floors: floors.data,
      zones: zones.data,
      nodes: nodes.data,
      edges: edges.data,
    } as FactoryLayout,
  }
}
