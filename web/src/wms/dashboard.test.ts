import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import { addDays, buildDashboard, fetchFrom, periodRange, type DashInput } from './dashboard'
import { demoWms } from './demoApi'
import { bangkokDay } from './ledger'
import type { Requisition, StockClosing } from './types'

const TODAY = '2026-10-17'
const YESTERDAY = addDays(TODAY, -1)
const master = {
  ...fixtureMaster,
  models: [
    { code: 'K1G', customerId: 'RE', requiresInspection: false },
    { code: 'J1A', customerId: 'RE', requiresInspection: true },
  ],
}

const req = (kind: Requisition['kind'], day: string, model: string | null, lines: [string, number, number?][]): Requisition => ({
  id: `${kind}-${day}-${lines[0][0]}`,
  kind,
  reqNo: 'RQ',
  docNo: null,
  docDate: day,
  modelCode: model,
  fgCode: null,
  fgQty: null,
  fromDept: null,
  toDept: null,
  note: null,
  status: 'posted',
  reconciledBy: null,
  createdCode: null,
  createdAt: `${day}T03:00:00Z`,
  lines: lines.map(([partNo, qty, reqQty]) => ({ partNo, qty, reqQty: reqQty ?? null, balance: null })),
})

const reqs: Requisition[] = [
  req('line', TODAY, 'K1G', [
    ['RAT00586', 100],
    ['RAT00566', 900],
  ]),
  req('line', YESTERDAY, 'K1G', [['RAT00586', 100]]),
  // FM-P-005 จบวัน: เอกสาร 250 ใบย่อยรวม 200 ⇒ ตัดเพิ่ม 50
  req('fm005', TODAY, 'K1G', [['RAT00586', 250, 200]]),
  // QC เบิกไม่ระบุ Model ⇒ ใช้ Model ของ part
  req('qc', TODAY, null, [['RAT00566', 10]]),
  req('ng', TODAY, 'K1G', [['RAT00586', 20]]),
  { ...req('line', TODAY, 'K1G', [['RAT00586', 999]]), id: 'void', status: 'void' },
]

const input = (over: Partial<DashInput> = {}): DashInput => ({
  today: TODAY,
  period: 'today',
  model: null,
  layout: sampleLayout,
  master,
  lpns: fixtureLpns,
  reqs,
  activity: {
    receipts: [
      { day: TODAY, grnNo: 'GRN-1', model: 'K1G', partNo: 'RAT00586', qty: 200, replacement: false },
      { day: addDays(TODAY, -3), grnNo: 'GRN-2', model: 'J1A', partNo: '1100351', qty: 120, replacement: false },
    ],
    qi: [{ day: TODAY, model: 'J1A', partNo: '1100351', pass: 55, ng: 5 }],
  },
  pending: { adjustments: 1, countSheets: 2 },
  closings: [],
  ...over,
})

describe('dashboard periods', () => {
  it('counts today, the last 7 days or the month, and charts at least 7 days', () => {
    expect(periodRange('today', TODAY)).toMatchObject({ from: TODAY, to: TODAY })
    expect(periodRange('today', TODAY).chart).toHaveLength(7)
    const week = periodRange('7d', TODAY)
    expect([week.from, week.chart[0], week.chart.at(-1), week.chart.length]).toEqual(['2026-10-11', '2026-10-11', TODAY, 7])
    const month = periodRange('month', TODAY)
    expect([month.from, month.chart[0], month.chart.length]).toEqual(['2026-10-01', '2026-10-01', 17])
    // ต้นเดือนยังไม่ถึง 7 วัน: กราฟย้อนไปเดือนก่อนให้ครบ 7 วัน แต่นับยอดตั้งแต่วันที่ 1
    const early = periodRange('month', '2026-11-03')
    expect([early.from, early.chart[0], early.chart.length]).toEqual(['2026-11-01', '2026-10-28', 7])
    // ดึงข้อมูลตั้งแต่ต้นเดือนหรือย้อนหลัง 14 วัน (ที่เก่ากว่า)
    expect([fetchFrom(TODAY), fetchFrom('2026-11-03')]).toEqual(['2026-10-01', '2026-10-21'])
  })
})

