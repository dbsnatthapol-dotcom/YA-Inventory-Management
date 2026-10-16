import type { FlowSpec } from '../components/FactoryScene'
import type { TourStep } from '../components/map/ExecTour'
import type { GuideInfo } from '../components/models/Guide'
import { palletsFor } from '../data/warehouse'
import type { ZoneContents } from '../inventory/reports'
import type { FactoryLayout, Zone } from '../types/layout'
import { zonePlan } from '../wms/locations'
import type { StorageLoc, Tx, ZoneHead } from '../wms/types'
import type { MapStats } from './mapStats'

const n = (v: number) => v.toLocaleString('th-TH')

/** บทบาทของไกด์ตามประเภทจุด (ใช้เมื่อยังไม่ได้ตั้งหัวหน้าโซนในระบบ) */
const ROLE: Partial<Record<Zone['kind'], string>> = {
  receiving: 'ผู้ดูแลจุดรับสินค้า',
  inspection: 'ผู้ตรวจคุณภาพ MI3',
  ng: 'ผู้ดูแลพื้นที่กัก NG',
  assembly: 'ผู้ประสานงานไลน์ประกอบ',
  storage: 'ผู้ดูแลโซนจัดเก็บ',
  tent: 'ผู้ดูแลเต็นท์ลานนอก',
}

/** % ช่องพาเลทที่ใช้ของโซนเก็บ */
export function zoneUsage(layout: Pick<FactoryLayout, 'floors'>, zone: Zone, stock: ZoneContents | undefined) {
  const slots = zonePlan(layout, zone).slots.length
  return slots ? Math.round((Math.min(palletsFor(stock).length, slots) / slots) * 100) : 0
}

/** ข้อมูลสรุปของไกด์ประจำแต่ละจุด (ยอดจริงในโซน + หัวหน้าโซนจากระบบ) */
export function buildGuides(layout: FactoryLayout, stock: Map<string, ZoneContents>, heads: ZoneHead[], stats: MapStats): Map<string, GuideInfo> {
  const map = new Map<string, GuideInfo>()
  for (const zone of layout.zones) {
    const role = ROLE[zone.kind]
    if (!role) continue
    const s = stock.get(zone.id)
    const head = heads.find((h) => h.zoneId === zone.id)
    const lines: string[] = []
    let tone: GuideInfo['tone'] = 'ok'
    if (s?.totalQty) {
      lines.push(`มีของ ${n(s.totalQty)} ชิ้น · ${palletsFor(s).length} พาเลท · ${s.items.length} lot`)
      if (s.models.length) lines.push(`Model: ${s.models.map((m) => `${m.model} ${n(m.qty)}`).join(', ')}`)
    } else if (zone.kind !== 'assembly') lines.push('ตอนนี้ว่าง พร้อมรับของ')
    if (zone.kind === 'storage') {
      const pct = zoneUsage(layout, zone, s)
      lines.push(`ใช้พื้นที่ ${pct}% ของ ${n(zonePlan(layout, zone).slots.length)} ช่องพาเลท`)
      if (pct > 85) tone = 'warn'
    }
    if (s?.pendingQcQty) {
      lines.push(`รอคัด MI3 ${n(s.pendingQcQty)} ชิ้น — ยังเบิกไม่ได้`)
      tone = 'warn'
    }
    if (zone.kind === 'receiving') lines.push(`วันนี้รับเข้า ${n(stats.receiptsToday)} invoice`)
    if (zone.kind === 'assembly') lines.push(`เบิกเข้าไลน์วันนี้ ${n(stats.issuedToday)} ชิ้น (ทั้งโรงงาน)`)
    if (zone.kind === 'ng' && stats.ngWaitingQty) {
      lines.push(`NG รอส่งคืน ${n(stats.ngWaitingQty)} ชิ้น`)
      tone = 'bad'
    }
    map.set(zone.id, {
      title: `${zone.code} · ${zone.name}`,
      who: head ? `หัวหน้าโซน: ${head.fullName}` : `${role} (ยังไม่กำหนดหัวหน้าโซน)`,
      lines,
      tone,
    })
  }
  return map
}

