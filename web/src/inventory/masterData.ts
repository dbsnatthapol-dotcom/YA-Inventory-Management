import type { Customer, ExtractedInvoice, Part, ProductModel, StockSheet, ZoneRule } from './types'

/**
 * Master: ใบรายงาน STOCK ประจำวันแผนก W/H ASSY ของลูกค้า Royal Enfield แยกตาม Model (คัดลอกจากไฟล์ Excel ของแผนก)
 * part ที่ใช้ร่วมกันหลาย Model (เช่น 150324/A) มีรหัสเดียว แต่โยงกับหลาย Model ผ่าน models[]
 *
 * ข้อมูลในต้นฉบับที่ควรตรวจ (ใส่ตามที่เห็น):
 *  - K1G: ไม่มีแถวที่ 34, แถว 19 TYPE "SPKOE" (แก้เป็น SPOKE)
 *  - J1A: แถว 29 รหัส "RAJ00268/A/A" (มี /A ซ้ำ)
 *  - P4M/P4D: แถว 6 "TYRE FRONT 100/90-90", แถว 8 รหัส "RAt00011/B" (ตัว t เล็ก — เก็บเป็น RAT00011/B)
 */
export const CUSTOMERS: Customer[] = [
  { id: 'RE', name: 'Royal Enfield' },
  // { id: 'TR', name: 'Triumph' }, — เพิ่มเมื่อได้ Master ของลูกค้า
]

/** K1G เบิก MRA ได้ทันที · Model อื่นต้องผ่าน MI3 ก่อน (สมมติฐาน — รอยืนยัน) */
export const MODELS: ProductModel[] = [
  { code: 'K1G', customerId: 'RE', requiresInspection: false },
  ...['J1D', 'J1D4', 'J1A', 'J1C', 'TWIN', 'P4M', 'P4D'].map((code) => ({ code, customerId: 'RE', requiresInspection: true })),
]

type Row = [type: string, partNo: string, description: string]

interface SheetSource {
  id: string
  title: string
  customerId: string
  models: string[]
  rows: Row[]
}

