import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'

describe('print queue (phone → PC)', () => {
  it('queues selected boxes of a GRN, then the PC marks it printed', async () => {
    const api = demoWms()
    const { grnId, grnNo } = await api.createGrn({
      packingList: { refDoc: 'PL-Q' },
      modelCode: 'K1G',
      lines: [
        { partNo: 'RAT00586', description: 'HUB', plQty: 10, countedQty: 10 },
        { partNo: 'RAT01088', description: 'RIM', plQty: 5, countedQty: 5 },
      ],
    })
    const d = (await api.grnDetail(grnId))!
    await expect(api.queuePrint({ format: 'label', grnId, lpnIds: [] })).rejects.toThrow(/ยังไม่ได้เลือกป้าย/)
    await expect(api.queuePrint({ format: 'label', grnId, lpnIds: ['other'] })).rejects.toThrow(/ไม่อยู่ใน/)
    const id = await api.queuePrint({ format: 'label', grnId, lpnIds: [d.lpns[0].id], copies: 20, title: `${grnNo} · 1 ป้าย` })
    await api.queuePrint({ format: 'a4', grnId, lpnIds: [] })
    let jobs = await api.listPrintJobs()
    expect(jobs.filter((j) => j.status === 'queued')).toHaveLength(2)
    expect(jobs.find((j) => j.id === id)).toMatchObject({ copies: 10, lpnIds: [d.lpns[0].id], title: `${grnNo} · 1 ป้าย` })
    await api.finishPrintJob(id, 'printed')
    await expect(api.finishPrintJob(id, 'cancelled')).rejects.toThrow(/ไปแล้ว/)
    jobs = await api.listPrintJobs()
    expect(jobs.map((j) => j.status).sort()).toEqual(['printed', 'queued'])
  })
})
