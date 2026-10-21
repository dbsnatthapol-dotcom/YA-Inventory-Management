import { describe, expect, it } from 'vitest'
import { checkSummary, compareParts, groupCases, lineIssues, offInvoice } from './checkSheet'
import { demoWms } from './demoApi'
import { ARCHIVE_CONFIRM } from './types'
import type { CheckLine, CheckPayload } from './types'

let n = 0
const line = (caseNo: string, partNo: string, plQty: number, actualQty: number | null, more: Partial<CheckLine> = {}): CheckLine => ({
  id: `l${++n}`,
  checkId: 'c',
  lineNo: n,
  caseNo,
  partNo,
  description: null,
  plQty,
  invLine: null,
  zoneId: null,
  extra: false,
  actualQty,
  damagedQty: 0,
  note: null,
  photos: [],
  checkedCode: null,
  checkedAt: null,
  version: 0,
  ...more,
})

describe('check sheet logic', () => {
  it('names the problem of each checked line and leaves unchecked lines alone', () => {
    expect(lineIssues(line('1', 'A', 10, null))).toEqual([])
    expect(lineIssues(line('1', 'A', 10, 10))).toEqual([])
    expect(lineIssues(line('1', 'A', 10, 8))).toEqual(['short'])
    expect(lineIssues(line('1', 'A', 10, 12, { damagedQty: 1 }))).toEqual(['over', 'damaged'])
    expect(lineIssues(line('1', 'A', 10, 0))).toEqual(['missing'])
    expect(lineIssues(line('1', 'A', 0, 5, { extra: true }))).toEqual(['extra'])
  })

  it('groups lines by case in human order with the no-case lines last', () => {
    const lines = [line('Pallet-10', 'A', 1, 1), line('', 'B', 1, null), line('Pallet-2', 'C', 5, 4), line('Pallet-2', 'D', 5, null), line('Pallet-1', 'E', 1, null)]
    const cases = groupCases(lines)
    expect(cases.map((c) => [c.caseNo, c.state, c.checked, c.issues])).toEqual([
      ['Pallet-1', 'todo', 0, 0],
      ['Pallet-2', 'partial', 1, 1],
      ['Pallet-10', 'ok', 1, 0],
      ['', 'todo', 0, 0],
    ])
    const s = checkSummary(lines)
    expect([s.lines, s.checked, s.cases, s.casesDone, s.issueLines, s.issues.short, s.plQty, s.actualQty]).toEqual([5, 2, 4, 1, 1, 1, 13, 5])
  })

  it('compares part totals across cases against the invoice', () => {
    const lines = [line('1', 'A', 100, 100), line('2', 'A', 30, 25), line('2', 'B', 0, 5, { extra: true }), line('3', 'C', 10, null)]
    const rows = compareParts(lines, [
      { lineNo: 1, partNo: 'A', description: null, qty: 130 },
      { lineNo: 2, partNo: 'D', description: 'ใน invoice อย่างเดียว', qty: 4 },
    ])
    expect(rows.map((r) => [r.partNo, r.pl, r.actual, r.invoice])).toEqual([
      ['A', 130, 125, 130],
      ['B', 0, 5, null],
      ['C', 10, null, null],
      ['D', 0, 0, 4],
    ])
    expect(offInvoice(rows).map((r) => r.partNo)).toEqual(['A', 'D'])
  })
})

const sheet = (more: Partial<CheckPayload> = {}): CheckPayload => ({
  modelCode: 'K1G',
  packingList: { refDoc: 'PL-C1', packages: 'Pallet-1 to Pallet-3' },
  invoice: { invoiceNo: 'INV-C1', lines: [{ lineNo: 1, partNo: 'RAT00586/B', description: 'HUB', qty: 130 }] },
  lines: [
    { caseNo: 'p-1', partNo: 'RAT00586/B', description: '', plQty: 100 },
    { caseNo: 'P-1', partNo: 'RAT00566', description: '', plQty: 50 },
    { caseNo: 'P-2', partNo: 'RAT00586', description: '', plQty: 30 },
  ],
  ...more,
})

