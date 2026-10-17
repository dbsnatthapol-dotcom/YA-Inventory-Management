import type { Zone } from '../types/layout'
import type { MasterData, StaffBrief } from './types'

/** โซนที่มีหัวหน้าโซน (หน้าหลังบ้าน › หัวหน้าโซน) */
export const HEAD_KINDS = new Set(['storage', 'tent', 'receiving', 'inspection', 'ng', 'assembly', 'utility'])

export type ReadyTarget =
  | { kind: 'admin'; tab: 'users' | 'heads' | 'master' | 'import' | 'system'; sub?: 'parts' | 'fg' | 'rules' | 'locs' }
  | { kind: 'wms'; tab: 'count' }
  | { kind: 'layout' }

export interface ReadyItem {
  id: 'roles' | 'slots' | 'slotLabels' | 'heads' | 'uam' | 'bom' | 'rules' | 'opening' | 'live'
  title: string
  /** ต้องทำก่อนใช้งานจริง · false = แนะนำ */
  required: boolean
  /** null = ระบบตรวจเองไม่ได้ ให้ตรวจที่หน้างาน (ไม่นับในความคืบหน้า) */
  ok: boolean | null
  detail: string
  progress?: { done: number; total: number }
  action: { label: string; target: ReadyTarget }
}

export interface ReadyInput {
  staff: StaffBrief[]
  master: MasterData
  zones: Zone[]
  mode: 'trial' | 'live'
  /** กล่องในคลังของโหมดปัจจุบัน */
  boxes: number
  /** ใบตรวจนับที่อนุมัติแล้วในโหมดปัจจุบัน */
  countSheets: number
}

const list = (xs: string[], max = 4) => (xs.length > max ? `${xs.slice(0, max).join(', ')} และอีก ${xs.length - max}` : xs.join(', '))

