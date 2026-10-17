import type { FactoryLayout, Zone } from '../types/layout'
import { buildingOf } from '../lib/geometry'
import { bangkokDay } from './ledger'
import { zoneLocator } from './mapStock'
import { buildSlotMap, SLOT_STATUS } from './slotMap'
import type { DashActivity, Lpn, MasterData, Requisition, StockClosing } from './types'

/** ช่วงเวลาบนหน้าภาพรวม */
export type DashPeriod = 'today' | '7d' | 'month'

export const PERIOD_LABEL: Record<DashPeriod, string> = { today: 'วันนี้', '7d': '7 วัน', month: 'เดือนนี้' }

/** พอใช้น้อยกว่านี้ (วันทำงาน) = ใกล้หมด / ควรเฝ้าดู */
export const LOW_DAYS = 3
export const WATCH_DAYS = 7
/** ใช้ยอดเบิกย้อนหลังกี่วันคิดค่าเฉลี่ยต่อวัน */
export const AVG_WINDOW = 14
/** รอตรวจ MI3 นานเกิน (วัน) */
export const MI3_WAIT_DAYS = 2
/** กล่องค้างนานเกิน (วัน) ⇒ ควรเบิกก่อนตาม FIFO */
export const AGING_DAYS = 30

export const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)

/** ช่วงที่นับยอด (from–to) และวันที่แสดงบนกราฟ (อย่างน้อย 7 วัน) */
export function periodRange(period: DashPeriod, today: string) {
  const monthStart = `${today.slice(0, 8)}01`
  const from = period === 'today' ? today : period === '7d' ? addDays(today, -6) : monthStart
  const chartFrom = period === 'month' && daysBetween(monthStart, today) >= 6 ? monthStart : addDays(today, -6)
  const chart: string[] = []
  for (let d = chartFrom; d <= today; d = addDays(d, 1)) chart.push(d)
  return { from, to: today, chart }
}

/** วันแรกที่ต้องดึงข้อมูล: ต้นเดือน หรือย้อนหลัง 14 วัน (ค่าเฉลี่ยการใช้) แล้วแต่อันไหนเก่ากว่า */
export const fetchFrom = (today: string) => {
  const a = `${today.slice(0, 8)}01`
  const b = addDays(today, -(AVG_WINDOW - 1))
  return a < b ? a : b
}

/** คลิกแล้วไปไหน: ผังคลัง 2D (โซน/ชั้น + ไฮไลต์กล่อง) หรือแท็บในงานคลัง */
export type DashAction =
  | { kind: 'plan'; zoneId: string | null; floorId?: string | null; lpnNos: string[] }
  | { kind: 'wms'; tab: 'count' | 'ledger' }

export interface DashAlert {
  id: string
  level: 'critical' | 'warning' | 'info'
  model: string | null
  title: string
  detail: string
  action: DashAction | null
}

export interface LowPart {
  partNo: string
  name: string
  onHand: number
  avgDaily: number
  /** พอใช้กี่วันทำงาน (0 = หมดแล้ว) */
  cover: number
}

export interface ModelRow {
  model: string
  /** ของดีพร้อมเบิก (ไม่รวมรอ MI3 และของในพื้นที่ NG) */
  onHand: number
  boxes: number
  holdQty: number
  holdBoxes: number
  holdOldestDays: number | null
  ngWaitQty: number
  received: number
  issued: number
  qcIssued: number
  ngReturned: number
  ngFound: number
  qiChecked: number
  avgDaily: number
  /** part ที่จะหมดก่อน (คิดจากยอดเบิกเฉลี่ยของแต่ละ part) */
  cover: number | null
  coverPart: string | null
  lowParts: LowPart[]
  /** กล่องของดีของ Model นี้ (ไว้ไฮไลต์บนผัง) และโซนที่มีมากสุด */
  lpnNos: string[]
  topZone: string | null
}

export interface AreaZone {
  zoneId: string
  code: string
  name: string
  kind: Zone['kind']
  slots: number
  used: number
  blocked: number
  boxes: number
  qty: number
  holdBoxes: number
  oldestDays: number | null
  /** ชิ้นของ Model ที่กรองอยู่ (ไม่กรอง = เท่ากับ qty) */
  modelQty: number
}

