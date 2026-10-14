# YA Inventory Management — 3D Visualization

ระบบจัดการสินค้าและคลังรับเข้าของ **Union Autoparts Manufacturing** พร้อมผังโรงงานแบบ 3D
(อาคาร 3 ชั้น + ลานนอกอาคารที่มีเต็นท์ 2 หลัง) และเครื่องมือ **วิเคราะห์ระยะเดิน** ที่พนักงานใช้เบิก part
ไปส่งไลน์ประกอบวงล้อชั้น 2 และชั้น 3

> สถานะ: **เฟส 0 — โครงร่าง** ผังโรงงานยังเป็นค่าสมมติ ดูหัวข้อที่ต้องเก็บข้อมูลได้ที่ [docs/requirements.md](docs/requirements.md)

![ผังโรงงาน 3D และเส้นทางเดิน](docs/screenshot.png)

## Tech Stack

| ส่วน | เทคโนโลยี |
|---|---|
| UI | React 19 + TypeScript + Vite + Tailwind CSS |
| 3D | Three.js ผ่าน React Three Fiber + drei |
| Database / Auth / Realtime | Supabase (Postgres) |
| Test | Vitest |

## เริ่มต้นใช้งาน

```bash
cd web
npm install
npm run dev        # เปิด http://localhost:5173
npm test           # ทดสอบการคำนวณเส้นทาง
npm run build
```

ถ้าไม่ได้ตั้งค่า Supabase แอปจะใช้ผังตัวอย่างจาก `web/src/data/factoryLayout.ts`

### เชื่อมต่อ Supabase

1. สร้างโปรเจกต์ใน [supabase.com](https://supabase.com)
2. รัน `supabase/migrations/0001_init.sql` แล้วตามด้วย `supabase/seed.sql` (ใช้ SQL Editor หรือ `supabase db push`)
3. คัดลอก `web/.env.example` เป็น `web/.env.local` แล้วใส่ URL และ anon key ของโปรเจกต์

ถ้าแก้ผังใน `factoryLayout.ts` ให้รัน `npm run seed:generate` เพื่อสร้าง `seed.sql` ใหม่

## ฟีเจอร์ตอนนี้

- ผังโรงงาน 3D: หมุน/ซูมได้, เลือกซ่อนหรือแสดงทีละชั้น, ปรับระยะห่างระหว่างชั้นได้
- คลิก rack/เต็นท์ เพื่อเลือกต้นทาง และคลิกไลน์ประกอบเพื่อเลือกปลายทาง ระบบจะวาดเส้นทางเดินให้
- คำนวณระยะเดิน, เวลา, ระยะเดินบนบันได, จำนวนครั้งที่ใช้ลิฟต์ และระยะเดินรวมต่อวัน
- จัดอันดับทุกจุดเก็บตามระยะห่างจากไลน์ประกอบ เพื่อช่วยตัดสินใจว่าควรย้าย part ไปไว้ที่ไหน
- Schema ฐานข้อมูล: part, location, stock, ใบรับเข้า, movement ledger และ `post_receipt()` สำหรับยืนยันใบรับเข้า

## เอกสาร

- [docs/requirements.md](docs/requirements.md) — แบบฟอร์มเก็บ requirement และแผนแบ่งเฟส
- [docs/architecture.md](docs/architecture.md) — สถาปัตยกรรม, เหตุผลที่เลือก Supabase, วิธีคำนวณระยะเดิน และข้อเสนอแนะ
