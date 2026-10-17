import { sampleLayout } from '../data/factoryLayout'
import { layoutLocations } from '../wms/locations'
import type { Lpn, MasterData } from '../wms/types'

/** ข้อมูลกล่องตัวอย่างสำหรับชุดทดสอบของผัง (ไม่ใช้ในหน้าเว็บ) */
export const fixtureMaster: Pick<MasterData, 'locations' | 'parts'> = {
  locations: layoutLocations(sampleLayout).map((l) => ({ ...l, active: true })),
  parts: [
    { partNo: 'RAT00586', name: 'HUB, REAR', type: 'HUB', customerId: 'RE', models: ['K1G'] },
    { partNo: '1100351', name: 'RIM FRONT', type: 'RIM', customerId: 'RE', models: ['J1A'] },
    { partNo: 'RAT00566', name: 'SPOKE 1', type: 'SPOKE', customerId: 'RE', models: ['K1G'] },
  ],
}

export const box = (lpnNo: string, location: string, items: [string, number][], opts: Partial<Lpn> = {}): Lpn => ({
  id: lpnNo,
  lpnNo,
  grnId: 'g',
  locationCode: location,
  hold: false,
  status: 'active',
  createdAt: '2026-10-14T02:00:00Z',
  items: items.map(([partNo, qty], i) => ({ id: `${lpnNo}-${i}`, lpnId: lpnNo, grnLineId: 'x', partNo, qty })),
  modelCode: 'K1G',
  ...opts,
})

export const fixtureLpns: Lpn[] = [
  box('LPN-1', 'RK-A-01-1', [['RAT00566', 6000]]),
  // กล่องที่รวมแล้ว: 2 part ในกล่องเดียว
  box('LPN-2', 'RK-A-01-2', [
    ['RAT00566', 3000],
    ['RAT00586', 50],
  ]),
  box('LPN-3', 'RK-B-02-1', [['RAT00586', 200]]),
  box('LPN-4', 'MI3-QC', [['1100351', 60]], { hold: true, modelCode: 'J1A' }),
  box('LPN-5', 'NG-HOLD', [['RAT00586', 20]]),
  // ไม่ขึ้นผัง: รายการหมด / กล่องใช้หมดแล้ว / ช่องที่ไม่รู้จัก
  box('LPN-6', 'RK-A-02-1', [['RAT00566', 0]]),
  box('LPN-7', 'RK-A-03-1', [['RAT00566', 100]], { status: 'empty' }),
  box('LPN-8', 'NOWHERE-9', [['RAT00566', 5]]),
]
