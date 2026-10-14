import type { Customer, ExtractedInvoice, Part, ProductModel, ZoneRule } from './types'

/**
 * Master ตัวอย่าง: ใบรายงาน STOCK ประจำวันแผนก W/H ASSY (ROYAL ENFIELD K1G SPOKE/NIPPLE)
 * หมายเหตุ: ในไฟล์ต้นฉบับไม่มีแถวที่ 34 และแถวที่ 19 พิมพ์ TYPE ว่า "SPKOE" (แก้เป็น SPOKE)
 */
export const CUSTOMERS: Customer[] = [{ id: 'RE', name: 'Royal Enfield' }]

export const MODELS: ProductModel[] = [
  { code: 'K1G', customerId: 'RE', requiresInspection: false },
  ...['J1D', 'J1A', 'J1C', 'TWIN', 'P4D'].map((code) => ({ code, customerId: 'RE', requiresInspection: true })),
]

const K1G = ['K1G']
const p = (partNo: string, type: string, description: string, models = K1G): Part => ({ partNo, type, description, customerId: 'RE', models })

export const PARTS: Part[] = [
  p('RAJ00537/B', 'RIM', 'RIM, FRONT, TUBELESS,21X 2.15"'),
  p('RAT00587/B', 'RIM', 'RIM, REAR, TUBELESS, 17" X 3.5"'),
  p('RAJ00995/A', 'RIM', 'RIM, FRONT, TUBELESS,21X 2.15" BLACK'),
  p('RAT1088/A', 'RIM', 'RIM, REAR, TUBELESS, 17" X 3.5" BLACK'),
  p('PK1G0021', 'RIM', 'RIM,FRONT 21x2.15" GOLD'),
  p('PK1G0022', 'RIM', 'RIM,REAR,TL,17x3.5" GOLD'),
  p('RAJ00994/B', 'RIM', 'RIM,FRONT 21x2.15" JF,GOLD'),
  p('RAT01087/B', 'RIM', 'RIM,REAR,TL,17x3.5" JF,GOLD'),
  p('RAJ00536/B', 'HUB', 'HUB, FRONT, TUBELESS, 21X 2.15"'),
  p('RAT00586/B', 'HUB', 'HUB, REAR, TUBELESS, K1G'),
  p('RAJ00875/B', 'HUB', 'HUB, FRONT,TL, 21x2.15, OLIVE'),
  p('RAT00952/A', 'HUB', 'HUB, REAR, TL, K1G, OLIVE'),
  p('RAJ00239/B', 'BEARING', 'BEARING, WHEEL, 6004'),
  p('RAJ00238/D', 'SPACER', 'SPACER, WHEEL, INTERNAL'),
  p('RAT00282/D', 'SPACER', 'SPACER, WHEEL, INTERNAL'),
  p('RAJ00240/B', 'SEAL', 'SEAL, WHEEL, 44, 30'),
  p('RAT00283/A', 'SEAL', 'SEAL, WHEEL, 42, 30'),
  p('RAJ00538/B', 'SPOKE', 'SPOKE, FRONT, TUBELESS,21X 2.15"'),
  p('RAT00566/B', 'SPOKE', 'SPOKE 1, REAR, TUBELESS. 17" X 3.5"'),
  p('RAT00567/B', 'SPOKE', 'SPOKE 2, REAR, TUBELESS. 17" X 3.5"'),
  p('RAT00568/B', 'SPOKE', 'SPOKE 3, REAR, TUBELESS. 17" X 3.5"'),
  p('RAT00592/B', 'SPOKE', 'SPOKE 4, REAR, TUBELESS. 17" X 3.5"'),
  p('RAJ00550/B', 'NIPPLE', 'NIPPLE, SPOKE, LOCKING'),
  p('RAB00587/B', 'DISC', 'BRAKE DISC, SOLID, 320'),
  p('RAB00479/C', 'DISC', 'BRAKE DISC, SOLID, 270'),
  p('RAJ00539/B', 'TONER', 'TONER RING, FRONT'),
  p('RAJ00288/B', 'TONER', 'TONER RING'),
  p('RAT00467/A', 'BOLT', 'BOLT, M8x1.25x 21, SHOULDERED'),
  p('RAJ00757/A', 'RUBBER', 'CUSH RUBBER P4D /K1G', ['K1G', 'P4D']),
  p('RAT01154/B', 'VALVE', 'VALVE, WHEEL, TUBELESS'),
  p('RAJ00570/B', 'VALVE', 'VALVE, WHEEL, TUBELESS'),
  p('RAJ00301/D', 'TYRE', 'TYRE 90/90-21 FRONT'),
  p('RAT00322/D', 'TYRE', 'TYRE 140/80-17 REAR'),
  p('150324/A', 'BEARING', 'WHEEL BEARING 6203 (17x40x12) K1G , J1D, J1A ,J1C ,TWIN, P4D,M', ['K1G', 'J1D', 'J1A', 'J1C', 'TWIN', 'P4D']),
]