export interface AreaFloor {
  floorId: string
  name: string
  zones: AreaZone[]
  slots: number
  used: number
  boxes: number
  qty: number
  modelQty: number
}

export interface DashKpi {
  onHand: number
  boxes: number
  slots: number
  slotsUsed: number
  holdBoxes: number
  holdQty: number
  holdOldestDays: number | null
  ngWaitQty: number
  received: number
  receiptDocs: number
  issued: number
  ngFound: number
  qiChecked: number
  pendingApprovals: number
}

export interface DashData {
  range: ReturnType<typeof periodRange>
  /** วันที่มีการเบิกเข้าไลน์ใน 14 วันล่าสุด (ฐานของค่าเฉลี่ยต่อวัน) */
  workingDays: number
  kpi: DashKpi
  models: ModelRow[]
  trend: { day: string; received: number; issued: number }[]
  floors: AreaFloor[]
  alerts: DashAlert[]
  /** กดตัวเลขหลักแล้วไปผัง: กล่องรอ MI3 / NG รอส่งคืน */
  actions: { hold: DashAction | null; ng: DashAction | null }
}

export interface DashInput {
  /** วันนี้ (เวลาไทย) YYYY-MM-DD */
  today: string
  period: DashPeriod
  /** กรอง Model (null = ทุก Model) */
  model: string | null
  layout: Pick<FactoryLayout, 'zones' | 'floors'>
  master: Pick<MasterData, 'locations' | 'parts' | 'models'>
  lpns: Lpn[]
  reqs: Requisition[]
  activity: DashActivity
  pending: { adjustments: number; countSheets: number }
  closings: StockClosing[]
}

interface Box {
  lpnNo: string
  model: string
  zoneId: string | null
  qty: number
  hold: boolean
  ng: boolean
  age: number
  items: { partNo: string; qty: number }[]
}

const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v)
const LEVEL_ORDER: Record<DashAlert['level'], number> = { critical: 0, warning: 1, info: 2 }
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
const days = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n).toString())