describe('receiving with a check sheet (demo, same rules as check_* in 0020)', () => {
  it('checks case by case, stops a stale save, and receives one box per case', async () => {
    const api = demoWms()
    const { id, checkNo } = await api.createCheck(sheet())
    expect(checkNo).toMatch(/^CHK-\d{4}-0001$/)
    let d = (await api.checkDetail(id))!
    expect(d.lines.map((l) => [l.caseNo, l.partNo, l.description, l.actualQty])).toEqual([
      ['P-1', 'RAT00586', 'HUB, REAR, TUBELESS, K1G', null],
      ['P-1', 'RAT00566', 'SPOKE 1, REAR, TUBELESS. 17" X 3.5"', null],
      ['P-2', 'RAT00586', 'HUB, REAR, TUBELESS, K1G', null],
    ])
    expect(await api.saveCheckCase(id, 'p-1', 'ok')).toBe(2)
    const short = d.lines[2]
    const saved = await api.saveCheckLine(short.id, short.version, { actual: 25, damaged: 2, note: ' บุบ ' })
    expect([saved.actualQty, saved.damagedQty, saved.note, saved.version]).toEqual([25, 2, 'บุบ', 1])
    // อีกเครื่องยังเห็น version เดิม ⇒ ต้องโหลดใหม่
    await expect(api.saveCheckLine(short.id, short.version, { actual: 30 })).rejects.toThrow('มีคนบันทึกไปก่อนแล้ว')
    await expect(api.saveCheckLine(short.id, 1, { actual: 2, damaged: 3 })).rejects.toThrow('จำนวนเสียหายมากกว่าที่นับได้')
    await api.addCheckLine(id, { caseNo: 'p-2', partNo: 'RAT00566', actual: 5, note: 'มาเกิน' })
    d = (await api.checkDetail(id))!
    expect(d.check.checkedCount).toBe(4)

    const { grnId, grnNo } = await api.completeCheck(id)
    const grn = (await api.grnDetail(grnId))!
    expect(grn.lpns.map((l) => [l.caseNo, l.items.map((i) => `${i.partNo}:${i.qty}`).join(',')])).toEqual([
      ['P-1', 'RAT00586:100,RAT00566:50'],
      ['P-2', 'RAT00586:25,RAT00566:5'],
    ])
    expect(grn.lines.map((l) => [l.caseNo, l.countedQty, l.invoiceQty])).toEqual([
      ['P-1', 100, 130],
      ['P-1', 50, null],
      ['P-2', 25, 130],
      ['P-2', 5, null],
    ])
    expect(grn.grn.checkId).toBe(id)
    expect((await api.listChecks())[0]).toMatchObject({ id, status: 'done', grnNo })
    await expect(api.saveCheckLine(short.id, 1, { actual: 1 })).rejects.toThrow('ใบตรวจรับนี้ปิดแล้ว')
  })

  it('needs every line checked and something counted, and can be cancelled', async () => {
    const api = demoWms()
    const { id } = await api.createCheck(sheet())
    await expect(api.completeCheck(id)).rejects.toThrow('ยังตรวจไม่ครบ 3 รายการ')
    await api.saveCheckCase(id, 'P-1', 'missing')
    await api.saveCheckCase(id, 'P-2', 'missing')
    expect((await api.checkDetail(id))!.lines.map((l) => [l.actualQty, l.note])).toEqual([
      [0, 'ไม่มีเคสนี้มากับรถ'],
      [0, 'ไม่มีเคสนี้มากับรถ'],
      [0, 'ไม่มีเคสนี้มากับรถ'],
    ])
    await expect(api.completeCheck(id)).rejects.toThrow('ไม่มีของที่นับได้เลย')
    await expect(api.cancelCheck(id, ' ')).rejects.toThrow('ใส่เหตุผลที่ยกเลิก')
    await api.cancelCheck(id, 'รถเที่ยวนี้ไม่มา')
    expect((await api.listChecks())[0]).toMatchObject({ status: 'cancelled', cancelReason: 'รถเที่ยวนี้ไม่มา' })
  })

  it('keeps parts that MI3 must inspect in their own boxes', async () => {
    const api = demoWms()
    const { grnId } = await api.createGrn({
      packingList: { refDoc: 'PL-J1A' },
      modelCode: 'J1A',
      lines: [
        { caseNo: 'F1', partNo: 'RAJ00994', description: '', plQty: 10, countedQty: 10 },
        { caseNo: 'F1', partNo: 'RAT00566', description: '', plQty: 90, countedQty: 90 },
        { caseNo: 'F1', partNo: '150324', description: '', plQty: 8, countedQty: 8 },
      ],
    })
    const boxes = (await api.grnDetail(grnId))!.lpns
    expect(boxes.map((l) => [l.caseNo, l.hold, l.locationCode, l.items.map((i) => i.partNo).join(',')])).toEqual([
      ['F1', true, 'MI3-QC', 'RAJ00994'],
      ['F1', false, 'RCV-01', 'RAT00566,150324'],
    ])
  })
})