/** สิ่งที่ต้องพร้อมก่อนใช้งานจริง คิดจากข้อมูลในระบบตอนนี้ */
export function buildReadiness({ staff, master, zones, mode, boxes, countSheets }: ReadyInput): ReadyItem[] {
  const people = (...roles: string[]) => staff.filter((s) => roles.includes(s.role)).length
  const needQi = master.models.some((m) => m.requiresInspection)
  const roles: [string, number][] = [
    ['คลัง', people('warehouse')],
    ...(needQi ? ([['MI3 คัดงาน', people('mi3')]] as [string, number][]) : []),
    ['ผู้อนุมัติปรับยอด (ผู้จัดการ/วิศวกร)', people('manager', 'engineer')],
  ]
  const optionalRoles: [string, number][] = [
    ['วางแผน', people('planner')],
    ['ผลิต', people('production')],
  ]

  const storeZones = zones.filter((z) => z.kind === 'storage' || z.kind === 'tent')
  const slots = master.locations.filter((l) => l.active && (l.kind === 'bin' || l.kind === 'floor'))
  const zonesWithSlots = storeZones.filter((z) => slots.some((l) => l.zoneId === z.id))
  const headZones = zones.filter((z) => HEAD_KINDS.has(z.kind))
  const headed = headZones.filter((z) => master.zoneHeads.some((h) => h.zoneId === z.id))
  const withUam = master.parts.filter((p) => p.uamCode)
  const bomModels = master.models.filter((m) => master.fgItems.some((f) => f.active && f.modelCode === m.code && f.lines.length > 0))

  return [
    {
      id: 'roles',
      title: 'บัญชีผู้ใช้ครบทุกบทบาทหน้างาน',
      required: true,
      ok: roles.every(([, n]) => n > 0),
      detail: [...roles, ...optionalRoles].map(([r, n]) => `${r} ${n} คน`).join(' · '),
      progress: { done: roles.filter(([, n]) => n > 0).length, total: roles.length },
      action: { label: 'เพิ่มผู้ใช้', target: { kind: 'admin', tab: 'users' } },
    },
    {
      id: 'slots',
      title: 'ช่องเก็บตามผังครบทุกโซน',
      required: true,
      ok: storeZones.length > 0 && zonesWithSlots.length === storeZones.length,
      detail: zonesWithSlots.length === storeZones.length ? `${slots.length.toLocaleString('en-US')} ช่องจาก ${storeZones.length} โซน` : `โซนที่ยังไม่มีช่อง: ${list(storeZones.filter((z) => !zonesWithSlots.includes(z)).map((z) => z.code))} · เปิดหน้าปรับผังแล้วกดบันทึกผัง`,
      progress: { done: zonesWithSlots.length, total: storeZones.length },
      action: { label: 'ปรับผัง', target: { kind: 'layout' } },
    },
    {
      id: 'slotLabels',
      title: 'ติดป้าย QR ที่ช่องเก็บ',
      required: true,
      ok: null,
      detail: 'พิมพ์ป้ายทีละโซน แล้วติดที่ช่อง · ตอนจัดเก็บสแกนป้ายช่องด้วยกล้องได้เลย ไม่ต้องพิมพ์รหัส',
      action: { label: 'พิมพ์ป้ายช่อง', target: { kind: 'admin', tab: 'master', sub: 'locs' } },
    },
    {
      id: 'bom',
      title: 'BOM ชุดวงล้อครบทุก Model',
      required: true,
      ok: master.models.length > 0 && bomModels.length === master.models.length,
      detail: bomModels.length === master.models.length ? `${master.fgItems.length} ชุดวงล้อ` : `ยังไม่มี BOM: ${list(master.models.filter((m) => !bomModels.includes(m)).map((m) => m.code))} · ใช้คำนวณใบเบิกเข้าไลน์จากจำนวนวง`,
      progress: { done: bomModels.length, total: master.models.length },
      action: { label: 'นำเข้า BOM (Excel)', target: { kind: 'admin', tab: 'import' } },
    },
    {
      id: 'opening',
      title: 'นำเข้ายอดของที่มีอยู่จริง (ยอดเปิดคลัง)',
      required: true,
      ok: boxes > 0 || countSheets > 0,
      detail: `กล่องในคลัง ${boxes.toLocaleString('en-US')} · ใบตรวจนับที่อนุมัติ ${countSheets} · นับทีละโซนด้วย Excel แล้วอนุมัติ`,
      action: { label: 'ตรวจนับ & อนุมัติ', target: { kind: 'wms', tab: 'count' } },
    },
    {
      id: 'live',
      title: 'เปิดโหมดใช้งานจริง',
      required: true,
      ok: mode === 'live',
      detail: mode === 'live' ? 'ทุกเครื่องบันทึกเป็นข้อมูลจริง' : 'ตอนนี้เป็นโหมดทดลอง · ข้อมูลทดลองจะไม่ปนกับของจริง',
      action: { label: 'โหมดระบบ', target: { kind: 'admin', tab: 'system' } },
    },
    {
      id: 'heads',
      title: 'หัวหน้าโซนครบทุกโซน',
      required: false,
      ok: headZones.length > 0 && headed.length === headZones.length,
      detail: 'ชื่อหัวหน้าโซนพิมพ์บนป้ายกล่อง และใช้ติดตามงานแต่ละพื้นที่',
      progress: { done: headed.length, total: headZones.length },
      action: { label: 'ตั้งหัวหน้าโซน', target: { kind: 'admin', tab: 'heads' } },
    },
    {
      id: 'uam',
      title: 'รหัส UAM ครบทุก part',
      required: false,
      ok: master.parts.length > 0 && withUam.length === master.parts.length,
      detail: 'ค้นหาและสแกนได้ทั้งรหัสลูกค้าและรหัส UAM',
      progress: { done: withUam.length, total: master.parts.length },
      action: { label: 'นำเข้ารหัส UAM (Excel)', target: { kind: 'admin', tab: 'import' } },
    },
    {
      id: 'rules',
      title: 'กฎโซนเก็บตามลูกค้า / กลุ่ม part',
      required: false,
      ok: master.rules.length > 0,
      detail: master.rules.length ? `${master.rules.length} กฎ · ตอนรับของระบบแนะนำโซนให้` : 'ยังไม่มีกฎ · ตอนรับของต้องเลือกโซนเองทุกรายการ',
      action: { label: 'ตั้งกฎโซน', target: { kind: 'admin', tab: 'master', sub: 'rules' } },
    },
  ]
}
