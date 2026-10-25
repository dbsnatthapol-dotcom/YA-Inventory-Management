-- 0026: D1 จากการตรวจระบบ (docs/known-issues.md) · ไม่ลบข้อมูล ไม่ลบนโยบาย
--   ผู้จัดการ/ผู้ดูแลเคยแก้ตารางข้อมูลหลักตรง ๆ ได้ (นโยบายเขียนตรงจาก 0005) แม้ถูกถอนสิทธิ์ "แก้ข้อมูลหลัก"
--   เช่น เปลี่ยน NG-HOLD เป็นช่องปกติ หรือปิดการตรวจ MI3 ของ Model
--   หน้าเว็บแก้ผ่านคำสั่งที่ตรวจสิทธิ์อยู่แล้ว (master_save_part / master_upsert_location / master_set_zone_rule …)
--   ⇒ ถอนสิทธิ์เขียนตารางตรงจากบัญชีหน้าเว็บ · อ่านได้เหมือนเดิม · คำสั่งที่ตรวจสิทธิ์ยังเขียนได้ (รันด้วยสิทธิ์เจ้าของ)
revoke insert, update, delete on public.customers, public.locations, public.part_models, public.parts, public.product_models, public.suppliers, public.zone_rules
  from anon, authenticated;
