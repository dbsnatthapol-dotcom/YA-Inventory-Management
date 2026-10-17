import { describe, expect, it } from 'vitest'
import { demoWms } from './demoApi'
import { ARCHIVE_CONFIRM, envLabel } from './types'

const receive = (api: ReturnType<typeof demoWms>, ref: string) =>
  api.createGrn({ packingList: { refDoc: ref }, modelCode: 'K1G', lines: [{ partNo: 'RAT00586', description: 'RIM', plQty: 100, countedQty: 100 }] })

describe('clear the current mode and keep the data (demo, same rules as admin_archive_env)', () => {
  it('needs the typed word, moves every record out, keeps numbering and restores into an empty mode', async () => {
    const api = demoWms()
    await receive(api, 'PL-1')
    const first = await receive(api, 'PL-2')
    const before = await api.envSummary()
    expect([before.env, before.counts.grns, before.counts.lpns, before.counts.packing_lists, before.archives]).toEqual(['trial-1', 2, 2, 2, []])

    await expect(api.archiveEnv('ล้าง', '')).rejects.toThrow(`พิมพ์คำว่า "${ARCHIVE_CONFIRM}" ให้ตรงเพื่อยืนยัน`)
    expect(await api.archiveEnv(` ${ARCHIVE_CONFIRM} `, ' ฝึกใช้งาน ')).toBe(1)

    const cleared = await api.envSummary()
    expect(Object.values(cleared.counts).every((n) => n === 0)).toBe(true)
    expect(cleared.archives).toMatchObject([{ id: 1, fromEnv: 'trial-1', note: 'ฝึกใช้งาน', restoredAt: null, restorable: true }])
    expect(cleared.archives[0].counts).toMatchObject({ grns: 2, lpns: 2 })
    expect(await api.activeLpns()).toEqual([])
    await expect(api.archiveEnv(ARCHIVE_CONFIRM, '')).rejects.toThrow('ไม่มีข้อมูลรายการในโหมดนี้ให้ล้าง')

    // เลขเอกสารเดินต่อ: ป้ายเก่าที่ยังติดกล่องไม่ชนกับป้ายใหม่
    const next = await receive(api, 'PL-3')
    expect(next.grnNo > first.grnNo).toBe(true)
    expect((await api.envSummary()).archives[0].restorable).toBe(false)
    await expect(api.restoreArchive(1)).rejects.toThrow('โหมดนี้มีข้อมูลใหม่แล้ว')

    // สลับชุด: เก็บชุดใหม่ แล้วกู้ชุดแรก
    expect(await api.archiveEnv(ARCHIVE_CONFIRM, '')).toBe(2)
    await api.restoreArchive(1)
    const restored = await api.envSummary()
    expect([restored.counts.grns, restored.counts.lpns]).toEqual([2, 2])
    expect(restored.archives.map((a) => [a.id, !!a.restoredAt, a.restorable])).toEqual([
      [2, false, false],
      [1, true, false],
    ])
    expect((await api.activeLpns()).length).toBe(2)
    await expect(api.restoreArchive(1)).rejects.toThrow('ชุดนี้กู้คืนไปแล้ว')
  })

  it('restores only into the mode the records came from', async () => {
    const api = demoWms()
    await receive(api, 'PL-1')
    await api.archiveEnv(ARCHIVE_CONFIRM, '')
    await api.setSetting('wms_mode', 'live')
    const live = await api.envSummary()
    expect([live.env, live.archives[0].restorable]).toEqual(['live', false])
    await expect(api.restoreArchive(1)).rejects.toThrow('ชุดนี้ล้างมาจากโหมดทดลอง รอบ 1 · สลับไปโหมดนั้นก่อนจึงจะกู้คืนได้')
    await api.setSetting('wms_mode', 'trial')
    await api.restoreArchive(1)
    expect((await api.envSummary()).counts.lpns).toBe(1)
  })

  it('names modes the way the back office shows them', () => {
    expect([envLabel('live'), envLabel('trial-3'), envLabel('archive-2')]).toEqual(['ใช้งานจริง', 'ทดลอง รอบ 3', 'archive-2'])
  })
})