describe('dashboard by model', () => {
  it('splits good stock, MI3 hold and NG waiting per model, with receipts, issues, QC and NG for the period', () => {
    const d = buildDashboard(input())
    const k1g = d.models.find((m) => m.model === 'K1G')!
    // ของดี: LPN-1 6000 + LPN-2 3050 + LPN-3 200 + LPN-8 5 (ช่องไม่รู้จักแต่ยังเป็นของในคลัง) · LPN-5 อยู่ที่ NG
    expect([k1g.onHand, k1g.boxes, k1g.ngWaitQty]).toEqual([9255, 4, 20])
    // วันนี้: ใบย่อย 1000 + FM-P-005 ตัดเพิ่ม 50 · ใบ void ไม่นับ
    expect([k1g.issued, k1g.received, k1g.qcIssued, k1g.ngReturned]).toEqual([1050, 200, 10, 20])
    const j1a = d.models.find((m) => m.model === 'J1A')!
    expect([j1a.onHand, j1a.holdBoxes, j1a.holdQty, j1a.holdOldestDays, j1a.ngFound, j1a.qiChecked, j1a.received]).toEqual([0, 1, 60, 3, 5, 60, 0])
    expect(d.models.map((m) => m.model)).toEqual(['K1G', 'J1A'])
    expect(buildDashboard(input({ period: '7d' })).models.find((m) => m.model === 'J1A')!.received).toBe(120)
  })

  it('finds the part that runs out first from the average daily use on working days', () => {
    const k1g = buildDashboard(input()).models.find((m) => m.model === 'K1G')!
    // 2 วันทำงาน: RAT00586 ใช้ 100 + 100 + 50 = 250 ⇒ 125/วัน · คงเหลือ 50 + 200 = 250 ⇒ 2 วัน
    expect([k1g.coverPart, k1g.cover]).toEqual(['RAT00586', 2])
    expect(k1g.avgDaily).toBe(575)
    expect(k1g.lowParts.map((p) => p.partNo)).toEqual(['RAT00586'])
  })
})

