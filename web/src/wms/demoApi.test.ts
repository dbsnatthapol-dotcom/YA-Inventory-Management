import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { SAMPLE_MODEL, SAMPLE_PACKING_LIST } from './sampleDocs'

describe('demo receiving and layout save', () => {
  const lines = SAMPLE_PACKING_LIST.lines.slice(0, 2).map((l) => ({ partNo: l.partNo, description: l.description, plQty: l.qty, countedQty: l.qty }))
  const receive = (api: ReturnType<typeof demoWms>, zoneId?: string) =>
    api.createGrn({ packingList: { refDoc: SAMPLE_PACKING_LIST.refDoc }, modelCode: SAMPLE_MODEL, lines: lines.map((l, i) => (i === 0 && zoneId ? { ...l, zoneId } : l)) })

  it('stores a line in the zone the receiver picked, others follow the zone rules', async () => {
    const api = demoWms()
    const { grnId } = await receive(api, 'FB2-RK-J')
    const detail = (await api.grnDetail(grnId))!
    expect(detail.lines[0].homeLocation).toMatch(/^RK-J-\d\d-\d$/)
    expect(detail.lines[1].homeLocation).not.toMatch(/^RK-J-/)
  })

  it('refuses to drop locations that still hold stock', async () => {
    const api = demoWms()
    const { grnId } = await receive(api)
    const detail = (await api.grnDetail(grnId))!
    const lpn = detail.lpns[0]
    await api.scanMove(lpn.id, 'TENT-T-01', 'PUT').catch(() => api.scanMove(lpn.id, 'TENT-T-01', 'MOVE'))
    const tentCodes = (await api.master()).locations.filter((l) => l.zoneId === 'TENT-T').map((l) => l.code)
    await expect(api.saveLayout({ zones: [], removed: [], nodes: [], addEdges: [], dropEdges: [], locations: [{ zoneId: 'TENT-T', kind: 'floor', codes: tentCodes.slice(1) }] })).rejects.toThrow(/ยังมีของ/)
    await api.saveLayout({ zones: [], removed: [], nodes: [], addEdges: [], dropEdges: [], locations: [{ zoneId: 'TENT-T', kind: 'floor', codes: [...tentCodes, 'TENT-T-99'] }] })
    expect((await api.master()).locations.some((l) => l.code === 'TENT-T-99' && l.active)).toBe(true)
  })
})
