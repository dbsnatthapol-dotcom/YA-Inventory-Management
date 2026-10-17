import { describe, expect, it } from 'vitest'
import { box, fixtureLpns, fixtureMaster } from '../lib/mapFixture'
import { workQueues } from './myWork'

describe('work queues', () => {
  it('lists boxes to put away, inspect at MI3 and return as NG, oldest first', () => {
    const lpns = [
      ...fixtureLpns,
      box('LPN-R1', 'RCV-01', [['RAT00586', 100]], { createdAt: '2026-10-16T02:00:00Z' }),
      box('LPN-R2', 'RCV-01', [['RAT00566', 900]], { createdAt: '2026-10-12T02:00:00Z' }),
      // ผ่าน MI3 แล้ว ยังอยู่ที่จุดตรวจ ⇒ ต้องจัดเก็บ
      box('LPN-Q1', 'MI3-QC', [['1100351', 55]], { modelCode: 'J1A', createdAt: '2026-10-15T02:00:00Z' }),
    ]
    const q = workQueues(lpns, fixtureMaster.locations, '2026-10-17')
    expect(q.putaway.map((b) => [b.lpnNo, b.days])).toEqual([
      ['LPN-R2', 5],
      ['LPN-Q1', 2],
      ['LPN-R1', 1],
    ])
    expect(q.qi).toEqual([{ lpnNo: 'LPN-4', loc: 'MI3-QC', summary: '1100351 × 60', qty: 60, days: 3, model: 'J1A' }])
    expect(q.ng.map((b) => [b.lpnNo, b.qty])).toEqual([['LPN-5', 20]])
  })
})
