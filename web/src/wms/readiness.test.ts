import { describe, expect, it } from 'vitest'
import { sampleLayout } from '../data/factoryLayout'
import { fixtureMaster } from '../lib/mapFixture'
import { buildReadiness, type ReadyInput } from './readiness'
import type { MasterData } from './types'

const master: MasterData = {
  ...fixtureMaster,
  models: [
    { code: 'K1G', customerId: 'RE', requiresInspection: false },
    { code: 'J1A', customerId: 'RE', requiresInspection: true },
  ],
  rules: [],
  zoneHeads: [],
  fgItems: [{ code: '2019333', name: 'K1G FRONT', modelCode: 'K1G', active: true, lines: [{ partNo: 'RAT00586', qtyPer: 1 }] }],
}
const input = (over: Partial<ReadyInput> = {}): ReadyInput => ({
  staff: [
    { id: '1', employeeCode: '10001', fullName: 'WH', role: 'warehouse' },
    { id: '2', employeeCode: '10002', fullName: 'MGR', role: 'manager' },
  ],
  master,
  zones: sampleLayout.zones,
  mode: 'trial',
  boxes: 0,
  countSheets: 0,
  ...over,
})
const byId = (over: Partial<ReadyInput> = {}) => new Map(buildReadiness(input(over)).map((i) => [i.id, i]))

describe('go-live readiness', () => {
  it('reports what is still missing from the data in the system', () => {
    const r = byId()
    // J1A ต้องผ่าน MI3 ⇒ ต้องมีคนบทบาท MI3
    expect(r.get('roles')).toMatchObject({ ok: false, required: true, progress: { done: 2, total: 3 } })
    expect(r.get('roles')!.detail).toContain('MI3 คัดงาน 0 คน')
    expect(r.get('slots')).toMatchObject({ ok: true })
    expect(r.get('slotLabels')!.ok).toBeNull()
    expect(r.get('bom')).toMatchObject({ ok: false, progress: { done: 1, total: 2 } })
    expect(r.get('bom')!.detail).toContain('J1A')
    expect(r.get('opening')!.ok).toBe(false)
    expect(r.get('live')!.ok).toBe(false)
    expect(r.get('heads')).toMatchObject({ ok: false, required: false })
    expect(r.get('uam')).toMatchObject({ ok: false, progress: { done: 0, total: 3 } })
    expect(r.get('rules')!.ok).toBe(false)
  })

  it('turns items green once the data is in place', () => {
    const r = byId({
      staff: [...input().staff, { id: '3', employeeCode: '10003', fullName: 'QC', role: 'mi3' }],
      mode: 'live',
      countSheets: 2,
      master: { ...master, models: master.models.slice(0, 1), parts: master.parts.map((p) => ({ ...p, uamCode: 'U' })) },
    })
    expect([r.get('roles')!.ok, r.get('bom')!.ok, r.get('opening')!.ok, r.get('live')!.ok, r.get('uam')!.ok]).toEqual([true, true, true, true, true])
    // ไม่มี Model ที่ต้องผ่าน MI3 ⇒ ไม่ต้องมีบทบาท MI3
    expect(byId({ master: { ...master, models: master.models.slice(0, 1) } }).get('roles')!.progress).toEqual({ done: 2, total: 2 })
  })
})
