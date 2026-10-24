import { describe, expect, it } from 'vitest'
import { box, fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import { flowStages, unreconciled, waitingAck, type FlowStage } from './flowBoard'
import type { Grn, ReceiptCheck, Requisition, StockClosing } from './types'

const check = (more: Partial<ReceiptCheck>): ReceiptCheck => ({
  id: 'c',
  checkNo: 'CHK-2610-0001',
  status: 'open',
  modelCode: 'K1G',
  customerId: null,
  replacement: false,
  plRef: 'PL',
  soNo: null,
  packages: null,
  title: null,
  invoiceNo: null,
  poNo: null,
  docDate: null,
  movementType: null,
  invoiceLines: [],
  plImages: [],
  invImages: [],
  note: null,
  grnId: null,
  grnNo: null,
  createdCode: null,
  createdAt: '2026-10-17T03:00:00Z',
  doneCode: null,
  doneAt: null,
  cancelReason: null,
  cancelledCode: null,
  cancelledAt: null,
  lineCount: 10,
  checkedCount: 4,
  ...more,
})
const grn = (more: Partial<Grn>): Grn => ({
  id: 'g',
  grnNo: 'GRN-2610-0001',
  invoiceId: null,
  invoiceNo: null,
  plRef: 'PL',
  soNo: null,
  packages: null,
  modelCode: 'K1G',
  customerId: null,
  receivedAt: '2026-10-17T03:00:00Z',
  receiverCode: null,
  note: null,
  status: 'active',
  ...more,
})
const req = (more: Partial<Requisition>): Requisition => ({
  id: 'r',
  kind: 'line',
  reqNo: 'RQ-2610-0001',
  docNo: null,
  docDate: '2026-10-17',
  modelCode: 'K1G',
  fgCode: null,
  fgQty: null,
  fromDept: null,
  toDept: null,
  note: null,
  status: 'posted',
  reconciledBy: null,
  createdCode: null,
  createdAt: '2026-10-17T03:00:00Z',
  lines: [{ partNo: 'RAT00566', reqQty: null, qty: 100, balance: null }],
  ...more,
})
const closing = (more: Partial<StockClosing>): StockClosing => ({
  id: 'k',
  modelCode: 'K1G',
  month: '2026-09',
  status: 'closed',
  totals: [],
  closedBy: null,
  closedAt: null,
  planningBy: null,
  planningAt: null,
  accountBy: null,
  accountAt: null,
  note: null,
  ...more,
})
const byKey = (stages: FlowStage[]) => Object.fromEntries(stages.map((s) => [s.key, s]))

describe('warehouse flow board', () => {
  it('counts every stage from live data, oldest work first marked late', () => {
    const stages = flowStages({
      today: '2026-10-17',
      lpns: [...fixtureLpns, box('LPN-R1', 'RCV-01', [['RAT00586', 100]], { grnId: 'g-today', createdAt: '2026-10-17T02:00:00Z' })],
      locations: fixtureMaster.locations,
      checks: [check({ id: 'c1', createdAt: '2026-10-16T03:00:00Z' }), check({ id: 'c2' }), check({ id: 'c3', status: 'done' })],
      grns: [
        grn({ id: 'g-today' }),
        grn({ id: 'g-void', status: 'void' }),
        grn({ id: 'g-cnt', grnNo: 'CNT-2610-0001' }),
        // 16 ต.ค. 23:30 น. เวลาไทย = 17 ต.ค. ตาม UTC ไม่ใช่ ⇒ ไม่นับเป็นวันนี้
        grn({ id: 'g-late-night', receivedAt: '2026-10-16T16:30:00Z' }),
        grn({ id: 'g-old', receivedAt: '2026-10-15T03:00:00Z' }),
      ],
      reqs: [
        req({ id: 'r1' }),
        req({ id: 'r2', kind: 'qc' }),
        req({ id: 'r3', docDate: '2026-10-15' }),
        req({ id: 'r4', kind: 'fm005' }),
        req({ id: 'r5', reconciledBy: 'r4' }),
        req({ id: 'r6', status: 'void' }),
      ],
      closings: [closing({ planningAt: '2026-10-02T00:00:00Z' }), closing({ id: 'k2', modelCode: 'J1A', planningAt: 'x', accountAt: 'x' })],
      printQueued: 2,
    })
    expect(stages.map((s) => [s.step, s.key, s.group])).toEqual([
      [1, 'check', 'in'],
      [2, 'grn', 'in'],
      [3, 'qi', 'in'],
      [4, 'put', 'store'],
      [5, 'stock', 'store'],
      [6, 'ng', 'store'],
      [7, 'issue', 'out'],
      [8, 'fm005', 'out'],
      [9, 'close', 'out'],
    ])
    const by = byKey(stages)
    expect([by.check.value, by.check.state, by.check.detail]).toEqual([2, 'late', 'ตรวจแล้ว 8/20 บรรทัด · ค้างจากวันก่อน 1 ใบ'])
    expect([by.grn.value, by.grn.state, by.grn.detail]).toEqual([1, 'todo', '1 กล่องใหม่ · คิวพิมพ์ 2'])
    // LPN-4 รอ MI3 ตั้งแต่ 14 ต.ค. (3 วัน) และ LPN-5 NG 3 วัน ⇒ ช้า · LPN-R1 เพิ่งรับวันนี้
    expect([by.qi.value, by.qi.state]).toEqual([1, 'late'])
    expect([by.ng.value, by.ng.state, by.ng.detail]).toEqual([1, 'late', '20 ชิ้น · ค้างเกิน 2 วัน 1 กล่อง'])
    expect([by.put.value, by.put.state, by.put.detail]).toEqual([1, 'todo', '100 ชิ้น'])
    // ในช่อง: LPN-1, 2, 3 และ 8 (ช่องที่ผังไม่รู้จักยังเป็นของในคลัง) · ไม่นับกล่องว่าง / หมดแล้ว
    expect([by.stock.value, by.stock.detail]).toEqual([4, '9,255 ชิ้น · 2 part'])
    // เบิกวันนี้: r1 r2 r5 (r3 คนละวัน, FM-P-005 ไม่นับซ้ำ, r6 ยกเลิก)
    expect([by.issue.value, by.issue.detail]).toEqual([3, '300 ชิ้น · ไลน์ 2 · QC 1 · NG 0'])
    expect([by.fm005.value, by.fm005.state, by.fm005.detail]).toEqual([2, 'late', 'ค้างจากวันก่อน 1 ชุด'])
    expect([by.close.value, by.close.state, by.close.detail]).toEqual([1, 'todo', 'ปิดล่าสุด 2026-09 · รอรับทราบ 1'])
  })

  it('stays quiet when nothing waits and says so when a source could not load', () => {
    const by = byKey(flowStages({ today: '2026-10-17', lpns: [], locations: fixtureMaster.locations, checks: null, grns: [], reqs: null, closings: [], printQueued: null }))
    expect(by.check).toMatchObject({ value: null, state: 'idle', detail: 'โหลดไม่ได้' })
    expect(by.grn).toMatchObject({ value: 0, state: 'idle', detail: '0 กล่องใหม่' })
    expect(by.put).toMatchObject({ value: 0, state: 'idle', detail: 'จัดเก็บครบแล้ว' })
    expect(by.issue).toMatchObject({ value: null, state: 'idle', detail: 'โหลดไม่ได้' })
    expect(by.fm005).toMatchObject({ value: null, state: 'idle' })
    expect(by.close).toMatchObject({ value: 0, state: 'idle', detail: 'ยังไม่เคยปิดยอด' })
  })

  it('reminds early in the month which stocked models still have last month open', () => {
    const base = { lpns: fixtureLpns, locations: fixtureMaster.locations, checks: [], grns: [], reqs: [], printQueued: null }
    // K1G ปิด ต.ค. แล้ว · J1A (กล่อง MI3) ยังไม่ปิด
    const closings = [closing({ month: '2026-10', planningAt: 'x', accountAt: 'x' })]
    const early = byKey(flowStages({ ...base, today: '2026-11-03', closings })).close
    expect([early.value, early.state, early.detail]).toEqual([1, 'todo', 'ยังไม่ปิด 2026-10: J1A'])
    expect(byKey(flowStages({ ...base, today: '2026-11-08', closings })).close.state).toBe('late')
    // หลังวันที่ 10 ไม่เตือนแล้ว (ดูที่บัญชีคุมเอง)
    expect(byKey(flowStages({ ...base, today: '2026-11-12', closings })).close).toMatchObject({ value: 0, state: 'ok', detail: 'ปิดล่าสุด 2026-10' })
  })

  it('groups sub-requisitions waiting for FM-P-005 by day and model, and finds closings to acknowledge', () => {
    expect(unreconciled([req({ id: 'a' }), req({ id: 'b' }), req({ id: 'c', modelCode: 'J1A' }), req({ id: 'd', docDate: '2026-10-16' }), req({ id: 'e', kind: 'qc' })])).toEqual([
      { day: '2026-10-16', model: 'K1G', reqs: 1 },
      { day: '2026-10-17', model: 'J1A', reqs: 1 },
      { day: '2026-10-17', model: 'K1G', reqs: 2 },
    ])
    expect(waitingAck([closing({}), closing({ id: 'b', planningAt: 'x', accountAt: 'x' }), closing({ id: 'c', status: 'reopened' })]).map((c) => c.id)).toEqual(['k'])
  })
})