/** สีและชื่อการเคลื่อนไหวบนผัง */
const FLOW_STYLE: Partial<Record<Tx['kind'], { color: string; label: string }>> = {
  RECEIVE: { color: '#16a34a', label: 'รับเข้า' },
  PUT: { color: '#2563eb', label: 'จัดเก็บ' },
  MOVE: { color: '#7c3aed', label: 'ย้าย' },
  ISSUE: { color: '#f97316', label: 'เบิกเข้าไลน์' },
  RETURN: { color: '#0d9488', label: 'คืน' },
}

/**
 * แปลงรายการเคลื่อนไหวล่าสุดในระบบเป็นเส้นวิ่งบนผัง: ช่องเก็บ → โซน (จากข้อมูลช่องเก็บ)
 * เบิก = จากช่องเก็บ → ไลน์ประกอบ, คืน = ไลน์ → ช่องเก็บ, รับเข้า = จุดรับ → จุดที่วาง (เช่น MI3)
 */
export function flowsFromTx(tx: Tx[], locations: StorageLoc[], layout: Pick<FactoryLayout, 'zones'>, max = 8): FlowSpec[] {
  const byLoc = new Map(locations.map((l) => [l.code, l.zoneId]))
  const zoneOf = (code: string | null) => (code ? (byLoc.get(code) ?? layout.zones.find((z) => z.code === code)?.id ?? null) : null)
  const line = layout.zones.find((z) => z.id === 'F2-ASM') ?? layout.zones.find((z) => z.kind === 'assembly')
  const receiving = layout.zones.find((z) => z.kind === 'receiving')
  const out: FlowSpec[] = []
  for (const t of tx) {
    const style = FLOW_STYLE[t.kind]
    if (!style) continue
    let from: string | null = null
    let to: string | null = null
    if (t.kind === 'PUT' || t.kind === 'MOVE') [from, to] = [zoneOf(t.fromLoc), zoneOf(t.toLoc)]
    else if (t.kind === 'ISSUE') [from, to] = [zoneOf(t.fromLoc), line?.id ?? null]
    else if (t.kind === 'RETURN') [from, to] = [line?.id ?? null, zoneOf(t.toLoc)]
    else if (t.kind === 'RECEIVE') [from, to] = [receiving?.id ?? null, zoneOf(t.toLoc)]
    if (!from || !to || from === to) continue
    out.push({ id: t.id, from, to, color: style.color, label: `${style.label} ${t.partNo ?? t.lpnNo ?? ''}`.trim() })
    if (out.length >= max) break
  }
  return out
}

/** ตัวอย่างการเคลื่อนไหว (เฉพาะโหมดสาธิตที่ยังไม่มีรายการจริง) */
export function sampleFlows(layout: Pick<FactoryLayout, 'zones'>): FlowSpec[] {
  const has = (id: string) => layout.zones.some((z) => z.id === id)
  const list: [string, string, keyof typeof FLOW_STYLE][] = [
    ['RCV-01', 'F1-RK-A', 'PUT'],
    ['RCV-01', 'F1-MI3', 'RECEIVE'],
    ['F1-RK-B', 'F2-ASM', 'ISSUE'],
    ['TENT-C', 'F2-ASM', 'ISSUE'],
    ['F2-RK-D', 'F2-ASM', 'ISSUE'],
  ]
  return list
    .filter(([a, b]) => has(a) && has(b))
    .map(([from, to, kind], i) => ({ id: `sample-${i}`, from, to, color: FLOW_STYLE[kind]!.color, label: `${FLOW_STYLE[kind]!.label} (ตัวอย่าง)` }))
}