describe('moving boxes picked from a list and voiding a receipt (demo)', () => {
  it('moves many boxes to one open slot and suggests slots from the current zone rules', async () => {
    const api = demoWms()
    const { id } = await api.createCheck(sheet())
    await api.saveCheckCase(id, 'P-1', 'ok')
    await api.saveCheckCase(id, 'P-2', 'ok')
    const { grnId } = await api.completeCheck(id)
    const ids = (await api.grnDetail(grnId))!.lpns.map((l) => l.id)
    await expect(api.moveLpns(ids, 'NOPE-1')).rejects.toThrow('ไม่พบช่อง NOPE-1')
    await expect(api.moveLpns([], 'RK-A-01-1')).rejects.toThrow('เลือกกล่องที่จะย้าย')
    const sug = await api.suggestSlots(ids)
    expect(sug.map((s) => s.lpnId)).toEqual(ids)
    expect(new Set(sug.map((s) => s.code)).size).toBe(2)
    expect(await api.moveLpns(ids, sug[0].code!)).toEqual({ moved: 2, same: 0 })
    expect(await api.moveLpns([ids[0]], sug[0].code!)).toEqual({ moved: 0, same: 1 })
    const tx = await api.recentTx(5)
    expect(tx.filter((t) => t.kind === 'PUT').map((t) => [t.fromLoc, t.toLoc, t.via])).toEqual([
      ['RCV-01', sug[0].code, 'list'],
      ['RCV-01', sug[0].code, 'list'],
    ])
    // ช่องที่ใช้แล้วไม่ถูกแนะนำซ้ำ
    expect((await api.suggestSlots([ids[1]]))[0].code).not.toBe(sug[0].code)
  })

  it('voids a receipt whose goods are untouched, reopens its check sheet, and refuses used goods', async () => {
    const api = demoWms()
    const { id } = await api.createCheck(sheet())
    await api.saveCheckCase(id, 'P-1', 'ok')
    await api.saveCheckCase(id, 'P-2', 'ok')
    const first = await api.completeCheck(id)
    const ids = (await api.grnDetail(first.grnId))!.lpns.map((l) => l.id)
    await api.moveLpns(ids, 'RK-A-01-1')
    await api.queuePrint({ format: 'label', grnId: first.grnId, lpnIds: ids })
    await expect(api.voidGrn(first.grnId, '')).rejects.toThrow('ใส่เหตุผลที่ยกเลิก')
    expect(await api.voidGrn(first.grnId, ' ใส่ Model ผิด ')).toEqual({ grnNo: first.grnNo, boxes: 2, checkId: id })
    const grn = (await api.grnDetail(first.grnId))!
    expect([grn.grn.status, grn.grn.voidReason, grn.lpns.length]).toEqual(['void', 'ใส่ Model ผิด', 0])
    expect((await api.activeLpns()).length).toBe(0)
    expect((await api.listPrintJobs())[0].status).toBe('cancelled')
    expect((await api.ledgerRows(['RAT00586', 'RAT00566'], new Date(Date.now() + 86_400_000).toISOString())).filter((r) => r.kind === 'RECEIVE')).toEqual([])
    const reopened = (await api.checkDetail(id))!.check
    expect([reopened.status, reopened.grnId, reopened.note]).toEqual(['open', null, `ยกเลิก ${first.grnNo}: ใส่ Model ผิด`])
    await expect(api.voidGrn(first.grnId, 'ซ้ำ')).rejects.toThrow('ใบรับนี้ยกเลิกไปแล้ว')

    // แก้แล้วยืนยันใหม่ ⇒ ใบรับเลขใหม่ · เบิกไปแล้วยกเลิกไม่ได้
    const second = await api.completeCheck(id)
    expect(second.grnNo).not.toBe(first.grnNo)
    const item = (await api.grnDetail(second.grnId))!.lpns[0].items[0]
    await api.scanIssue({ itemId: item.id, qty: 1, kind: 'line', modelCode: 'K1G' })
    await expect(api.voidGrn(second.grnId, 'ผิด')).rejects.toThrow('ยกเลิกใบรับไม่ได้ · ของจากใบนี้มีรายการต่อแล้ว: เบิก')
  })

  it('archives check sheets with the other records', async () => {
    const api = demoWms()
    await api.createCheck(sheet())
    expect((await api.envSummary()).counts.receipt_checks).toBe(1)
    await api.archiveEnv(ARCHIVE_CONFIRM, '')
    expect(await api.listChecks()).toEqual([])
    await api.restoreArchive(1)
    expect((await api.listChecks()).length).toBe(1)
  })
})
