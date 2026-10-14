# กระบวนการรับเข้าและบริหารสต็อก (ร่างออกแบบ)

> ลูกค้าตัวอย่าง: Royal Enfield — Model K1G (SPOKE/NIPPLE) · แผนก W/H ASSY
> สถานะ: **Demo** — อ่าน invoice แบบจำลอง ข้อมูลเก็บในเบราว์เซอร์ · กฎทั้งหมดมีใน Supabase แล้ว (`0003_inventory_flow.sql`)

## 1. ภาพรวม

```
รถส่งของ ─► ถ่ายภาพ Invoice ─► AI (Qwen-VL) อ่านรายการ ─► เทียบ Part Master ─► แนะนำโซน (ลูกค้า + กลุ่มสินค้า)
                                                                              │
                                           ทีมรับเข้านับของจริง ◄────────────────┘
               ยอดดี ─► BOI (Actual Receive) · ของเสียหาย ─► NG ส่งคืน Supplier · ขาด/เกิน ─► รายงานความต่าง
                                │
          ┌──── K1G ────────────┴──────────── Model อื่น (J1D, J1A, J1C, TWIN, P4D) ────┐
          ▼                                                                             ▼
     MRA เบิกเข้าไลน์                                     ส่งตรวจ MI3 ─► ดี ─► กลับ BOI ─► MRA เบิก
          │                                                          └─► NG ─► NG ลูกค้า / Supplier
          └─► เจอ NG ในกระบวนการ ─► NG รอส่งคืนลูกค้า / NG ส่งคืน Supplier ─► ส่งคืน (ย้อนไปหา lot/invoice ได้)
```

## 2. สถานะของสต็อก (bucket) เทียบกับใบรายงาน STOCK เดิม

| Bucket | ความหมาย | คอลัมน์ในฟอร์มเดิม |
|---|---|---|
| (ยอดตามเอกสาร) | จำนวนตาม invoice | Income · รับตาม Invoice |
| `BOI` | คลังของดี พร้อมเบิก | Inprocess · Actual Receive |
| `MI3` | อยู่ระหว่างตรวจคุณภาพ | *(คอลัมน์ใหม่ QC)* |
| `MRA` | เบิกเข้าไลน์แล้ว | Inprocess · MRA เบิก |
| `NG_CUSTOMER` | NG รอส่งคืนลูกค้า | Return · NG รอส่งคืนลูกค้า |
| `NG_SUPPLIER` | NG ส่งคืน Supplier | Return · NG ส่งคืน Supplier |
| `RETURNED` | ส่งคืนออกไปแล้ว | — |

**Balance ±** = ของที่อยู่ในคลังจริง = BOI + MI3 ณ สิ้นวัน *(สมมติฐาน — รอยืนยันสูตรจากหน้างาน)*

ทุกการเปลี่ยนสถานะบันทึกเป็น **movement** ผูกกับ **lot** (1 lot = 1 บรรทัดใน invoice) ตัวเลขในใบรายงานจึงคำนวณจาก movement ทั้งหมด ไม่มีการกรอกยอดทับ

## 3. กฎที่ระบบบังคับ

| กฎ | ที่บังคับ |
|---|---|
| Invoice เดิมรับซ้ำไม่ได้ | demo + `inbound_receipts.receipt_no unique` |
| ของเสียหายต้องไม่เกินยอดที่นับได้ | demo + constraint `damaged_within_counted` |
| ย้ายออกจาก bucket ได้ไม่เกินยอดคงเหลือของ lot นั้น | demo + `move_lot()` |
| Model ที่ `requires_inspection` เบิก MRA ได้เฉพาะยอดที่ผ่าน MI3 แล้ว | demo + `move_lot()` |
| NG ต้องเลือกว่าไปลูกค้าหรือ Supplier, ส่งคืนได้เฉพาะของที่อยู่ใน NG | demo + `move_lot()` |
| บันทึกพร้อมกันจากหลายเครื่องจนยอดติดลบไม่ได้ | `move_lot()` ล็อก lot ระหว่างบันทึก |
| ผลอ่านจาก AI ต้องมีคนยืนยันก่อนรับเข้า | demo (รหัสที่ระบบแก้ต้องติ๊กยืนยัน, ไม่พบใน Master ต้องเลือก part) |

## 4. การอ่าน invoice ด้วย AI

1. พนักงานถ่ายภาพด้วยมือถือ → อัปโหลดเข้า Supabase Storage (เก็บเป็นหลักฐาน)
2. หน้าเว็บเรียก Edge Function `extract-invoice` → เรียก Qwen-VL ด้วย API key ที่เก็บเป็น secret ฝั่ง server
3. ระบบเทียบรหัสกับ Part Master: แก้ตัวอักษรที่ OCR สับสนบ่อย (O↔0, I/L↔1) และหาค่าที่ใกล้ที่สุด
4. พนักงานยืนยัน → ระบบเก็บผลดิบจาก AI ไว้ใน `inbound_receipts.extraction` เพื่อตรวจย้อนหลัง