/** โซนที่มีของในกล่องชุดนี้มากสุด (weight = นับเฉพาะบาง part) */
function topZoneOf(boxes: Box[], weight: (b: Box) => number = (b) => b.qty): string | null {
  const q = new Map<string, number>()
  for (const b of boxes) if (b.zoneId) add(q, b.zoneId, weight(b))
  return [...q].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
const planAt = (boxes: Box[], weight?: (b: Box) => number): DashAction => ({ kind: 'plan', zoneId: topZoneOf(boxes, weight), lpnNos: boxes.map((b) => b.lpnNo) })
const partQty = (parts: string[]) => (b: Box) => b.items.filter((i) => parts.includes(i.partNo)).reduce((s, i) => s + i.qty, 0)

/**
 * ภาพรวมคลังสำหรับผู้บริหาร: ตาม Model (คงเหลือ รับ เบิก พอใช้กี่วัน MI3/NG), ตามพื้นที่ (ชั้น → โซน),
 * กราฟรับเข้า/เบิกออกรายวัน และรายการเตือนที่กดแล้วพาไปผังคลัง 2D หรือแท็บที่ต้องจัดการ
 */
export function buildDashboard(input: DashInput): DashData {
  const { today, period, model: only, layout, master, lpns, reqs, activity } = input
  const range = periodRange(period, today)
  const inRange = (d: string) => d >= range.from && d <= range.to
  const avgFrom = addDays(today, -(AVG_WINDOW - 1))
  const monthStart = `${today.slice(0, 8)}01`
  const parts = new Map(master.parts.map((p) => [p.partNo, p]))
  const modelOf = (code: string | null | undefined, partNo?: string) => code || (partNo ? parts.get(partNo)?.models[0] : undefined) || '–'
  const zoneOf = zoneLocator(master, layout)
  const zoneKind = new Map(layout.zones.map((z) => [z.id, z.kind]))
  const pick = (m: string) => !only || m === only

  // ---- กล่องในคลัง
  const boxes: Box[] = []
  for (const l of lpns) {
    if (l.status !== 'active') continue
    const items = l.items.filter((i) => i.qty > 0).map((i) => ({ partNo: i.partNo, qty: i.qty }))
    if (!items.length) continue
    const zoneId = zoneOf(l.locationCode)
    boxes.push({
      lpnNo: l.lpnNo,
      model: modelOf(l.modelCode, items[0].partNo),
      zoneId,
      qty: items.reduce((s, i) => s + i.qty, 0),
      hold: l.hold,
      ng: !!zoneId && zoneKind.get(zoneId) === 'ng',
      age: Math.max(0, daysBetween(bangkokDay(l.createdAt), today)),
      items,
    })
  }
  const good = boxes.filter((b) => !b.hold && !b.ng)
  const partOnHand = new Map<string, number>()
  for (const b of good) for (const i of b.items) add(partOnHand, i.partNo, i.qty)

  // ---- ใบเบิก: เข้าไลน์ = ใบย่อย + ส่วนต่าง FM-P-005 · QC / NG แยกช่อง
  const use = new Map<string, number>() // model|day
  const partUse = new Map<string, number>() // part (14 วัน)
  const modelParts = new Map<string, Set<string>>()
  const qc = new Map<string, number>()
  const ngRet = new Map<string, number>()
  const workDays = new Set<string>()
  for (const r of reqs) {
    if (r.status !== 'posted') continue
    for (const l of r.lines) {
      const m = modelOf(r.modelCode, l.partNo)
      const q = r.kind === 'fm005' ? l.qty - (l.reqQty ?? 0) : l.qty
      if (r.kind === 'line' || r.kind === 'fm005') {
        if (!q) continue
        add(use, `${m}|${r.docDate}`, q)
        if (r.docDate >= avgFrom && r.docDate <= today) {
          add(partUse, l.partNo, q)
          workDays.add(r.docDate)
          if (!modelParts.has(m)) modelParts.set(m, new Set())
          modelParts.get(m)!.add(l.partNo)
        }
      } else if (inRange(r.docDate)) add(r.kind === 'qc' ? qc : ngRet, m, l.qty)
    }
  }
  const workingDays = workDays.size
  const partAvg = (p: string) => (workingDays ? (partUse.get(p) ?? 0) / workingDays : 0)

  // ---- รับเข้า / ผลตรวจ MI3
  const recv = new Map<string, number>() // model|day
  const docs = new Map<string, Set<string>>() // model → GRN
  for (const r of activity.receipts) {
    const m = modelOf(r.model, r.partNo)
    add(recv, `${m}|${r.day}`, r.qty)
    if (inRange(r.day)) {
      if (!docs.has(m)) docs.set(m, new Set())
      docs.get(m)!.add(r.grnNo)
    }
  }
  const ngFound = new Map<string, number>()
  const qiChecked = new Map<string, number>()
  for (const q of activity.qi) {
    if (!inRange(q.day)) continue
    const m = modelOf(q.model, q.partNo)
    add(ngFound, m, q.ng)
    add(qiChecked, m, q.pass + q.ng)
  }
  const sumModelDays = (map: Map<string, number>, m: string, from: string, to: string) => {
    let s = 0
    for (const [k, v] of map) {
      const [km, d] = k.split('|')
      if (km === m && d >= from && d <= to) s += v
    }
    return s
  }

  // ---- ตาม Model (เรียงตาม Master แล้วตามด้วยที่ไม่อยู่ใน Master)
  const seen = new Set<string>([...boxes.map((b) => b.model), ...[...use.keys(), ...recv.keys()].map((k) => k.split('|')[0]), ...qc.keys(), ...ngRet.keys(), ...ngFound.keys()])
  const order = [...master.models.map((m) => m.code), ...[...seen].filter((m) => !master.models.some((x) => x.code === m)).sort((a, b) => (a === '–' ? 1 : b === '–' ? -1 : a.localeCompare(b)))]
  const models: ModelRow[] = []
  for (const m of order) {
    if (!seen.has(m)) continue
    const own = boxes.filter((b) => b.model === m)
    const ownGood = own.filter((b) => !b.hold && !b.ng)
    const held = own.filter((b) => b.hold)
    const low = [...(modelParts.get(m) ?? [])]
      .map((p): LowPart => {
        const avg = partAvg(p)
        const onHand = partOnHand.get(p) ?? 0
        return { partNo: p, name: parts.get(p)?.name ?? '', onHand, avgDaily: avg, cover: avg > 0 ? onHand / avg : Infinity }
      })
      .filter((p) => Number.isFinite(p.cover))
      .sort((a, b) => a.cover - b.cover)
    const issuedAvg = workingDays ? sumModelDays(use, m, avgFrom, today) / workingDays : 0
    models.push({
      model: m,
      onHand: ownGood.reduce((s, b) => s + b.qty, 0),
      boxes: ownGood.length,
      holdQty: held.reduce((s, b) => s + b.qty, 0),
      holdBoxes: held.length,
      holdOldestDays: held.length ? Math.max(...held.map((b) => b.age)) : null,
      ngWaitQty: own.filter((b) => b.ng).reduce((s, b) => s + b.qty, 0),
      received: sumModelDays(recv, m, range.from, range.to),
      issued: sumModelDays(use, m, range.from, range.to),
      qcIssued: qc.get(m) ?? 0,
      ngReturned: ngRet.get(m) ?? 0,
      ngFound: ngFound.get(m) ?? 0,
      qiChecked: qiChecked.get(m) ?? 0,
      avgDaily: issuedAvg,
      cover: low[0]?.cover ?? null,
      coverPart: low[0]?.partNo ?? null,
      lowParts: low.filter((p) => p.cover < WATCH_DAYS),
      lpnNos: ownGood.map((b) => b.lpnNo),
      topZone: topZoneOf(ownGood),
    })
  }
  const shown = models.filter((r) => pick(r.model))

  // ---- พื้นที่: ชั้น → โซน (ความจุจากผัง)
  const slotMap = buildSlotMap(layout, lpns, master)
  const floors: AreaFloor[] = []
  const floorOrder = [...layout.floors].sort(
    (a, b) => (a.area === 'yard' ? 1 : 0) - (b.area === 'yard' ? 1 : 0) || buildingOf(a).localeCompare(buildingOf(b)) || a.elevation - b.elevation,
  )
  const boxByLpn = new Map(boxes.map((b) => [b.lpnNo, b]))
  for (const f of floorOrder) {
    const zones: AreaZone[] = []
    for (const z of layout.zones.filter((zz) => zz.floorId === f.id && ['storage', 'tent', 'receiving', 'inspection', 'ng'].includes(zz.kind))) {
      const zs = slotMap.zones.get(z.id)
      if (!zs) continue
      const all = [...zs.spots.flatMap((s) => s.levels.flatMap((l) => l.boxes)), ...zs.extra.flatMap((s) => s.boxes), ...zs.loose]
      const slots = SLOT_STATUS.reduce((s, k) => s + zs.counts[k], 0)
      zones.push({
        zoneId: z.id,
        code: z.code,
        name: z.name,
        kind: z.kind,
        slots,
        used: zs.counts.stock + zs.counts.hold,
        blocked: zs.counts.blocked,
        boxes: zs.boxes,
        qty: zs.qty,
        holdBoxes: zs.holdBoxes,
        oldestDays: all.length ? Math.max(...all.map((b) => boxByLpn.get(b.lpnNo)?.age ?? 0)) : null,
        modelQty: only ? all.filter((b) => b.model === only || boxByLpn.get(b.lpnNo)?.model === only).reduce((s, b) => s + b.qty, 0) : zs.qty,
      })
    }
    if (!zones.length) continue
    floors.push({
      floorId: f.id,
      name: f.name,
      zones,
      slots: zones.reduce((s, z) => s + z.slots, 0),
      used: zones.reduce((s, z) => s + z.used, 0),
      boxes: zones.reduce((s, z) => s + z.boxes, 0),
      qty: zones.reduce((s, z) => s + z.qty, 0),
      modelQty: zones.reduce((s, z) => s + z.modelQty, 0),
    })
  }

  // ---- ตัวเลขหลัก
  const kBoxes = boxes.filter((b) => pick(b.model))
  const kHeld = kBoxes.filter((b) => b.hold)
  let slots = 0
  let slotsUsed = 0
  for (const zs of slotMap.zones.values())
    for (const s of zs.spots)
      for (const l of s.levels) {
        slots++
        if (l.boxes.length && (!only || l.boxes.some((b) => (boxByLpn.get(b.lpnNo)?.model ?? b.model) === only))) slotsUsed++
      }
  const kpi: DashKpi = {
    onHand: shown.reduce((s, r) => s + r.onHand, 0),
    boxes: shown.reduce((s, r) => s + r.boxes, 0),
    slots,
    slotsUsed,
    holdBoxes: kHeld.length,
    holdQty: kHeld.reduce((s, b) => s + b.qty, 0),
    holdOldestDays: kHeld.length ? Math.max(...kHeld.map((b) => b.age)) : null,
    ngWaitQty: shown.reduce((s, r) => s + r.ngWaitQty, 0),
    received: shown.reduce((s, r) => s + r.received, 0),
    receiptDocs: new Set([...docs].filter(([m]) => pick(m)).flatMap(([, g]) => [...g])).size,
    issued: shown.reduce((s, r) => s + r.issued, 0),
    ngFound: shown.reduce((s, r) => s + r.ngFound, 0),
    qiChecked: shown.reduce((s, r) => s + r.qiChecked, 0),
    pendingApprovals: input.pending.adjustments + input.pending.countSheets,
  }

  // ---- กราฟรายวัน
  const trend = range.chart.map((day) => {
    let received = 0
    let issued = 0
    for (const r of models) {
      if (!pick(r.model)) continue
      received += recv.get(`${r.model}|${day}`) ?? 0
      issued += use.get(`${r.model}|${day}`) ?? 0
    }
    return { day, received, issued }
  })

  // ---- รายการเตือน
  const alerts: DashAlert[] = []
  for (const r of shown) {
    for (const p of r.lowParts) {
      const holding = good.filter((b) => b.items.some((i) => i.partNo === p.partNo))
      const critical = p.cover < LOW_DAYS
      if (!critical) continue
      alerts.push({
        id: `low-${r.model}-${p.partNo}`,
        level: 'critical',
        model: r.model,
        title: p.onHand <= 0 ? `${p.partNo} หมดคลังแล้ว` : `${p.partNo} พอใช้อีก ~${days(p.cover)} วัน`,
        detail: `${r.model}${p.name ? ` · ${p.name}` : ''} · คงเหลือ ${fmt(p.onHand)} · ใช้เฉลี่ย ${fmt(p.avgDaily)}/วัน`,
        action: holding.length ? planAt(holding, partQty([p.partNo])) : null,
      })
    }
    const watch = r.lowParts.filter((p) => p.cover >= LOW_DAYS)
    if (watch.length) {
      const holding = good.filter((b) => b.items.some((i) => watch.some((p) => p.partNo === i.partNo)))
      alerts.push({
        id: `watch-${r.model}`,
        level: 'warning',
        model: r.model,
        title: `${r.model}: ${watch.length} part พอใช้ไม่ถึง ${WATCH_DAYS} วัน`,
        detail: watch
          .slice(0, 4)
          .map((p) => `${p.partNo} ~${days(p.cover)} วัน`)
          .join(' · '),
        action: holding.length ? planAt(holding, partQty(watch.map((p) => p.partNo))) : null,
      })
    }
  }
  const waiting = kHeld.filter((b) => b.age > MI3_WAIT_DAYS)
  if (waiting.length)
    alerts.push({
      id: 'mi3-wait',
      level: 'warning',
      model: only,
      title: `รอตรวจ MI3 เกิน ${MI3_WAIT_DAYS} วัน ${waiting.length} กล่อง`,
      detail: `นานสุด ${Math.max(...waiting.map((b) => b.age))} วัน · ${fmt(waiting.reduce((s, b) => s + b.qty, 0))} ชิ้นยังเบิกไม่ได้`,
      action: planAt(waiting),
    })
  const aged = good.filter((b) => pick(b.model) && b.age > AGING_DAYS)
  if (aged.length)
    alerts.push({
      id: 'aging',
      level: 'warning',
      model: only,
      title: `กล่องค้างเกิน ${AGING_DAYS} วัน ${aged.length} กล่อง`,
      detail: `เก่าสุด ${Math.max(...aged.map((b) => b.age))} วัน · ควรเบิกก่อนตามหลัก FIFO`,
      action: planAt(aged),
    })
  const loose = [...slotMap.zones.values()]
    .filter((zs) => zs.kind !== 'area')
    .flatMap((zs) => zs.loose)
    .concat(slotMap.unknown)
    .map((b) => boxByLpn.get(b.lpnNo))
    .filter((b): b is Box => !!b && pick(b.model))
  if (loose.length)
    alerts.push({
      id: 'loose',
      level: 'warning',
      model: only,
      title: `กล่องไม่อยู่ในช่องของผัง ${loose.length} กล่อง`,
      detail: 'รหัสช่องไม่มีในผัง หรือระบุแค่โซน · สแกน MOVE ย้ายเข้าช่องให้ถูกต้อง',
      action: planAt(loose),
    })
  const blockedBusy = [...slotMap.zones.values()]
    .flatMap((zs) => [...zs.spots.flatMap((s) => s.levels), ...zs.extra])
    .filter((s) => s.blocked && s.boxes.length)
  if (blockedBusy.length) {
    const inBlocked = blockedBusy.flatMap((s) => s.boxes.map((b) => boxByLpn.get(b.lpnNo))).filter((b): b is Box => !!b)
    alerts.push({
      id: 'blocked',
      level: 'warning',
      model: null,
      title: `ช่องที่ปิดใช้ยังมีของ ${blockedBusy.length} ช่อง`,
      detail: blockedBusy
        .slice(0, 4)
        .map((s) => s.code)
        .join(', '),
      action: planAt(inBlocked),
    })
  }
  const ngBoxes = boxes.filter((b) => b.ng && pick(b.model))
  if (ngBoxes.length)
    alerts.push({
      id: 'ng-wait',
      level: 'info',
      model: only,
      title: `NG รอส่งคืน ${fmt(ngBoxes.reduce((s, b) => s + b.qty, 0))} ชิ้น (${ngBoxes.length} กล่อง)`,
      detail: 'ตัดยอดด้วยการสแกนเบิก → NG / ส่งคืน',
      action: planAt(ngBoxes),
    })
  if (kpi.pendingApprovals)
    alerts.push({
      id: 'approvals',
      level: 'info',
      model: null,
      title: `รออนุมัติปรับยอด ${kpi.pendingApprovals} รายการ`,
      detail: [input.pending.adjustments && `จากหน้าสแกน ${input.pending.adjustments}`, input.pending.countSheets && `ใบตรวจนับ ${input.pending.countSheets}`].filter(Boolean).join(' · '),
      action: { kind: 'wms', tab: 'count' },
    })
  // ปิดยอดเดือนก่อน: Model ที่มีของรับเข้าก่อนต้นเดือนนี้ ต้องปิดยอด FM-P-537 ของเดือนก่อน
  const prev = addDays(monthStart, -1).slice(0, 7)
  const needClose = [...new Set(boxes.filter((b) => b.model !== '–' && pick(b.model) && addDays(today, -b.age) < monthStart).map((b) => b.model))]
  const notClosed = needClose.filter((m) => !input.closings.some((c) => c.modelCode === m && c.month === prev && c.status === 'closed'))
  if (notClosed.length)
    alerts.push({
      id: 'close',
      level: Number(today.slice(8)) > 3 ? 'warning' : 'info',
      model: only,
      title: `ยังไม่ปิดยอด FM-P-537 เดือน ${prev}`,
      detail: notClosed.join(', '),
      action: { kind: 'wms', tab: 'ledger' },
    })
  const unacked = input.closings.filter((c) => c.status === 'closed' && pick(c.modelCode) && (!c.planningAt || !c.accountAt))
  if (unacked.length)
    alerts.push({
      id: 'ack',
      level: 'info',
      model: only,
      title: `ปิดยอดแล้ว รอรับทราบ ${unacked.length} รายการ`,
      detail: unacked
        .slice(0, 4)
        .map((c) => `${c.modelCode} ${c.month}${c.planningAt ? '' : ' · Planning'}${c.accountAt ? '' : ' · บัญชี'}`)
        .join(' | '),
      action: { kind: 'wms', tab: 'ledger' },
    })
  alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])

  return { range, workingDays, kpi, models: shown, trend, floors, alerts, actions: { hold: kHeld.length ? planAt(kHeld) : null, ng: ngBoxes.length ? planAt(ngBoxes) : null } }
}
