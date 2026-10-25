import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { LabelContext } from '../../wms/labels'
import type { Grn, GrnLine, Lpn, MasterData } from '../../wms/types'
import { GrnSheet, LabelCard } from './Documents'

// B9 ป้ายกล่อง: ช่องที่เก็บของกล่องหลาย part · กล่องรวม part เดียวกัน · เวลาไทย · B5 ใบ GRN เทียบราย part

const master = { locations: [{ code: 'RCV-01', zoneId: 'RCV', kind: 'staging', active: true, blocked: false, manual: false }], zoneHeads: [], parts: [] } as unknown as MasterData
const grn = { id: 'g', grnNo: 'GRN-2610-0001', invoiceNo: 'INV-1', plRef: 'PL-1', packages: null, modelCode: 'K1G', customerId: 'RE', receivedAt: '2026-10-24T20:30:00Z', receiverCode: '10001', soNo: null, status: 'active' } as unknown as Grn
const line = (id: string, lineNo: number, partNo: string, homeLocation: string | null, countedQty: number, invoiceQty: number | null): GrnLine =>
  ({ id, grnId: 'g', lineNo, partNo, description: partNo === 'RAT00586' ? 'HUB' : 'RIM', partType: null, plQty: countedQty, countedQty, invoiceQty, needsQi: false, homeLocation, caseNo: `C${lineNo}` }) as GrnLine
const ctx = (lines: GrnLine[]): LabelContext => ({ grn, lines, master, trial: false })
const box = (items: [string, string, number][]): Lpn => ({
  id: 'b',
  lpnNo: 'LPN-2610-000001',
  grnId: 'g',
  locationCode: 'RCV-01',
  hold: false,
  status: 'active',
  createdAt: grn.receivedAt,
  caseNo: 'C1',
  items: items.map(([id, partNo, qty]) => ({ id: `i-${id}`, lpnId: 'b', grnLineId: id, partNo, qty })),
})
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('B9 box label', () => {
  it('shows the suggested slot of a multi-part box instead of the receiving point', () => {
    const t = text(renderToStaticMarkup(<LabelCard lpn={box([['l1', 'RAT00586', 10], ['l2', 'RAT01088', 5]])} ctx={ctx([line('l1', 1, 'RAT00586', 'RK-A-01-1', 10, null), line('l2', 2, 'RAT01088', 'RK-B-01-1', 5, null)])} />))
    expect(t).toContain('ที่เก็บ RK-A-01-1')
    expect(t).toContain('ตอนนี้อยู่ RCV-01')
    expect(t).toContain('2 part')
  })

  it('treats a merged box of one part (two receipt lines) as a single-part box', () => {
    const t = text(renderToStaticMarkup(<LabelCard lpn={box([['l1', 'RAT00586', 10], ['l2', 'RAT00586', 6]])} ctx={ctx([line('l1', 1, 'RAT00586', 'RK-A-01-1', 10, null), line('l2', 2, 'RAT00586', 'RK-A-01-1', 6, null)])} />))
    expect(t).not.toContain('part ')
    expect(t).toContain('RAT00586 HUB')
    expect(t).toContain('16 PCS')
  })

  it('prints the receipt time in Thai time whatever the computer time zone', () => {
    const t = text(renderToStaticMarkup(<LabelCard lpn={box([['l1', 'RAT00586', 10]])} ctx={ctx([line('l1', 1, 'RAT00586', 'RK-A-01-1', 10, null)])} />))
    // 20:30 UTC วันที่ 24 = 03:30 วันที่ 25 เวลาไทย
    expect(t).toMatch(/25\/10\/2026.*03:30/)
  })
})

describe('B5 printed GRN', () => {
  it('compares cases of one part together with the invoice', () => {
    const ok = text(renderToStaticMarkup(<GrnSheet ctx={ctx([line('l1', 1, 'RAT00586', 'RK-A-01-1', 50, 100), line('l2', 2, 'RAT00586', 'RK-A-01-1', 50, 100)])} />))
    expect(ok).not.toContain('ไม่ตรง Invoice')
    expect(ok).toContain('รวม 2 เคส')
    expect(ok).toContain('รวมที่บรรทัด 1')
    const short = text(renderToStaticMarkup(<GrnSheet ctx={ctx([line('l1', 1, 'RAT00586', 'RK-A-01-1', 50, 100), line('l2', 2, 'RAT00586', 'RK-A-01-1', 40, 100)])} />))
    expect(short).toContain('ไม่ตรง Invoice 1 part')
  })
})