describe('dashboard by area, trend and alerts', () => {
  it('rolls slots, boxes and qty up from zones to floors', () => {
    const d = buildDashboard(input())
    const f1 = d.floors.find((f) => f.floorId === 'F1')!
    const rkA = f1.zones.find((z) => z.code === 'RK-A')!
    expect([rkA.slots, rkA.used, rkA.boxes, rkA.qty, rkA.oldestDays]).toEqual([96, 2, 2, 9050, 3])
    expect(f1.zones.find((z) => z.code === 'MI3-QC')).toMatchObject({ slots: 0, boxes: 1, holdBoxes: 1 })
    expect(f1.used).toBe(f1.zones.reduce((s, z) => s + z.used, 0))
    expect(d.floors.at(-1)!.floorId).toBe('YARD')
    expect(d.kpi).toMatchObject({ onHand: 9255, holdBoxes: 1, ngWaitQty: 20, received: 200, receiptDocs: 1, issued: 1050, pendingApprovals: 3, slotsUsed: 3 })
  })

  it('charts receipts against issues per day', () => {
    const t = buildDashboard(input({ period: '7d' })).trend
    expect(t.find((p) => p.day === TODAY)).toEqual({ day: TODAY, received: 200, issued: 1050 })
    expect(t.find((p) => p.day === YESTERDAY)).toEqual({ day: YESTERDAY, received: 0, issued: 100 })
    expect(t.find((p) => p.day === addDays(TODAY, -3))!.received).toBe(120)
  })

  it('raises alerts that open the plan where the boxes are or the tab that needs action', () => {
    const d = buildDashboard(input())
    const byId = new Map(d.alerts.map((a) => [a.id, a]))
    const low = byId.get('low-K1G-RAT00586')!
    expect(low.level).toBe('critical')
    // เปิดผังที่โซนที่มี part นี้มากสุด (RK-B 200 > RK-A 50) และไฮไลต์กล่องที่มี part นี้
    expect(low.action).toEqual({ kind: 'plan', zoneId: 'F1-RK-B', lpnNos: ['LPN-2', 'LPN-3'] })
    expect(byId.get('mi3-wait')!.action).toEqual({ kind: 'plan', zoneId: 'F1-MI3', lpnNos: ['LPN-4'] })
    expect(byId.get('loose')!.action).toMatchObject({ lpnNos: ['LPN-8'] })
    expect(byId.get('approvals')!.action).toEqual({ kind: 'wms', tab: 'count' })
    expect(byId.has('ng-wait')).toBe(true)
    expect(byId.has('close')).toBe(false)
    expect(d.alerts[0].level).toBe('critical')
  })

  it('asks to close last month for models holding stock from before this month', () => {
    const closed: StockClosing = { id: 'c', modelCode: 'K1G', month: '2026-10', status: 'closed', totals: [], closedBy: 'x', closedAt: 'x', planningBy: null, planningAt: null, accountBy: null, accountAt: null, note: null }
    const d = buildDashboard(input({ today: '2026-11-05', closings: [closed] }))
    const close = d.alerts.find((a) => a.id === 'close')!
    expect([close.level, close.detail]).toEqual(['warning', 'J1A'])
    expect(d.alerts.find((a) => a.id === 'ack')!.action).toEqual({ kind: 'wms', tab: 'ledger' })
  })

  it('filters every number and alert to one model', () => {
    const d = buildDashboard(input({ model: 'J1A' }))
    expect(d.models.map((m) => m.model)).toEqual(['J1A'])
    expect(d.kpi).toMatchObject({ onHand: 0, holdBoxes: 1, issued: 0, ngFound: 5, slotsUsed: 0 })
    expect(d.alerts.map((a) => a.id)).not.toContain('low-K1G-RAT00586')
    expect(d.alerts.map((a) => a.id)).not.toContain('loose')
    const rkA = d.floors.find((f) => f.floorId === 'F1')!.zones.find((z) => z.code === 'RK-A')!
    expect([rkA.qty, rkA.modelQty]).toEqual([9050, 0])
  })
})

describe('dashboard on the demo site', () => {
  it('reads receipts, MI3 results and back-dated issues from the sample data', async () => {
    const api = demoWms({ samples: true })
    const today = bangkokDay(new Date().toISOString())
    const from = fetchFrom(today)
    const [lpns, reqs, activity, m] = await Promise.all([api.activeLpns(), api.listRequisitions(from, today), api.dashboardActivity(from), api.master()])
    expect(new Set(activity.receipts.map((r) => r.model))).toEqual(new Set(['K1G', 'J1D', 'J1A']))
    expect(activity.qi.map((q) => [q.model, q.ng])).toEqual([['J1A', 5]])
    const d = buildDashboard({ today, period: '7d', model: null, layout: sampleLayout, master: m, lpns, reqs, activity, pending: { adjustments: 0, countSheets: 0 }, closings: [] })
    // เบิกเข้าไลน์ 4 วันทำงาน (ย้อนหลัง 3 วัน + วันนี้)
    expect(d.workingDays).toBe(4)
    expect(d.trend.filter((p) => p.issued > 0).map((p) => p.day)).toEqual([addDays(today, -3), addDays(today, -2), addDays(today, -1), today])
    // วันนี้เบิกครบทั้ง 3 part ของตัวอย่าง (100 + 100 + 900)
    expect(d.trend.at(-1)!.issued).toBe(1100)
    expect(d.alerts.find((a) => a.id === 'low-K1G-RAT00586')?.level).toBe('critical')
  })
})