const SHEETS_SOURCE: SheetSource[] = [
  {
    id: 'RE-K1G',
    title: 'ROYAL ENFIELD K1G SPOKE/NIPPLE',
    customerId: 'RE',
    models: ['K1G'],
    rows: [
      ['RIM', 'RAJ00537/B', 'RIM, FRONT, TUBELESS,21X 2.15"'],
      ['RIM', 'RAT00587/B', 'RIM, REAR, TUBELESS, 17" X 3.5"'],
      ['RIM', 'RAJ00995/A', 'RIM, FRONT, TUBELESS,21X 2.15" BLACK'],
      ['RIM', 'RAT1088/A', 'RIM, REAR, TUBELESS, 17" X 3.5" BLACK'],
      ['RIM', 'PK1G0021', 'RIM,FRONT 21x2.15" GOLD'],
      ['RIM', 'PK1G0022', 'RIM,REAR,TL,17x3.5" GOLD'],
      ['RIM', 'RAJ00994/B', 'RIM,FRONT 21x2.15" JF,GOLD'],
      ['RIM', 'RAT01087/B', 'RIM,REAR,TL,17x3.5" JF,GOLD'],
      ['HUB', 'RAJ00536/B', 'HUB, FRONT, TUBELESS, 21X 2.15"'],
      ['HUB', 'RAT00586/B', 'HUB, REAR, TUBELESS, K1G'],
      ['HUB', 'RAJ00875/B', 'HUB, FRONT,TL, 21x2.15, OLIVE'],
      ['HUB', 'RAT00952/A', 'HUB, REAR, TL, K1G, OLIVE'],
      ['BEARING', 'RAJ00239/B', 'BEARING, WHEEL, 6004'],
      ['SPACER', 'RAJ00238/D', 'SPACER, WHEEL, INTERNAL'],
      ['SPACER', 'RAT00282/D', 'SPACER, WHEEL, INTERNAL'],
      ['SEAL', 'RAJ00240/B', 'SEAL, WHEEL, 44, 30'],
      ['SEAL', 'RAT00283/A', 'SEAL, WHEEL, 42, 30'],
      ['SPOKE', 'RAJ00538/B', 'SPOKE, FRONT, TUBELESS,21X 2.15"'],
      ['SPOKE', 'RAT00566/B', 'SPOKE 1, REAR, TUBELESS. 17" X 3.5"'],
      ['SPOKE', 'RAT00567/B', 'SPOKE 2, REAR, TUBELESS. 17" X 3.5"'],
      ['SPOKE', 'RAT00568/B', 'SPOKE 3, REAR, TUBELESS. 17" X 3.5"'],
      ['SPOKE', 'RAT00592/B', 'SPOKE 4, REAR, TUBELESS. 17" X 3.5"'],
      ['NIPPLE', 'RAJ00550/B', 'NIPPLE, SPOKE, LOCKING'],
      ['DISC', 'RAB00587/B', 'BRAKE DISC, SOLID, 320'],
      ['DISC', 'RAB00479/C', 'BRAKE DISC, SOLID, 270'],
      ['TONER', 'RAJ00539/B', 'TONER RING, FRONT'],
      ['TONER', 'RAJ00288/B', 'TONER RING'],
      ['BOLT', 'RAT00467/A', 'BOLT, M8x1.25x 21, SHOULDERED'],
      ['RUBBER', 'RAJ00757/A', 'CUSH RUBBER P4D /K1G'],
      ['VALVE', 'RAT01154/B', 'VALVE, WHEEL, TUBELESS'],
      ['VALVE', 'RAJ00570/B', 'VALVE, WHEEL, TUBELESS'],
      ['TYRE', 'RAJ00301/D', 'TYRE 90/90-21 FRONT'],
      ['TYRE', 'RAT00322/D', 'TYRE 140/80-17 REAR'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
    ],
  },
  {
    id: 'RE-J1D',
    title: 'ROYAL ENFIELD J1D, J1D4 CAST',
    customerId: 'RE',
    models: ['J1D', 'J1D4'],
    rows: [
      ['ALLOY RIM', '1100246/D', 'ALLOY RIM - FRONT - BLACK ALLOY'],
      ['ALLOY RIM', '1100247/D', 'ALLOY RIM REAR - BLACK'],
      ['ALLOY RIM', 'RAJ00176/B', 'ALLOY RIM - FRONT - BLACK/MACHINING'],
      ['ALLOY RIM', 'RAT00199/B', 'ALLOY RIM REAR - BLACK/MACHINING'],
      ['STICKER', 'RAJ00177/C', 'STICKER RIM FRONT - YELLOW'],
      ['STICKER', 'RAT00200/C', 'STICKER RIM - YELLOW'],
      ['STICKER', 'RAJ00178/C', 'STICKER RIM FRONT - RED'],
      ['STICKER', 'RAT00201/C', 'STICKER RIM - RED'],
      ['STICKER', 'RAJ00510/A', 'DECAL 2D STRIPE LAGOON YELLOW'],
      ['STICKER', 'RAT00531/A', 'STICKER - FIREBALL LAGOON YELLOW'],
      ['STICKER', 'RAJ00513/A', 'DECAL 2D STRIPE PINE GREEN'],
      ['STICKER', 'RAT00534/A', 'STICKER RIM - FIREBALL PINE GREEN'],
      ['SPACER', '1100237/C', 'SPACER ASSEMBLY - FRONT HUB'],
      ['SPACER', '146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB'],
      ['SEAL', '141109/1', 'GREASE SEAL 25X40X7'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
      ['DISC', '1100712/D', 'FRONT DISC PLATE'],
      ['DISC', '1100700/D', 'REAR DISC PLATE'],
      ['TONER', '1100713/B', 'TONER-FRONT WHEEL'],
      ['TONER', 'RAT00087/A', 'TONER - REAR WHEEL'],
      ['BOLT', '1100263/E', 'BOLT, M8 x 1.25 x 21, SHOULDERED'],
      ['BOLT', 'RAT00255/A', 'CAP HEAD SHOULDERED-M6X1-20'],
      ['RUBBER', 'RAT00570/A', 'RUBBER CUSHION'],
      ['TYRE', 'RAJ00285/A', 'FRONT TUBELESS TYRE 100/90-19'],
      ['TYRE', 'RAT00315/A', 'REAR TUBELESS TYRE 140/70-17'],
      ['VALVE', '1120064/A', 'VALVE - ALLOY WHEEL'],
      ['STICKER', 'RAT01502/A', '2D DECAL. FRONT &REAR RH YELLOW (J1C)'],
      ['STICKER', 'RAT01352/A', '2D DECAL. FRONT &REAR RH YELLOW (J1C)'],
    ],
  },
  {
    id: 'RE-J1A',
    title: 'ROYAL ENFIELD J1A CAST + SPOKE/NIPPLE',
    customerId: 'RE',
    models: ['J1A'],
    rows: [
      ['ALLOY RIM', 'RAJ00296/A', 'ALLOY RIM, FRONT, MATTE BLACK'],
      ['ALLOY RIM', 'RAT00328/A', 'ALLOY RIM, REAR, MATTE BLACK'],
      ['RIM', '1100351/B', 'FRONT WHEEL RIM 2.15X19" Silver'],
      ['RIM', 'RAT00181/A', 'REAR WHEEL RIM 3.00 X 18" Silver'],
      ['RIM', 'RAJ00182/B', 'FRONT WHEEL RIM 2.15x18"- MATTE BLACK'],
      ['RIM', 'RAT00208/B', 'REAR WHEEL RIM 3.00 X 18" - MATTE BLACK'],
      ['RIM', 'RAT00538/B', 'REAR WHEEL RIM17X3.50 MT SILVER'],
      ['HUB', '1100187/C', 'HUB-FRONT'],
      ['HUB', 'RAT00037/C', 'REAR HUB'],
      ['HUB', 'RAJ00184/B', 'FRONT HUB - BLACK'],
      ['HUB', 'RAT00210/B', 'REAR HUB - BLACK'],
      ['RUBBER', 'RAJ00415/C', 'DAMPER RUBBER, FRONT WHEEL ASSY'],
      ['RIM TAPE', '140355/B', 'RIM TAPE'],
      ['RIM TAPE', '148650/D', 'RIM TAPE TWIN'],
      ['RIM TAPE', '587851/B', 'RIM TAPE'],
      ['TYRE', 'RAJ00285/A', 'FRONT TUBELESS TYRE 100/90-19'],
      ['TYRE', 'RAT00337/A', 'TYRE-REAR 120/80 - 18"'],
      ['TYRE', 'RAT00315/A', 'TYRE-REAR 140/70-17'],
      ['TUBE', 'RAJ00593/A', 'FRONT TUBE 100/90-19'],
      ['TUBE', 'RAT00627/A', 'REAR TUBE 120/80-18"'],
      ['STICKER', 'RAJ00178/C', 'STICKER RIM FRONT - RED'],
      ['STICKER', 'RAT00345/A', 'DECAL 2D - REAR WHEEL STRIPE RE RED'],
      ['STICKER', 'RAJ00313/A', 'DECAL 2D - FRONT WHEEL STRIPE DARK BLUE'],
      ['STICKER', 'RAT00346/A', 'DECAL 2D - REAR WHEEL STRIPE DARK BLUE'],
      ['SPOKE', 'RAJ00575/A', 'SPOKE-FRONT'],
      ['SPOKE', 'RAT00606/A', 'SPOKE -REAR'],
      ['SPOKE', 'RAT00329/A', 'SPOKE -REAR'],
      ['NIPPLE', 'RAJ00298/A', 'NIPPLE'],
      ['TUBE', 'RAJ00268/A/A', 'FRONT TUBE 100/90-19'],
      ['TUBE', '591984/A', 'REAR TUBE 120/80-18"'],
      ['TUBE', 'RAT00322/A', 'REAR TUBE 140/70-17'],
      ['STICKER', 'RAJ01035/A', 'DECAL 2D - FRONT WHEEL RE COPPER(J1A3)'],
      ['STICKER', 'RAT01131/A', 'DECAL 2D - REAR WHEEL RE COPPER (J1A3)'],
      ['SPACER', '1100237/C', 'SPACER ASSEMBLY - FRONT HUB'],
      ['SPACER', '146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB'],
      ['SEAL', '141109/1', 'GREASE SEAL 25X40X7'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
      ['DISC', '1100712/D', 'FRONT DISC PLATE'],
      ['DISC', '1100700/D', 'REAR DISC PLATE'],
      ['TONER', '1100713/B', 'TONER-FRONT WHEEL'],
      ['TONER', 'RAT00087/A', 'TONER - REAR WHEEL'],
      ['BOLT', '1100263/E', 'BOLT, M8 x 1.25 x 21, SHOULDERED'],
      ['BOLT', 'RAT00255/A', 'CAP HEAD SHOULDERED-M6X1-20'],
      ['RUBBER', 'RAT00570/A', 'RUBBER CUSHION'],
      ['VALVE', '1120064/A', 'VALVE - ALLOY WHEEL'],
    ],
  },
  {
    id: 'RE-J1C',
    title: 'ROYAL ENFIELD J1C CAST',
    customerId: 'RE',
    models: ['J1C'],
    rows: [
      ['ALLOY RIM', 'RAJ00024/B', 'ALLOY RIM - 17x1.40 FRONT'],
      ['ALLOY RIM', 'RAT00077/B', 'ALLOY RIM 17x3.00 REAR'],
      ['DISC', 'RAB00728/A', 'REAR DISC PLATE'],
      ['TYRE', 'RAJ00725/A', 'FRONT TUBELESS TYRE 110/70-17'],
      ['TYRE', 'RAT00811/A', 'REAR TUBELESS TYRE 140/70-17'],
      ['STICKER', 'RAJ00372/B', 'DECAL 2D, WHEEL PINSTRIPE, RH'],
      ['STICKER', 'RAJ00373/B', 'DECAL 2D, WHEEL PINSTRIPE, LH'],
      ['STICKER', 'RAJ00497/A', 'DECAL 2D, WHEEL, RH TORQUOISE/WHITE'],
      ['STICKER', 'RAJ00486/A', 'DECAL 2D, WHEEL, LH TORQUOISE/WHITE'],
      ['STICKER', 'RAJ00500/A', 'DECAL 2D, WHEEL, RH SILVER/PAN 102 C'],
      ['STICKER', 'RAJ00489/A', 'DECAL 2D, WHEEL, LH SILVER/PAN 102 C'],
      ['STICKER', 'RAJ00499/A', 'DECAL 2D, WHEEL, RH WHITE/PAN 2935 C'],
      ['STICKER', 'RAJ00488/A', 'DECAL 2D, WHEEL, LH WHITE/PAN 2935 C'],
      ['STICKER', 'RAJ00498/A', 'DECAL 2D, WHEEL, RH RE GOLD/RED'],
      ['STICKER', 'RAJ00487/A', 'DECAL 2D, WHEEL, LH RE GOLD/RED'],
      ['STICKER', 'RAJ00889/A', 'DECAL 2D, WHEEL, WHITE LH. PANTO WHI C.375C'],
      ['STICKER', 'RAJ00890/A', 'DECAL 2D, WHEEL, WHITE RH. PANTO WHI C.375C'],
      ['STICKER', 'RAJ00891/A', 'DECAL 2D, WHEEL, WHITE. LH PANTO WHI.172C'],
      ['STICKER', 'RAJ00892/A', 'DECAL 2D, WHEEL, WHITE RH. PANTO WHI .172 C'],
      ['STICKER', 'RAJ01087/A', 'DECAL 2D, WHEEL, RE LIGHT SAND.RH'],
      ['STICKER', 'RAJ01088/A', 'DECAL 2D, WHEEL, RE LIGHT SAND.LH'],
      ['STICKER', 'RAJ01085/A', 'DECAL 2D, WHEEL, RE MARBLE WHITE.RH'],
      ['STICKER', 'RAJ01086/A', 'DECAL 2D, WHEEL, RE MARBLE WHITE.LH'],
      ['SPACER', '1100237/C', 'SPACER ASSEMBLY - FRONT HUB'],
      ['SPACER', '146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB'],
      ['SEAL', '141109/1', 'GREASE SEAL 25X40X7'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
      ['DISC', '1100712/D', 'FRONT DISC PLATE'],
      ['TONER', '1100713/B', 'TONER-FRONT WHEEL'],
      ['BOLT', '1100263/E', 'BOLT, M8 x 1.25 x 21, SHOULDERED'],
      ['BOLT', 'RAT00467/A', 'BOLT, M8x1.25x 21, SHOULDERED'],
      ['RUBBER', 'RAT00035/C', 'RUBBER CUSHION'],
      ['VALVE', '1120064/A', 'VALVE - ALLOY WHEEL'],
      ['TONER', 'RAT00450/A', 'TONER - REAR WHEEL'],
    ],
  },
  {
    id: 'RE-TWIN',
    title: 'ROYAL ENFIELD TWIN CAST',
    customerId: 'RE',
    models: ['TWIN'],
    rows: [
      ['ALLOY RIM', 'RAJ00669/A', 'FRONT WHEEL CAST BLACK 18x2.5'],
      ['ALLOY RIM', 'RAT00728/A', 'REAR WHEEL CAST BLACK 18x3.5'],
      ['SPACER', '585514/A', 'BEARING SPACER ASSEMBLY - FRONT HUB'],
      ['DISC', 'RAB00076/A', 'BRAKE DISC 320MM'],
      ['DISC', '587395/B', 'REAR DISC PLATE'],
      ['TONER', 'RAB00374/A', 'TONER - FRONT WHEEL - DF30 WSS'],
      ['TONER', '585216/C', 'TONER - REAR WHEEL'],
      ['BOLT', 'H6906002/A', 'HEX HEAD BOLT M8x1.25x30'],
      ['BOLT', '587605/B', 'SOCKET HEAD BOLT M8x1.25x20'],
      ['TYRE', '148543/A', 'TYRE FRONT 100/90-18'],
      ['TYRE', '148544/A', 'TYRE REAR 130/70-18'],
      ['RIM', '148537/A', 'RIM FR. 18X2.50 BLACK'],
      ['RIM', '148532/A', 'RIM RR. 18X3.50 BLACK'],
      ['HUB', '148529/F', 'HUB REAR WHEEL BLACK'],
      ['HUB', 'RAJ00030/A', 'HUB FRONT WHEEL BLACK'],
      ['SPOKE', '148640/A', 'SPOKE. WHEEL'],
      ['SPOKE', 'RAT00259/A', 'SPOKE. REAR WHEEL'],
      ['NIPPLE', '585179/A', 'NR61 NIPPLE 3.6 MM.'],
      ['NIPPLE', '593393/A', 'NIPPLE'],
      ['TUBE', '585304/B', 'NR61 REAR TUBE -130/80-18'],
      ['TUBE', 'RAJ0005/B', 'TUBE TYRE 3X18'],
      ['RIM TAPE', '148650/D', 'RIM TAPE J1A3'],
      ['RIM TAPE', '585328/C', 'RIM TAPE'],
      ['SPACER', '146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB'],
      ['SEAL', '141109/1', 'GREASE SEAL 25X40X7'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
      ['RUBBER', 'RAT00035/C', 'RUBBER CUSHION'],
      ['VALVE', '1120064/A', 'VALVE - ALLOY WHEEL'],
    ],
  },
  {
    id: 'RE-P4',
    title: 'ROYAL ENFIELD P4M & P4D',
    customerId: 'RE',
    models: ['P4M', 'P4D'],
    rows: [
      ['CAST', '1050171', 'RIM - FRONT WHEEL,CAST 19x2.50'],
      ['SPACER', 'RAJ00009/B', 'SPACER ASSEMBLY - FRONT HUB'],
      ['SEAL', '141109/1', 'GREASE SEAL 25X40X7'],
      ['DISC', 'RAB00009/B', 'BRAKE DISC FRONT'],
      ['BOLT', 'H6906048/A', 'BOLT,BUT.SHLD M8x30.10.9.wht.l'],
      ['TYRE', 'RAJ00058/B', 'TYRE FRONT 100/90-90'],
      ['CAST', '1050172/F', 'RIM REAR WHEEL .CAST.E16x3.50'],
      ['SPACER', 'RAT00011/B', 'SPACER INTERAL.REAR WHEEL'],
      ['DISC', 'RAB00012/B', 'BRAKE DISC REAR'],
      ['TONER', 'RAB00013/B', 'ABS TONER RING.REAR WHEEL'],
      ['RUBBER', 'RAT00007/D', 'CUSH RUBBER'],
      ['TYRE', 'RAT00067/G', 'TYRE REAR TUBELESS 150/80-16'],
      ['TYRE', 'RAT00068/B', 'TYRE REAR 150/70-17'],
      ['TYRE', 'RAJ00057/B', 'TYRE FRONT 100/90-18'],
      ['CAST', 'RAJ00008/H', 'RIM - FRONT WHEEL,CAST 18x2.50'],
      ['CAST', 'RAT00010/G', 'RIM REAR WHEEL .CAST.E17x4.25'],
      ['BEARING', '150324/A', 'WHEEL BEARING 6203 (17x40x12)'],
      ['TONER', '1100713/B', 'TONER-FRONT WHEEL'],
      ['VALVE', '1120064/A', 'VALVE - ALLOY WHEEL'],
      ['HUB', 'RAJ00481/D', 'HUB FRONT WHEEL'],
      ['HUB', 'RAT00507/E', 'HUB REAR WHEEL'],
      ['RIM', 'RAJ00482/C', 'RIM FRONT WHEEL 19x2.50'],
      ['RIM', 'RAT00508/C', 'RIM REAR WHEEL 18x4.00'],
      ['SPOKE', 'RAJ00483/B', 'SPOKE FRONT WHEEL'],
      ['TYRE', 'RAJ00592/B', 'TYRE FRONT 100/90-19'],
      ['NIPPLE', 'RAT00165/C', 'NIPPLE SPOKE'],
      ['SPOKE', 'RAT00509/B', 'SPOKE REAR WHEEL'],
      ['TYRE', 'RAT00624/B', 'TYRE FRONT 140/70-R18'],
      ['TUBE', 'RAT00849/A', 'TUBE FRONT 140/70-R19'],
      ['RIM TAPE', 'RAT01069/A', 'RIM TAPE REAR'],
    ],
  },
]

/** ใบรายงานแยกตาม Model (ลำดับแถวตามแบบฟอร์มเดิม) */
export const STOCK_SHEETS: StockSheet[] = SHEETS_SOURCE.map(({ rows, ...sheet }) => ({ ...sheet, partNos: rows.map((r) => r[1]) }))

/** รวม part จากทุกใบรายงาน: รหัสเดียวกันเป็น part เดียว และรวม Model ที่ใช้ */
function buildParts(sources: SheetSource[]): Part[] {
  const byNo = new Map<string, Part>()
  for (const sheet of sources)
    for (const [type, partNo, description] of sheet.rows) {
      const existing = byNo.get(partNo)
      if (existing) existing.models = [...new Set([...existing.models, ...sheet.models])]
      else byNo.set(partNo, { partNo, type, description, customerId: sheet.customerId, models: [...sheet.models] })
    }
  return [...byNo.values()]
}

export const PARTS: Part[] = buildParts(SHEETS_SOURCE)

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
  // ยางเก็บที่เต็นท์ยางหลังเต็นท์ B/D เป็นหลัก (ยืนยันจากเจ้าของ)
  { customerId: 'RE', type: 'TYRE', zoneId: 'TENT-T' },
  { customerId: 'RE', type: 'TUBE', zoneId: 'TENT-T' },
  { customerId: 'RE', type: 'ALLOY RIM', zoneId: 'F1-RK-C' },
  { customerId: 'RE', type: 'CAST', zoneId: 'F1-RK-C' },
  { customerId: 'RE', type: 'STICKER', zoneId: 'F2-RK-D' },
  { customerId: 'RE', type: 'RIM TAPE', zoneId: 'F2-RK-D' },
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
  j1a: {
    invoiceNo: 'RE-INV-2610-0171',
    invoiceDate: '2026-10-14',
    supplier: 'Royal Enfield (ตัวอย่าง)',
    model: 'J1A',
    lines: [
      { partNo: 'RAJ00296/A', description: 'ALLOY RIM, FRONT, MATTE BLACK', qty: 120 },
      { partNo: 'RAT00328/A', description: 'ALLOY RIM, REAR, MATTE BLACK', qty: 120 },
      { partNo: 'RAJ00575/A', description: 'SPOKE-FRONT', qty: 4320 },
      { partNo: 'RAJ0O298/A', description: 'NIPPLE', qty: 8640 },
      { partNo: '141109/1', description: 'GREASE SEAL 25X40X7', qty: 240 },
      { partNo: '150324/A', description: 'WHEEL BEARING 6203', qty: 240 },
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
