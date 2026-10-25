import type { FactoryLayout } from '../types/layout'
import { bangkokDay } from './ledger'
import type { Grn, Lpn, MasterData, Requisition, Tx } from './types'

/** ของ 1 part ในกล่อง (ป้าย LPN) ที่อยู่ในโซน */
export interface ZoneItem {
  key: string
  lpnNo: string
  /** ช่องเก็บที่กล่องอยู่ */
  location: string
  partNo: string
  name: string
  model: string
  qty: number
  /** กล่องรอตรวจ MI3 (ยังเบิกไม่ได้) */
  pendingQc: number
}

/** ของในโซนจากกล่องที่ยังใช้งานในระบบคลัง — ใช้กับผัง 3D แผงโซน ไกด์ และหน้าปรับผัง */
export interface ZoneContents {
  zoneId: string
  totalQty: number
  /** ในนั้นรอตรวจ MI3 กี่ชิ้น */
  pendingQcQty: number
  models: { model: string; qty: number }[]
  items: ZoneItem[]
}

export const emptyZone = (zoneId: string): ZoneContents => ({ zoneId, totalQty: 0, pendingQcQty: 0, models: [], items: [] })

/** รหัสช่องเก็บ/โซน → โซนบนผัง: ตารางช่องเก็บก่อน แล้วรหัสโซน แล้วรหัสโซนที่ยาวที่สุดที่เป็นคำนำหน้า (RK-A-01-1 → RK-A) */
export function zoneLocator(master: Pick<MasterData, 'locations'>, layout: Pick<FactoryLayout, 'zones'>): (loc: string) => string | null {
  const byLoc = new Map(master.locations.map((l) => [l.code, l.zoneId]))
  const byCode = new Map(layout.zones.map((z) => [z.code, z.id]))
  const prefixes = [...layout.zones].sort((a, b) => b.code.length - a.code.length)
  return (loc) => byLoc.get(loc) ?? byCode.get(loc) ?? prefixes.find((z) => loc.startsWith(`${z.code}-`))?.id ?? null
}

/** โซน → ของในโซน (1 ป้าย = 1 กล่อง/พาเลทบนผัง) · Model ตามใบรับสินค้าของกล่อง */
export function buildZoneStock(lpns: Lpn[], master: Pick<MasterData, 'locations' | 'parts'>, layout: Pick<FactoryLayout, 'zones'>): Map<string, ZoneContents> {
  const zoneOf = zoneLocator(master, layout)
  const parts = new Map(master.parts.map((p) => [p.partNo, p]))
  const out = new Map<string, ZoneContents>()
  for (const l of lpns) {
    const zoneId = l.status === 'active' ? zoneOf(l.locationCode) : null
    if (!zoneId) continue
    for (const i of l.items) {
      if (i.qty <= 0) continue
      const part = parts.get(i.partNo)
      const z = out.get(zoneId) ?? emptyZone(zoneId)
      out.set(zoneId, z)
      z.items.push({
        key: `${l.lpnNo}:${i.id}`,
        lpnNo: l.lpnNo,
        location: l.locationCode,
        partNo: i.partNo,
        name: part?.name ?? '',
        model: l.modelCode || part?.models[0] || '–',
        qty: i.qty,
        pendingQc: l.hold ? i.qty : 0,
      })
    }
  }
  for (const z of out.values()) {
    z.items.sort((a, b) => a.model.localeCompare(b.model) || a.partNo.localeCompare(b.partNo) || a.lpnNo.localeCompare(b.lpnNo))
    z.totalQty = z.items.reduce((s, i) => s + i.qty, 0)
    z.pendingQcQty = z.items.reduce((s, i) => s + i.pendingQc, 0)
    const byModel = new Map<string, number>()
    for (const i of z.items) byModel.set(i.model, (byModel.get(i.model) ?? 0) + i.qty)
    z.models = [...byModel].map(([model, qty]) => ({ model, qty })).sort((a, b) => b.qty - a.qty)
  }
  return out
}

/** ตัวเลขของวัน (เวลาไทย) บนผัง */
export interface MapActivity {
  /** เบิกเข้าไลน์: ใบเบิกย่อย + ส่วนต่างที่ FM-P-005 ตัดเพิ่ม/คืน */
  issuedToday: number
  /** ใบรับสินค้า (GRN) ที่ใช้งานอยู่ ไม่นับใบที่ยกเลิกและเอกสารกล่องจากการตรวจนับ (เหมือนหน้าภาพรวม) */
  receiptsToday: number
  /** NG ที่พบ: MI3 ตรวจเจอ + เสียหายตอนตรวจรับ (แยกเข้ากล่อง NG) */
  ngFoundToday: number
}

export const NO_ACTIVITY: MapActivity = { issuedToday: 0, receiptsToday: 0, ngFoundToday: 0 }

export function todayActivity(reqs: Requisition[], grns: Grn[], tx: Tx[], day: string, isNgLoc: (code: string) => boolean = () => false): MapActivity {
  const posted = reqs.filter((r) => r.status === 'posted' && r.docDate === day)
  const sub = posted.filter((r) => r.kind === 'line').reduce((s, r) => s + r.lines.reduce((t, l) => t + l.qty, 0), 0)
  const fm = posted.filter((r) => r.kind === 'fm005').reduce((s, r) => s + r.lines.reduce((t, l) => t + l.qty - (l.reqQty ?? 0), 0), 0)
  const today = tx.filter((t) => bangkokDay(t.createdAt) === day)
  return {
    issuedToday: sub + fm,
    receiptsToday: grns.filter((g) => bangkokDay(g.receivedAt) === day && g.status !== 'void' && !g.grnNo.startsWith('CNT-')).length,
    ngFoundToday: today.reduce((s, t) => s + (t.kind === 'QI' ? (t.ngQty ?? 0) : t.kind === 'RECEIVE' && !!t.toLoc && isNgLoc(t.toLoc) ? (t.qty ?? 0) : 0), 0),
  }
}
