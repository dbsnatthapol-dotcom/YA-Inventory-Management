-- โซนประเภทใหม่สำหรับผังที่แก้ไขได้: พื้นที่ตรวจ MI3, พื้นที่กัก NG, ที่ชาร์จรถยก/พาเลทเปล่า
alter table zones drop constraint if exists zones_kind_check;
alter table zones add constraint zones_kind_check
  check (kind in ('storage', 'receiving', 'assembly', 'tent', 'stairs', 'lift', 'inspection', 'ng', 'utility'));