/**
 * กฎแนะนำโซน (ร่าง — ให้หน้างานยืนยัน): ลูกค้า Royal Enfield แยกตามกลุ่มสินค้า
 * โซนอ้างอิง id ใน web/src/data/factoryLayout.ts
 */
export const ZONE_RULES: ZoneRule[] = [
  { customerId: 'RE', type: 'RIM', zoneId: 'F1-RK-C' },
  { customerId: 'RE', type: 'HUB', zoneId: 'F1-RK-B' },
  { customerId: 'RE', type: 'DISC', zoneId: 'F1-RK-B' },
  { customerId: 'RE', type: 'TONER', zoneId: 'F1-RK-B' },
  { customerId: 'RE', type: 'SPOKE', zoneId: 'F1-RK-A' },
  { customerId: 'RE', type: 'NIPPLE', zoneId: 'F1-RK-A' },
  { customerId: 'RE', type: 'BOLT', zoneId: 'F1-RK-A' },
  { customerId: 'RE', type: 'BEARING', zoneId: 'F2-RK-E' },
  { customerId: 'RE', type: 'SPACER', zoneId: 'F2-RK-E' },
  { customerId: 'RE', type: 'SEAL', zoneId: 'F2-RK-E' },
  { customerId: 'RE', type: 'VALVE', zoneId: 'F2-RK-E' },
  { customerId: 'RE', type: 'RUBBER', zoneId: 'F2-RK-E' },
  { customerId: 'RE', type: 'TYRE', zoneId: 'TENT-C' },
  { customerId: 'RE', type: null, zoneId: 'TENT-D' },
]

/**
 * Invoice ตัวอย่างสำหรับ demo (ผลที่ "อ่าน" ได้จากภาพ)
 * ตั้งใจใส่ความผิดพลาดแบบที่ OCR เจอบ่อย เช่น ตัว O กับเลข 0 เพื่อแสดงการตรวจเทียบกับ Master
 */
export const SAMPLE_INVOICES: Record<string, Omit<ExtractedInvoice, 'provider'>> = {
  k1g: {
    invoiceNo: 'RE-INV-2610-0158',
    invoiceDate: '2026-10-14',
    supplier: 'Royal Enfield (ตัวอย่าง)',
    model: 'K1G',
    lines: [
      { partNo: 'RAJ00537/B', description: 'RIM, FRONT, TUBELESS,21X 2.15"', qty: 200 },
      { partNo: 'RAT00587/B', description: 'RIM, REAR, TUBELESS, 17" X 3.5"', qty: 200 },
      { partNo: 'RAJ00536/B', description: 'HUB, FRONT, TUBELESS, 21X 2.15"', qty: 200 },
      { partNo: 'RAT00586/B', description: 'HUB, REAR, TUBELESS, K1G', qty: 200 },
      { partNo: 'RAJ00538/B', description: 'SPOKE, FRONT, TUBELESS,21X 2.15"', qty: 7200 },
      { partNo: 'RAJ0O550/B', description: 'NIPPLE, SPOKE, LOCKING', qty: 14400 },
      { partNo: 'RAJ00239/B', description: 'BEARING, WHEEL, 6004', qty: 400 },
      { partNo: 'RAJ00301/D', description: 'TYRE 90/90-21 FRONT', qty: 200 },
    ],
  },
  j1d: {
    invoiceNo: 'RE-INV-2610-0163',
    invoiceDate: '2026-10-14',
    supplier: 'Royal Enfield (ตัวอย่าง)',
    model: 'J1D',
    lines: [{ partNo: '150324/A', description: 'WHEEL BEARING 6203 (17x40x12)', qty: 1200 }],
  },
}