/** ทัวร์นำเสนอผู้บริหาร: ภาพรวม → รับของ → MI3 → พื้นที่เก็บ → ไลน์ประกอบ → อาคาร F → ลานเต็นท์ → สรุป */
export function buildTourSteps(layout: FactoryLayout, stats: MapStats, stock: Map<string, ZoneContents>): TourStep[] {
  const zone = (id: string) => layout.zones.find((z) => z.id === id)
  const rcv = layout.zones.find((z) => z.kind === 'receiving')
  const mi3 = layout.zones.find((z) => z.kind === 'inspection')
  const line = zone('F2-ASM') ?? layout.zones.find((z) => z.kind === 'assembly')
  const storage = layout.zones.filter((z) => z.kind === 'storage')
  const fullest = [...storage].sort((a, b) => zoneUsage(layout, b, stock.get(b.id)) - zoneUsage(layout, a, stock.get(a.id)))[0]
  const mezz = layout.zones.find((z) => layout.floors.find((f) => f.id === z.floorId)?.mezzanine && z.kind === 'storage')
  const tent = zone('TENT-T') ?? layout.zones.find((z) => z.kind === 'tent')
  const pct = stats.slots ? Math.round((stats.usedSlots / stats.slots) * 100) : 0

  const steps: (TourStep | null | undefined)[] = [
    {
      title: `ยินดีต้อนรับสู่ ${layout.siteName}`,
      body: 'ผังโรงงาน 3 มิติที่เชื่อมกับข้อมูลคลังจริง ทุกตัวเลขบนจอมาจากการสแกนหน้างาน',
      stat: { value: n(stats.boiQty), label: 'ชิ้นในคลัง (BOI)' },
      zoneId: null,
      mode: 'exterior',
    },
    rcv && {
      title: 'จุดรับสินค้า',
      body: 'ถ่าย Packing List + Invoice ให้ AI อ่าน นับจริงเทียบเอกสาร แล้วออกป้าย QR ทุกกล่อง — ตามรอยได้ถึงระดับกล่อง',
      stat: { value: n(stats.receiptsToday), label: 'invoice รับวันนี้' },
      zoneId: rcv.id,
      mode: 'interior',
      guide: true,
    },
    mi3 && {
      title: 'ตรวจคุณภาพ MI3',
      body: 'ของที่ต้องตรวจถูกล็อกห้ามเบิกอัตโนมัติจนกว่าจะบันทึกผล ดี / NG ป้องกันของเสียหลุดเข้าไลน์',
      stat: { value: n(stats.pendingQcQty), label: `ชิ้นรอคัด (${stats.pendingQcLots} lot)` },
      zoneId: mi3.id,
      mode: 'interior',
      guide: true,
    },
    fullest && {
      title: 'พื้นที่จัดเก็บ · Heatmap',
      body: 'สีบอกความเต็มของแต่ละโซน: เขียว = ว่าง, เหลือง = ใกล้เต็ม, แดง = เต็ม — วางแผนพื้นที่ได้ก่อนของจะล้น',
      stat: { value: `${pct}%`, label: `ใช้ ${n(stats.usedSlots)} / ${n(stats.slots)} ช่อง` },
      zoneId: fullest.id,
      mode: 'interior',
      heatmap: true,
    },
    line && {
      title: 'ส่ง part เข้าไลน์ประกอบ',
      body: 'ใบเบิกย่อยตัดสต็อกทันที (เข้าก่อนออกก่อน) จบวันกระทบกับ FM-P-005 อัตโนมัติ แล้วส่งยอดให้ Planning',
      stat: { value: n(stats.issuedToday), label: 'ชิ้นเบิกเข้าไลน์วันนี้' },
      zoneId: line.id,
      mode: 'interior',
      flow: true,
      guide: true,
    },
    mezz && {
      title: 'อาคาร F + ชั้นลอย',
      body: 'พื้นที่เก็บ part เพิ่ม 2 ชั้นและชั้นลอย พนักงานเปิดนำทางจากมือถือได้ว่าต้องขึ้นบันไดหรือลิฟต์ตัวไหน',
      zoneId: mezz.id,
      mode: 'interior',
    },
    tent && {
      title: 'ลานเต็นท์',
      body: 'ยางและ FG ในเต็นท์ลานนอกอยู่ในระบบเดียวกัน ค้นหาเจอทุกกล่องพร้อมตำแหน่ง',
      stat: stock.get(tent.id)?.totalQty ? { value: n(stock.get(tent.id)!.totalQty), label: 'ชิ้นในเต็นท์' } : undefined,
      zoneId: tent.id,
      mode: 'exterior',
      guide: true,
    },
    {
      title: 'ตัวเลขเดียวกันทั้งโรงงาน',
      body: 'คลัง · MI3 · ไลน์ประกอบ · บัญชี (FM-P-537) · Planning (FM-P-005) ใช้ข้อมูลชุดเดียวกัน ไม่ต้องคีย์ซ้ำ',
      stat: { value: n(stats.ngWaitingQty), label: 'NG รอส่งคืน' },
      zoneId: null,
      mode: 'exterior',
      flow: true,
    },
  ]
  return steps.filter((s): s is TourStep => !!s)
}