สถานะการติดตั้ง (14 ต.ค. 2026):
- โปรเจกต์ Supabase: `lgjuokwwsjpicqljimpq` (เดิมชื่อ UAM Incoming Inspection — ใช้ร่วมกับตารางของระบบตรวจรับเดิม ชื่อตารางไม่ชนกัน)
- ติดตั้ง migration 0001–0003 และข้อมูล seed แล้ว · deploy function `extract-invoice` แล้ว (verify_jwt เปิดอยู่)
- **รอ**: ตั้ง secret `QWEN_API_KEY` ใน Dashboard → Edge Functions → Secrets

ขั้นตอนเปิดใช้ Qwen จริง:
1. สมัคร Alibaba Cloud Model Studio (DashScope) แล้วสร้าง API key
2. `supabase secrets set QWEN_API_KEY=<key>` (ห้ามส่ง key ในแชทหรือใส่ในโค้ด)
3. `supabase functions deploy extract-invoice`
4. สลับ `mockInvoiceReader` เป็นตัวที่เรียก Edge Function (`web/src/inventory/extraction.ts`)
5. ทดสอบกับภาพ invoice จริง 10–20 ใบ วัดความแม่นก่อนใช้งานจริง

## 5. กฎแนะนำโซน (ร่าง — รอยืนยัน)

ลูกค้า Royal Enfield: RIM → Rack C · HUB/DISC/TONER → Rack B · SPOKE/NIPPLE/BOLT → Rack A ·
BEARING/SPACER/SEAL/VALVE/RUBBER → Rack E (ชั้น 2) · TYRE → เต็นท์ C · อื่น ๆ → เต็นท์ D

## 6. หลาย Model, Dashboard และ Movement

- **Master**: ใบรายงาน 6 ชุดของ Royal Enfield (K1G, J1D/J1D4, J1A, J1C, TWIN, P4M/P4D) รวม 164 part ไม่ซ้ำ
  part ที่ใช้ร่วมหลาย Model (เช่น 150324/A, 141109/1, 1120064/A) มีรหัสเดียว และโยงกับหลาย Model
- **ยอดแยกตาม Model**: lot เก็บ Model ของ invoice ใบรายงานแต่ละชุดจึงนับเฉพาะ invoice ของ Model นั้น
  ส่วนมุมมอง "Part ใช้ร่วม" รวมยอดทุก Model ของ part เดียวกันไว้ในแถวเดียว
- **Dashboard**: ตัวเลขของวัน (รับเข้า, เบิก, รอตรวจ, NG, ขาด/เสียหาย, คงคลัง), กราฟรายชั่วโมง, สรุปแยก Model และความเคลื่อนไหวล่าสุด
- **Movement**: ทุกรายการมีเวลา ผู้บันทึก จาก→ไป และ tag กลับไปหา lot → invoice → Model ค้นหา/กรองได้
- **โซนจัดเก็บ**: ตอนรับเข้าระบบแนะนำโซน และพนักงานเปลี่ยนเองได้ · คลิกโซนบนผัง 3D แล้วเห็นของในโซนแยกตาม Model
- **Realtime (demo)**: เปิดหลายแท็บแล้วเห็นรายการใหม่ทันที · ระบบจริงจะใช้ Supabase Realtime ให้ทุกเครื่องเห็นพร้อมกัน

## 7. คำถามที่ต้องยืนยัน

- [ ] สูตร Balance ± ในฟอร์มเดิมคิดอย่างไร (ตอนนี้ใช้ BOI + MI3)
- [ ] ของเสียหายตอนรับเข้า ส่งคืน Supplier เสมอ หรือบางครั้งคืนลูกค้า
- [ ] MI3 ตรวจทั้ง lot หรือสุ่มตรวจ (ถ้าสุ่ม ยอดที่ไม่ได้สุ่มเบิกได้หรือไม่)
- [ ] K1G ต้องตรวจ MI3 บ้างหรือไม่ (ตอนนี้เบิกตรงได้ แต่ส่งตรวจได้ถ้าต้องการ)
- [ ] เลข Lot ของ Supplier มีพิมพ์บน invoice/กล่องหรือไม่ (ถ้ามี ควรเก็บเพิ่มจากเลข invoice)
- [ ] หน่วยนับ (ชิ้น / ชุด / กล่อง) และ part ที่ต้องแปลงหน่วย
- [ ] ตัวอย่างภาพ invoice จริง 3–5 ใบ สำหรับทดสอบ Qwen
- [ ] แถวที่ 34 ในใบรายงานเดิมหายไป และแถว 19 พิมพ์ TYPE ว่า "SPKOE" — ยืนยันข้อมูล Master
- [ ] J1A แถว 29 รหัส `RAJ00268/A/A`, P4 แถว 6 `TYRE FRONT 100/90-90`, P4 แถว 8 `RAt00011/B` — ยืนยันรหัส/คำอธิบาย
- [ ] Part ใช้ร่วม (เช่น 150324/A): สต็อกเป็นกองกลาง หรือแยกตาม Model ตาม invoice (ตอนนี้แยกตาม Model)
- [ ] ทุก Model ยกเว้น K1G ต้องผ่าน MI3 ก่อนเบิก ถูกต้องหรือไม่
