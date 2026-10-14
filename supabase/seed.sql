-- สร้างอัตโนมัติจาก web/src/data/factoryLayout.ts — อย่าแก้ไขด้วยมือ
insert into public.floors (id, name, level, elevation, area, x, z, rotation, width, depth) values
  ('F1', 'อาคาร A ชั้น 1', 1, 0, 'building', 100, 19, 12, 62, 98),
  ('F2', 'อาคาร A ชั้น 2', 2, 4.5, 'building', 100, 19, 12, 62, 98),
  ('F3', 'อาคาร A ชั้น 3', 3, 9, 'building', 100, 19, 12, 62, 98),
  ('YARD', 'ลานนอกอาคาร', 1, 0, 'yard', 0, 0, 0, 225, 165);

insert into public.nav_nodes (id, floor_id, x, z) values
  ('F1-r0c0', 'F1', 6, 8),
  ('F1-r0c1', 'F1', 18, 8),
  ('F1-r0c2', 'F1', 31, 8),
  ('F1-r0c3', 'F1', 44, 8),
  ('F1-r0c4', 'F1', 56, 8),
  ('F1-r1c0', 'F1', 6, 26),
  ('F1-r1c1', 'F1', 18, 26),
  ('F1-r1c2', 'F1', 31, 26),
  ('F1-r1c3', 'F1', 44, 26),
  ('F1-r1c4', 'F1', 56, 26),
  ('F1-r2c0', 'F1', 6, 44),
  ('F1-r2c1', 'F1', 18, 44),
  ('F1-r2c2', 'F1', 31, 44),
  ('F1-r2c3', 'F1', 44, 44),
  ('F1-r2c4', 'F1', 56, 44),
  ('F1-r3c0', 'F1', 6, 62),
  ('F1-r3c1', 'F1', 18, 62),
  ('F1-r3c2', 'F1', 31, 62),
  ('F1-r3c3', 'F1', 44, 62),
  ('F1-r3c4', 'F1', 56, 62),
  ('F1-r4c0', 'F1', 6, 80),
  ('F1-r4c1', 'F1', 18, 80),
  ('F1-r4c2', 'F1', 31, 80),
  ('F1-r4c3', 'F1', 44, 80),
  ('F1-r4c4', 'F1', 56, 80),
  ('F1-r5c0', 'F1', 6, 92),
  ('F1-r5c1', 'F1', 18, 92),
  ('F1-r5c2', 'F1', 31, 92),
  ('F1-r5c3', 'F1', 44, 92),
  ('F1-r5c4', 'F1', 56, 92),
  ('F1-ST', 'F1', 2, 92),
  ('F1-LF', 'F1', 59, 44),
  ('F2-r0c0', 'F2', 6, 8),
  ('F2-r0c1', 'F2', 18, 8),
  ('F2-r0c2', 'F2', 31, 8),
  ('F2-r0c3', 'F2', 44, 8),
  ('F2-r0c4', 'F2', 56, 8),
  ('F2-r1c0', 'F2', 6, 26),
  ('F2-r1c1', 'F2', 18, 26),
  ('F2-r1c2', 'F2', 31, 26),
  ('F2-r1c3', 'F2', 44, 26),
  ('F2-r1c4', 'F2', 56, 26),
  ('F2-r2c0', 'F2', 6, 44),
  ('F2-r2c1', 'F2', 18, 44),
  ('F2-r2c2', 'F2', 31, 44),
  ('F2-r2c3', 'F2', 44, 44),
  ('F2-r2c4', 'F2', 56, 44),
  ('F2-r3c0', 'F2', 6, 62),
  ('F2-r3c1', 'F2', 18, 62),
  ('F2-r3c2', 'F2', 31, 62),
  ('F2-r3c3', 'F2', 44, 62),
  ('F2-r3c4', 'F2', 56, 62),
  ('F2-r4c0', 'F2', 6, 80),
  ('F2-r4c1', 'F2', 18, 80),
  ('F2-r4c2', 'F2', 31, 80),
  ('F2-r4c3', 'F2', 44, 80),
  ('F2-r4c4', 'F2', 56, 80),
  ('F2-r5c0', 'F2', 6, 92),
  ('F2-r5c1', 'F2', 18, 92),
  ('F2-r5c2', 'F2', 31, 92),
  ('F2-r5c3', 'F2', 44, 92),
  ('F2-r5c4', 'F2', 56, 92),
  ('F2-ST', 'F2', 2, 92),
  ('F2-LF', 'F2', 59, 44),
  ('F3-r0c0', 'F3', 6, 8),
  ('F3-r0c1', 'F3', 18, 8),
  ('F3-r0c2', 'F3', 31, 8),
  ('F3-r0c3', 'F3', 44, 8),
  ('F3-r0c4', 'F3', 56, 8),
  ('F3-r1c0', 'F3', 6, 26),
  ('F3-r1c1', 'F3', 18, 26),
  ('F3-r1c2', 'F3', 31, 26),
  ('F3-r1c3', 'F3', 44, 26),
  ('F3-r1c4', 'F3', 56, 26),
  ('F3-r2c0', 'F3', 6, 44),
  ('F3-r2c1', 'F3', 18, 44),
  ('F3-r2c2', 'F3', 31, 44),
  ('F3-r2c3', 'F3', 44, 44),
  ('F3-r2c4', 'F3', 56, 44),
  ('F3-r3c0', 'F3', 6, 62),
  ('F3-r3c1', 'F3', 18, 62),
  ('F3-r3c2', 'F3', 31, 62),
  ('F3-r3c3', 'F3', 44, 62),
  ('F3-r3c4', 'F3', 56, 62),
  ('F3-r4c0', 'F3', 6, 80),
  ('F3-r4c1', 'F3', 18, 80),
  ('F3-r4c2', 'F3', 31, 80),
  ('F3-r4c3', 'F3', 44, 80),
  ('F3-r4c4', 'F3', 56, 80),
  ('F3-r5c0', 'F3', 6, 92),
  ('F3-r5c1', 'F3', 18, 92),
  ('F3-r5c2', 'F3', 31, 92),
  ('F3-r5c3', 'F3', 44, 92),
  ('F3-r5c4', 'F3', 56, 92),
  ('F3-ST', 'F3', 2, 92),
  ('F3-LF', 'F3', 59, 44),
  ('F1-DOOR', 'F1', 8, 98),
  ('Y-B', 'YARD', 62, 51),
  ('Y-C', 'YARD', 58, 64),
  ('Y-D', 'YARD', 76.5, 66),
  ('Y-J1', 'YARD', 63, 72),
  ('Y-J2', 'YARD', 83, 80),
  ('Y-J3', 'YARD', 83, 113);

insert into public.nav_edges (from_node_id, to_node_id, mode) values
  ('F1-r0c0', 'F1-r0c1', 'walk'),
  ('F1-r0c1', 'F1-r0c2', 'walk'),
  ('F1-r0c2', 'F1-r0c3', 'walk'),
  ('F1-r0c3', 'F1-r0c4', 'walk'),
  ('F1-r0c0', 'F1-r1c0', 'walk'),
  ('F1-r1c0', 'F1-r1c1', 'walk'),
  ('F1-r0c1', 'F1-r1c1', 'walk'),
  ('F1-r1c1', 'F1-r1c2', 'walk'),
  ('F1-r0c2', 'F1-r1c2', 'walk'),
  ('F1-r1c2', 'F1-r1c3', 'walk'),
  ('F1-r0c3', 'F1-r1c3', 'walk'),
  ('F1-r1c3', 'F1-r1c4', 'walk'),
  ('F1-r0c4', 'F1-r1c4', 'walk'),
  ('F1-r1c0', 'F1-r2c0', 'walk'),
  ('F1-r2c0', 'F1-r2c1', 'walk'),
  ('F1-r1c1', 'F1-r2c1', 'walk'),
  ('F1-r2c1', 'F1-r2c2', 'walk'),
  ('F1-r1c2', 'F1-r2c2', 'walk'),
  ('F1-r2c2', 'F1-r2c3', 'walk'),
  ('F1-r1c3', 'F1-r2c3', 'walk'),
  ('F1-r2c3', 'F1-r2c4', 'walk'),
  ('F1-r1c4', 'F1-r2c4', 'walk'),
  ('F1-r2c0', 'F1-r3c0', 'walk'),
  ('F1-r3c0', 'F1-r3c1', 'walk'),
  ('F1-r2c1', 'F1-r3c1', 'walk'),
  ('F1-r3c1', 'F1-r3c2', 'walk'),
  ('F1-r2c2', 'F1-r3c2', 'walk'),
  ('F1-r3c2', 'F1-r3c3', 'walk'),
  ('F1-r2c3', 'F1-r3c3', 'walk'),
  ('F1-r3c3', 'F1-r3c4', 'walk'),
  ('F1-r2c4', 'F1-r3c4', 'walk'),
  ('F1-r3c0', 'F1-r4c0', 'walk'),
  ('F1-r4c0', 'F1-r4c1', 'walk'),
  ('F1-r3c1', 'F1-r4c1', 'walk'),
  ('F1-r4c1', 'F1-r4c2', 'walk'),
  ('F1-r3c2', 'F1-r4c2', 'walk'),
  ('F1-r4c2', 'F1-r4c3', 'walk'),
  ('F1-r3c3', 'F1-r4c3', 'walk'),
  ('F1-r4c3', 'F1-r4c4', 'walk'),
  ('F1-r3c4', 'F1-r4c4', 'walk'),
  ('F1-r4c0', 'F1-r5c0', 'walk'),
  ('F1-r5c0', 'F1-r5c1', 'walk'),
  ('F1-r4c1', 'F1-r5c1', 'walk'),
  ('F1-r5c1', 'F1-r5c2', 'walk'),
  ('F1-r4c2', 'F1-r5c2', 'walk'),
  ('F1-r5c2', 'F1-r5c3', 'walk'),
  ('F1-r4c3', 'F1-r5c3', 'walk'),
  ('F1-r5c3', 'F1-r5c4', 'walk'),
  ('F1-r4c4', 'F1-r5c4', 'walk'),
  ('F1-ST', 'F1-r5c0', 'walk'),
  ('F1-LF', 'F1-r2c4', 'walk'),
  ('F2-r0c0', 'F2-r0c1', 'walk'),
  ('F2-r0c1', 'F2-r0c2', 'walk'),
  ('F2-r0c2', 'F2-r0c3', 'walk'),
  ('F2-r0c3', 'F2-r0c4', 'walk'),
  ('F2-r0c0', 'F2-r1c0', 'walk'),
  ('F2-r1c0', 'F2-r1c1', 'walk'),
  ('F2-r0c1', 'F2-r1c1', 'walk'),
  ('F2-r1c1', 'F2-r1c2', 'walk'),
  ('F2-r0c2', 'F2-r1c2', 'walk'),
  ('F2-r1c2', 'F2-r1c3', 'walk'),
  ('F2-r0c3', 'F2-r1c3', 'walk'),
  ('F2-r1c3', 'F2-r1c4', 'walk'),
  ('F2-r0c4', 'F2-r1c4', 'walk'),
  ('F2-r1c0', 'F2-r2c0', 'walk'),
  ('F2-r2c0', 'F2-r2c1', 'walk'),
  ('F2-r1c1', 'F2-r2c1', 'walk'),
  ('F2-r2c1', 'F2-r2c2', 'walk'),
  ('F2-r1c2', 'F2-r2c2', 'walk'),
  ('F2-r2c2', 'F2-r2c3', 'walk'),
  ('F2-r1c3', 'F2-r2c3', 'walk'),
  ('F2-r2c3', 'F2-r2c4', 'walk'),
  ('F2-r1c4', 'F2-r2c4', 'walk'),
  ('F2-r2c0', 'F2-r3c0', 'walk'),
  ('F2-r3c0', 'F2-r3c1', 'walk'),
  ('F2-r2c1', 'F2-r3c1', 'walk'),
  ('F2-r3c1', 'F2-r3c2', 'walk'),
  ('F2-r2c2', 'F2-r3c2', 'walk'),
  ('F2-r3c2', 'F2-r3c3', 'walk'),
  ('F2-r2c3', 'F2-r3c3', 'walk'),
  ('F2-r3c3', 'F2-r3c4', 'walk'),
  ('F2-r2c4', 'F2-r3c4', 'walk'),
  ('F2-r3c0', 'F2-r4c0', 'walk'),
  ('F2-r4c0', 'F2-r4c1', 'walk'),
  ('F2-r3c1', 'F2-r4c1', 'walk'),
  ('F2-r4c1', 'F2-r4c2', 'walk'),
  ('F2-r3c2', 'F2-r4c2', 'walk'),
  ('F2-r4c2', 'F2-r4c3', 'walk'),
  ('F2-r3c3', 'F2-r4c3', 'walk'),
  ('F2-r4c3', 'F2-r4c4', 'walk'),
  ('F2-r3c4', 'F2-r4c4', 'walk'),
  ('F2-r4c0', 'F2-r5c0', 'walk'),
  ('F2-r5c0', 'F2-r5c1', 'walk'),
  ('F2-r4c1', 'F2-r5c1', 'walk'),
  ('F2-r5c1', 'F2-r5c2', 'walk'),
  ('F2-r4c2', 'F2-r5c2', 'walk'),
  ('F2-r5c2', 'F2-r5c3', 'walk'),
  ('F2-r4c3', 'F2-r5c3', 'walk'),
  ('F2-r5c3', 'F2-r5c4', 'walk'),
  ('F2-r4c4', 'F2-r5c4', 'walk'),
  ('F2-ST', 'F2-r5c0', 'walk'),
  ('F2-LF', 'F2-r2c4', 'walk'),
  ('F3-r0c0', 'F3-r0c1', 'walk'),
  ('F3-r0c1', 'F3-r0c2', 'walk'),
  ('F3-r0c2', 'F3-r0c3', 'walk'),
  ('F3-r0c3', 'F3-r0c4', 'walk'),
  ('F3-r0c0', 'F3-r1c0', 'walk'),
  ('F3-r1c0', 'F3-r1c1', 'walk'),
  ('F3-r0c1', 'F3-r1c1', 'walk'),
  ('F3-r1c1', 'F3-r1c2', 'walk'),
  ('F3-r0c2', 'F3-r1c2', 'walk'),
  ('F3-r1c2', 'F3-r1c3', 'walk'),
  ('F3-r0c3', 'F3-r1c3', 'walk'),
  ('F3-r1c3', 'F3-r1c4', 'walk'),
  ('F3-r0c4', 'F3-r1c4', 'walk'),
  ('F3-r1c0', 'F3-r2c0', 'walk'),
  ('F3-r2c0', 'F3-r2c1', 'walk'),
  ('F3-r1c1', 'F3-r2c1', 'walk'),
  ('F3-r2c1', 'F3-r2c2', 'walk'),
  ('F3-r1c2', 'F3-r2c2', 'walk'),
  ('F3-r2c2', 'F3-r2c3', 'walk'),
  ('F3-r1c3', 'F3-r2c3', 'walk'),
  ('F3-r2c3', 'F3-r2c4', 'walk'),
  ('F3-r1c4', 'F3-r2c4', 'walk'),
  ('F3-r2c0', 'F3-r3c0', 'walk'),
  ('F3-r3c0', 'F3-r3c1', 'walk'),
  ('F3-r2c1', 'F3-r3c1', 'walk'),
  ('F3-r3c1', 'F3-r3c2', 'walk'),
  ('F3-r2c2', 'F3-r3c2', 'walk'),
  ('F3-r3c2', 'F3-r3c3', 'walk'),
  ('F3-r2c3', 'F3-r3c3', 'walk'),
  ('F3-r3c3', 'F3-r3c4', 'walk'),
  ('F3-r2c4', 'F3-r3c4', 'walk'),
  ('F3-r3c0', 'F3-r4c0', 'walk'),
  ('F3-r4c0', 'F3-r4c1', 'walk'),
  ('F3-r3c1', 'F3-r4c1', 'walk'),
  ('F3-r4c1', 'F3-r4c2', 'walk'),
  ('F3-r3c2', 'F3-r4c2', 'walk'),
  ('F3-r4c2', 'F3-r4c3', 'walk'),
  ('F3-r3c3', 'F3-r4c3', 'walk'),
  ('F3-r4c3', 'F3-r4c4', 'walk'),
  ('F3-r3c4', 'F3-r4c4', 'walk'),
  ('F3-r4c0', 'F3-r5c0', 'walk'),
  ('F3-r5c0', 'F3-r5c1', 'walk'),
  ('F3-r4c1', 'F3-r5c1', 'walk'),
  ('F3-r5c1', 'F3-r5c2', 'walk'),
  ('F3-r4c2', 'F3-r5c2', 'walk'),
  ('F3-r5c2', 'F3-r5c3', 'walk'),
  ('F3-r4c3', 'F3-r5c3', 'walk'),
  ('F3-r5c3', 'F3-r5c4', 'walk'),
  ('F3-r4c4', 'F3-r5c4', 'walk'),
  ('F3-ST', 'F3-r5c0', 'walk'),
  ('F3-LF', 'F3-r2c4', 'walk'),
  ('F1-ST', 'F2-ST', 'stairs'),
  ('F2-ST', 'F3-ST', 'stairs'),
  ('F1-LF', 'F2-LF', 'lift'),
  ('F2-LF', 'F3-LF', 'lift'),
  ('F1-r5c0', 'F1-DOOR', 'walk'),
  ('F1-DOOR', 'Y-J3', 'walk'),
  ('Y-J3', 'Y-J2', 'walk'),
  ('Y-J2', 'Y-J1', 'walk'),
  ('Y-J1', 'Y-B', 'walk'),
  ('Y-J1', 'Y-C', 'walk'),
  ('Y-D', 'Y-J1', 'walk'),
  ('Y-D', 'Y-J2', 'walk');

insert into public.zones (id, code, name, floor_id, kind, x, z, width, depth, access_node_id, stores) values
  ('F1-STAIRS', 'F1-STAIRS', 'บันได', 'F1', 'stairs', 0, 87, 4, 10, 'F1-ST', null),
  ('F1-LIFT', 'F1-LIFT', 'ลิฟต์ขนของ', 'F1', 'lift', 58, 40, 4, 8, 'F1-LF', null),
  ('F2-STAIRS', 'F2-STAIRS', 'บันได', 'F2', 'stairs', 0, 87, 4, 10, 'F2-ST', null),
  ('F2-LIFT', 'F2-LIFT', 'ลิฟต์ขนของ', 'F2', 'lift', 58, 40, 4, 8, 'F2-LF', null),
  ('F3-STAIRS', 'F3-STAIRS', 'บันได', 'F3', 'stairs', 0, 87, 4, 10, 'F3-ST', null),
  ('F3-LIFT', 'F3-LIFT', 'ลิฟต์ขนของ', 'F3', 'lift', 58, 40, 4, 8, 'F3-LF', null),
  ('RCV-01', 'RCV-01', 'จุดรับเข้าสินค้า', 'F1', 'receiving', 22, 94, 18, 3.5, 'F1-r5c2', null),
  ('F1-RK-A', 'RK-A', 'Rack A', 'F1', 'storage', 10, 12, 18, 10, 'F1-r1c1', array['Component']::text[]),
  ('F1-RK-B', 'RK-B', 'Rack B', 'F1', 'storage', 34, 12, 18, 10, 'F1-r1c3', array['Component']::text[]),
  ('F1-MI3', 'MI3-QC', 'พื้นที่ตรวจ MI3 (QC)', 'F1', 'inspection', 33, 82.5, 9, 7, 'F1-r4c2', null),
  ('F1-NG', 'NG-HOLD', 'พื้นที่กัก NG', 'F1', 'ng', 46, 82.5, 8, 7, 'F1-r4c3', null),
  ('F1-CHG', 'CHG', 'ที่ชาร์จรถยก / พาเลทเปล่า', 'F1', 'utility', 7.5, 82, 9, 6, 'F1-r4c0', null),
  ('F1-RK-C', 'RK-C', 'Rack C', 'F1', 'storage', 10, 48, 18, 10, 'F1-r2c1', array['Component']::text[]),
  ('F2-RK-D', 'RK-D', 'Rack D - Supermarket ชั้น 2', 'F2', 'storage', 10, 66, 14, 10, 'F2-r3c1', array['Component']::text[]),
  ('F2-RK-E', 'RK-E', 'Rack E', 'F2', 'storage', 34, 12, 18, 10, 'F2-r1c3', array['Component']::text[]),
  ('F2-ASM', 'ASM-W2', 'ไลน์ประกอบวงล้อ ชั้น 2', 'F2', 'assembly', 30, 48, 24, 10, 'F2-r2c3', null),
  ('F3-RK-F', 'RK-F', 'Rack F', 'F3', 'storage', 10, 30, 18, 10, 'F3-r1c1', array['Component']::text[]),
  ('F3-ASM', 'ASM-W3', 'ไลน์ประกอบวงล้อ ชั้น 3', 'F3', 'assembly', 30, 66, 24, 10, 'F3-r3c3', null),
  ('TENT-B', 'TENT-B', 'เต็นท์ B', 'YARD', 'tent', 36, 23, 31, 25, 'Y-B', array['FG', 'Component']::text[]),
  ('TENT-C', 'TENT-C', 'เต็นท์ C', 'YARD', 'tent', 27, 49, 29, 30, 'Y-C', array['FG', 'Component']::text[]),
  ('TENT-D', 'TENT-D', 'เต็นท์ D', 'YARD', 'tent', 68, 25, 17, 38, 'Y-D', array['Component']::text[]);

insert into public.sites (id, name, boundary) values
  ('UAM1', 'Union Autoparts Manufacturing', '[[2,86],[28,16],[98,17],[100,8.4],[220,10],[221,34],[171,23],[129,160]]');

insert into public.site_landmarks (id, site_id, name, kind, x, z, width, depth, rotation, height) values
  ('E', 'UAM1', 'สำนักงานใหญ่ (E)', 'office', 101.4, 134, 35, 18.6, 25.4, 8),
  ('G', 'UAM1', 'พื้นที่ G', 'area', 44, 98, 66, 24, 4, 0.2),
  ('F', 'UAM1', 'พื้นที่ F', 'area', 174, 21, 92, 14, 6, 0.2),
  ('ROAD', 'UAM1', 'ถ.ปู่เจ้าสมิงพราย', 'road', 55.4, 140.3, 260, 35, 30.2, 0.05);

-- Master: ลูกค้า, Model, Part (Royal Enfield K1G) และกฎแนะนำโซน
insert into public.customers (id, name) values
  ('RE', 'Royal Enfield');

insert into public.product_models (code, customer_id, requires_inspection) values
  ('K1G', 'RE', 'false'),
  ('J1D', 'RE', 'true'),
  ('J1D4', 'RE', 'true'),
  ('J1A', 'RE', 'true'),
  ('J1C', 'RE', 'true'),
  ('TWIN', 'RE', 'true'),
  ('P4M', 'RE', 'true'),
  ('P4D', 'RE', 'true');

insert into public.parts (part_no, name, part_type, customer_id) values
  ('RAJ00537/B', 'RIM, FRONT, TUBELESS,21X 2.15"', 'RIM', 'RE'),
  ('RAT00587/B', 'RIM, REAR, TUBELESS, 17" X 3.5"', 'RIM', 'RE'),
  ('RAJ00995/A', 'RIM, FRONT, TUBELESS,21X 2.15" BLACK', 'RIM', 'RE'),
  ('RAT1088/A', 'RIM, REAR, TUBELESS, 17" X 3.5" BLACK', 'RIM', 'RE'),
  ('PK1G0021', 'RIM,FRONT 21x2.15" GOLD', 'RIM', 'RE'),
  ('PK1G0022', 'RIM,REAR,TL,17x3.5" GOLD', 'RIM', 'RE'),
  ('RAJ00994/B', 'RIM,FRONT 21x2.15" JF,GOLD', 'RIM', 'RE'),
  ('RAT01087/B', 'RIM,REAR,TL,17x3.5" JF,GOLD', 'RIM', 'RE'),
  ('RAJ00536/B', 'HUB, FRONT, TUBELESS, 21X 2.15"', 'HUB', 'RE'),
  ('RAT00586/B', 'HUB, REAR, TUBELESS, K1G', 'HUB', 'RE'),
  ('RAJ00875/B', 'HUB, FRONT,TL, 21x2.15, OLIVE', 'HUB', 'RE'),
  ('RAT00952/A', 'HUB, REAR, TL, K1G, OLIVE', 'HUB', 'RE'),
  ('RAJ00239/B', 'BEARING, WHEEL, 6004', 'BEARING', 'RE'),
  ('RAJ00238/D', 'SPACER, WHEEL, INTERNAL', 'SPACER', 'RE'),
  ('RAT00282/D', 'SPACER, WHEEL, INTERNAL', 'SPACER', 'RE'),
  ('RAJ00240/B', 'SEAL, WHEEL, 44, 30', 'SEAL', 'RE'),
  ('RAT00283/A', 'SEAL, WHEEL, 42, 30', 'SEAL', 'RE'),
  ('RAJ00538/B', 'SPOKE, FRONT, TUBELESS,21X 2.15"', 'SPOKE', 'RE'),
  ('RAT00566/B', 'SPOKE 1, REAR, TUBELESS. 17" X 3.5"', 'SPOKE', 'RE'),
  ('RAT00567/B', 'SPOKE 2, REAR, TUBELESS. 17" X 3.5"', 'SPOKE', 'RE'),
  ('RAT00568/B', 'SPOKE 3, REAR, TUBELESS. 17" X 3.5"', 'SPOKE', 'RE'),
  ('RAT00592/B', 'SPOKE 4, REAR, TUBELESS. 17" X 3.5"', 'SPOKE', 'RE'),
  ('RAJ00550/B', 'NIPPLE, SPOKE, LOCKING', 'NIPPLE', 'RE'),
  ('RAB00587/B', 'BRAKE DISC, SOLID, 320', 'DISC', 'RE'),
  ('RAB00479/C', 'BRAKE DISC, SOLID, 270', 'DISC', 'RE'),
  ('RAJ00539/B', 'TONER RING, FRONT', 'TONER', 'RE'),
  ('RAJ00288/B', 'TONER RING', 'TONER', 'RE'),
  ('RAT00467/A', 'BOLT, M8x1.25x 21, SHOULDERED', 'BOLT', 'RE'),
  ('RAJ00757/A', 'CUSH RUBBER P4D /K1G', 'RUBBER', 'RE'),
  ('RAT01154/B', 'VALVE, WHEEL, TUBELESS', 'VALVE', 'RE'),
  ('RAJ00570/B', 'VALVE, WHEEL, TUBELESS', 'VALVE', 'RE'),
  ('RAJ00301/D', 'TYRE 90/90-21 FRONT', 'TYRE', 'RE'),
  ('RAT00322/D', 'TYRE 140/80-17 REAR', 'TYRE', 'RE'),
  ('150324/A', 'WHEEL BEARING 6203 (17x40x12)', 'BEARING', 'RE'),
  ('1100246/D', 'ALLOY RIM - FRONT - BLACK ALLOY', 'ALLOY RIM', 'RE'),
  ('1100247/D', 'ALLOY RIM REAR - BLACK', 'ALLOY RIM', 'RE'),
  ('RAJ00176/B', 'ALLOY RIM - FRONT - BLACK/MACHINING', 'ALLOY RIM', 'RE'),
  ('RAT00199/B', 'ALLOY RIM REAR - BLACK/MACHINING', 'ALLOY RIM', 'RE'),
  ('RAJ00177/C', 'STICKER RIM FRONT - YELLOW', 'STICKER', 'RE'),
  ('RAT00200/C', 'STICKER RIM - YELLOW', 'STICKER', 'RE'),
  ('RAJ00178/C', 'STICKER RIM FRONT - RED', 'STICKER', 'RE'),
  ('RAT00201/C', 'STICKER RIM - RED', 'STICKER', 'RE'),
  ('RAJ00510/A', 'DECAL 2D STRIPE LAGOON YELLOW', 'STICKER', 'RE'),
  ('RAT00531/A', 'STICKER - FIREBALL LAGOON YELLOW', 'STICKER', 'RE'),
  ('RAJ00513/A', 'DECAL 2D STRIPE PINE GREEN', 'STICKER', 'RE'),
  ('RAT00534/A', 'STICKER RIM - FIREBALL PINE GREEN', 'STICKER', 'RE'),
  ('1100237/C', 'SPACER ASSEMBLY - FRONT HUB', 'SPACER', 'RE'),
  ('146499/B', 'BEARING SPACER ASSEMBLY - REAR HUB', 'SPACER', 'RE'),
  ('141109/1', 'GREASE SEAL 25X40X7', 'SEAL', 'RE'),
  ('1100712/D', 'FRONT DISC PLATE', 'DISC', 'RE'),
  ('1100700/D', 'REAR DISC PLATE', 'DISC', 'RE'),
  ('1100713/B', 'TONER-FRONT WHEEL', 'TONER', 'RE'),
  ('RAT00087/A', 'TONER - REAR WHEEL', 'TONER', 'RE'),
  ('1100263/E', 'BOLT, M8 x 1.25 x 21, SHOULDERED', 'BOLT', 'RE'),
  ('RAT00255/A', 'CAP HEAD SHOULDERED-M6X1-20', 'BOLT', 'RE'),
  ('RAT00570/A', 'RUBBER CUSHION', 'RUBBER', 'RE'),
  ('RAJ00285/A', 'FRONT TUBELESS TYRE 100/90-19', 'TYRE', 'RE'),
  ('RAT00315/A', 'REAR TUBELESS TYRE 140/70-17', 'TYRE', 'RE'),
  ('1120064/A', 'VALVE - ALLOY WHEEL', 'VALVE', 'RE'),
  ('RAT01502/A', '2D DECAL. FRONT &REAR RH YELLOW (J1C)', 'STICKER', 'RE'),
  ('RAT01352/A', '2D DECAL. FRONT &REAR RH YELLOW (J1C)', 'STICKER', 'RE'),
  ('RAJ00296/A', 'ALLOY RIM, FRONT, MATTE BLACK', 'ALLOY RIM', 'RE'),
  ('RAT00328/A', 'ALLOY RIM, REAR, MATTE BLACK', 'ALLOY RIM', 'RE'),
  ('1100351/B', 'FRONT WHEEL RIM 2.15X19" Silver', 'RIM', 'RE'),
  ('RAT00181/A', 'REAR WHEEL RIM 3.00 X 18" Silver', 'RIM', 'RE'),
  ('RAJ00182/B', 'FRONT WHEEL RIM 2.15x18"- MATTE BLACK', 'RIM', 'RE'),
  ('RAT00208/B', 'REAR WHEEL RIM 3.00 X 18" - MATTE BLACK', 'RIM', 'RE'),
  ('RAT00538/B', 'REAR WHEEL RIM17X3.50 MT SILVER', 'RIM', 'RE'),
  ('1100187/C', 'HUB-FRONT', 'HUB', 'RE'),
  ('RAT00037/C', 'REAR HUB', 'HUB', 'RE'),
  ('RAJ00184/B', 'FRONT HUB - BLACK', 'HUB', 'RE'),
  ('RAT00210/B', 'REAR HUB - BLACK', 'HUB', 'RE'),
  ('RAJ00415/C', 'DAMPER RUBBER, FRONT WHEEL ASSY', 'RUBBER', 'RE'),
  ('140355/B', 'RIM TAPE', 'RIM TAPE', 'RE'),
  ('148650/D', 'RIM TAPE TWIN', 'RIM TAPE', 'RE'),
  ('587851/B', 'RIM TAPE', 'RIM TAPE', 'RE'),
  ('RAT00337/A', 'TYRE-REAR 120/80 - 18"', 'TYRE', 'RE'),
  ('RAJ00593/A', 'FRONT TUBE 100/90-19', 'TUBE', 'RE'),
  ('RAT00627/A', 'REAR TUBE 120/80-18"', 'TUBE', 'RE'),
  ('RAT00345/A', 'DECAL 2D - REAR WHEEL STRIPE RE RED', 'STICKER', 'RE'),
  ('RAJ00313/A', 'DECAL 2D - FRONT WHEEL STRIPE DARK BLUE', 'STICKER', 'RE'),
  ('RAT00346/A', 'DECAL 2D - REAR WHEEL STRIPE DARK BLUE', 'STICKER', 'RE'),
  ('RAJ00575/A', 'SPOKE-FRONT', 'SPOKE', 'RE'),
  ('RAT00606/A', 'SPOKE -REAR', 'SPOKE', 'RE'),
  ('RAT00329/A', 'SPOKE -REAR', 'SPOKE', 'RE'),
  ('RAJ00298/A', 'NIPPLE', 'NIPPLE', 'RE'),
  ('RAJ00268/A/A', 'FRONT TUBE 100/90-19', 'TUBE', 'RE'),
  ('591984/A', 'REAR TUBE 120/80-18"', 'TUBE', 'RE'),
  ('RAT00322/A', 'REAR TUBE 140/70-17', 'TUBE', 'RE'),
  ('RAJ01035/A', 'DECAL 2D - FRONT WHEEL RE COPPER(J1A3)', 'STICKER', 'RE'),
  ('RAT01131/A', 'DECAL 2D - REAR WHEEL RE COPPER (J1A3)', 'STICKER', 'RE'),
  ('RAJ00024/B', 'ALLOY RIM - 17x1.40 FRONT', 'ALLOY RIM', 'RE'),
  ('RAT00077/B', 'ALLOY RIM 17x3.00 REAR', 'ALLOY RIM', 'RE'),
  ('RAB00728/A', 'REAR DISC PLATE', 'DISC', 'RE'),
  ('RAJ00725/A', 'FRONT TUBELESS TYRE 110/70-17', 'TYRE', 'RE'),
  ('RAT00811/A', 'REAR TUBELESS TYRE 140/70-17', 'TYRE', 'RE'),
  ('RAJ00372/B', 'DECAL 2D, WHEEL PINSTRIPE, RH', 'STICKER', 'RE'),
  ('RAJ00373/B', 'DECAL 2D, WHEEL PINSTRIPE, LH', 'STICKER', 'RE'),
  ('RAJ00497/A', 'DECAL 2D, WHEEL, RH TORQUOISE/WHITE', 'STICKER', 'RE'),
  ('RAJ00486/A', 'DECAL 2D, WHEEL, LH TORQUOISE/WHITE', 'STICKER', 'RE'),
  ('RAJ00500/A', 'DECAL 2D, WHEEL, RH SILVER/PAN 102 C', 'STICKER', 'RE'),
  ('RAJ00489/A', 'DECAL 2D, WHEEL, LH SILVER/PAN 102 C', 'STICKER', 'RE'),
  ('RAJ00499/A', 'DECAL 2D, WHEEL, RH WHITE/PAN 2935 C', 'STICKER', 'RE'),
  ('RAJ00488/A', 'DECAL 2D, WHEEL, LH WHITE/PAN 2935 C', 'STICKER', 'RE'),
  ('RAJ00498/A', 'DECAL 2D, WHEEL, RH RE GOLD/RED', 'STICKER', 'RE'),
  ('RAJ00487/A', 'DECAL 2D, WHEEL, LH RE GOLD/RED', 'STICKER', 'RE'),
  ('RAJ00889/A', 'DECAL 2D, WHEEL, WHITE LH. PANTO WHI C.375C', 'STICKER', 'RE'),
  ('RAJ00890/A', 'DECAL 2D, WHEEL, WHITE RH. PANTO WHI C.375C', 'STICKER', 'RE'),
  ('RAJ00891/A', 'DECAL 2D, WHEEL, WHITE. LH PANTO WHI.172C', 'STICKER', 'RE'),
  ('RAJ00892/A', 'DECAL 2D, WHEEL, WHITE RH. PANTO WHI .172 C', 'STICKER', 'RE'),
  ('RAJ01087/A', 'DECAL 2D, WHEEL, RE LIGHT SAND.RH', 'STICKER', 'RE'),
  ('RAJ01088/A', 'DECAL 2D, WHEEL, RE LIGHT SAND.LH', 'STICKER', 'RE'),
  ('RAJ01085/A', 'DECAL 2D, WHEEL, RE MARBLE WHITE.RH', 'STICKER', 'RE'),
  ('RAJ01086/A', 'DECAL 2D, WHEEL, RE MARBLE WHITE.LH', 'STICKER', 'RE'),
  ('RAT00035/C', 'RUBBER CUSHION', 'RUBBER', 'RE'),
  ('RAT00450/A', 'TONER - REAR WHEEL', 'TONER', 'RE'),
  ('RAJ00669/A', 'FRONT WHEEL CAST BLACK 18x2.5', 'ALLOY RIM', 'RE'),
  ('RAT00728/A', 'REAR WHEEL CAST BLACK 18x3.5', 'ALLOY RIM', 'RE'),
  ('585514/A', 'BEARING SPACER ASSEMBLY - FRONT HUB', 'SPACER', 'RE'),
  ('RAB00076/A', 'BRAKE DISC 320MM', 'DISC', 'RE'),
  ('587395/B', 'REAR DISC PLATE', 'DISC', 'RE'),
  ('RAB00374/A', 'TONER - FRONT WHEEL - DF30 WSS', 'TONER', 'RE'),
  ('585216/C', 'TONER - REAR WHEEL', 'TONER', 'RE'),
  ('H6906002/A', 'HEX HEAD BOLT M8x1.25x30', 'BOLT', 'RE'),
  ('587605/B', 'SOCKET HEAD BOLT M8x1.25x20', 'BOLT', 'RE'),
  ('148543/A', 'TYRE FRONT 100/90-18', 'TYRE', 'RE'),
  ('148544/A', 'TYRE REAR 130/70-18', 'TYRE', 'RE'),
  ('148537/A', 'RIM FR. 18X2.50 BLACK', 'RIM', 'RE'),
  ('148532/A', 'RIM RR. 18X3.50 BLACK', 'RIM', 'RE'),
  ('148529/F', 'HUB REAR WHEEL BLACK', 'HUB', 'RE'),
  ('RAJ00030/A', 'HUB FRONT WHEEL BLACK', 'HUB', 'RE'),
  ('148640/A', 'SPOKE. WHEEL', 'SPOKE', 'RE'),
  ('RAT00259/A', 'SPOKE. REAR WHEEL', 'SPOKE', 'RE'),
  ('585179/A', 'NR61 NIPPLE 3.6 MM.', 'NIPPLE', 'RE'),
  ('593393/A', 'NIPPLE', 'NIPPLE', 'RE'),
  ('585304/B', 'NR61 REAR TUBE -130/80-18', 'TUBE', 'RE'),
  ('RAJ0005/B', 'TUBE TYRE 3X18', 'TUBE', 'RE'),
  ('585328/C', 'RIM TAPE', 'RIM TAPE', 'RE'),
  ('1050171', 'RIM - FRONT WHEEL,CAST 19x2.50', 'CAST', 'RE'),
  ('RAJ00009/B', 'SPACER ASSEMBLY - FRONT HUB', 'SPACER', 'RE'),
  ('RAB00009/B', 'BRAKE DISC FRONT', 'DISC', 'RE'),
  ('H6906048/A', 'BOLT,BUT.SHLD M8x30.10.9.wht.l', 'BOLT', 'RE'),
  ('RAJ00058/B', 'TYRE FRONT 100/90-90', 'TYRE', 'RE'),
  ('1050172/F', 'RIM REAR WHEEL .CAST.E16x3.50', 'CAST', 'RE'),
  ('RAT00011/B', 'SPACER INTERAL.REAR WHEEL', 'SPACER', 'RE'),
  ('RAB00012/B', 'BRAKE DISC REAR', 'DISC', 'RE'),
  ('RAB00013/B', 'ABS TONER RING.REAR WHEEL', 'TONER', 'RE'),
  ('RAT00007/D', 'CUSH RUBBER', 'RUBBER', 'RE'),
  ('RAT00067/G', 'TYRE REAR TUBELESS 150/80-16', 'TYRE', 'RE'),
  ('RAT00068/B', 'TYRE REAR 150/70-17', 'TYRE', 'RE'),
  ('RAJ00057/B', 'TYRE FRONT 100/90-18', 'TYRE', 'RE'),
  ('RAJ00008/H', 'RIM - FRONT WHEEL,CAST 18x2.50', 'CAST', 'RE'),
  ('RAT00010/G', 'RIM REAR WHEEL .CAST.E17x4.25', 'CAST', 'RE'),
  ('RAJ00481/D', 'HUB FRONT WHEEL', 'HUB', 'RE'),
  ('RAT00507/E', 'HUB REAR WHEEL', 'HUB', 'RE'),
  ('RAJ00482/C', 'RIM FRONT WHEEL 19x2.50', 'RIM', 'RE'),
  ('RAT00508/C', 'RIM REAR WHEEL 18x4.00', 'RIM', 'RE'),
  ('RAJ00483/B', 'SPOKE FRONT WHEEL', 'SPOKE', 'RE'),
  ('RAJ00592/B', 'TYRE FRONT 100/90-19', 'TYRE', 'RE'),
  ('RAT00165/C', 'NIPPLE SPOKE', 'NIPPLE', 'RE'),
  ('RAT00509/B', 'SPOKE REAR WHEEL', 'SPOKE', 'RE'),
  ('RAT00624/B', 'TYRE FRONT 140/70-R18', 'TYRE', 'RE'),
  ('RAT00849/A', 'TUBE FRONT 140/70-R19', 'TUBE', 'RE'),
  ('RAT01069/A', 'RIM TAPE REAR', 'RIM TAPE', 'RE');

insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00537/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00587/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00995/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT1088/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'PK1G0021';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'PK1G0022';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00994/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT01087/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00536/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00586/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00875/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00952/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00239/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00238/D';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00282/D';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00240/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00283/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00538/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00566/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00567/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00568/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00592/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00550/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAB00587/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAB00479/C';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00539/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00288/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00467/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAT00467/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00757/A';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT01154/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00570/B';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAJ00301/D';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = 'RAT00322/D';
insert into public.part_models (part_id, model_code) select id, 'K1G' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '150324/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100246/D';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100246/D';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100247/D';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100247/D';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00176/B';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00176/B';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00199/B';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00199/B';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00177/C';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00177/C';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00200/C';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00200/C';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00178/C';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00178/C';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00178/C';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00201/C';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00201/C';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00510/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00510/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00531/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00531/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00513/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00513/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00534/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00534/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100237/C';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100237/C';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100237/C';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '1100237/C';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '146499/B';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '146499/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '146499/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '146499/B';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '146499/B';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '141109/1';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100712/D';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100712/D';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100712/D';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '1100712/D';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100700/D';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100700/D';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100700/D';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '1100713/B';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00087/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00087/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00087/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1100263/E';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1100263/E';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100263/E';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '1100263/E';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00255/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00255/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00255/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00570/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00570/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00570/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAJ00285/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAJ00285/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00285/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT00315/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT00315/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00315/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '1120064/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT01502/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT01502/A';
insert into public.part_models (part_id, model_code) select id, 'J1D' from public.parts where part_no = 'RAT01352/A';
insert into public.part_models (part_id, model_code) select id, 'J1D4' from public.parts where part_no = 'RAT01352/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00296/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00328/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100351/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00181/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00182/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00208/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00538/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '1100187/C';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00037/C';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00184/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00210/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00415/C';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '140355/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '148650/D';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148650/D';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '587851/B';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00337/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00593/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00627/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00345/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00313/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00346/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00575/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00606/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00329/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00298/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ00268/A/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = '591984/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT00322/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAJ01035/A';
insert into public.part_models (part_id, model_code) select id, 'J1A' from public.parts where part_no = 'RAT01131/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00024/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAT00077/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAB00728/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00725/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAT00811/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00372/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00373/B';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00497/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00486/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00500/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00489/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00499/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00488/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00498/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00487/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00889/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00890/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00891/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ00892/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ01087/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ01088/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ01085/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAJ01086/A';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAT00035/C';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAT00035/C';
insert into public.part_models (part_id, model_code) select id, 'J1C' from public.parts where part_no = 'RAT00450/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAJ00669/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAT00728/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '585514/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAB00076/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '587395/B';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAB00374/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '585216/C';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'H6906002/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '587605/B';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148543/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148544/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148537/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148532/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148529/F';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAJ00030/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '148640/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAT00259/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '585179/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '593393/A';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '585304/B';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = 'RAJ0005/B';
insert into public.part_models (part_id, model_code) select id, 'TWIN' from public.parts where part_no = '585328/C';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '1050171';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '1050171';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00009/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00009/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAB00009/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAB00009/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'H6906048/A';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'H6906048/A';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00058/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00058/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = '1050172/F';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = '1050172/F';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00011/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00011/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAB00012/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAB00012/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAB00013/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAB00013/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00007/D';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00007/D';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00067/G';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00067/G';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00068/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00068/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00057/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00057/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00008/H';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00008/H';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00010/G';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00010/G';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00481/D';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00481/D';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00507/E';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00507/E';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00482/C';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00482/C';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00508/C';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00508/C';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00483/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00483/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAJ00592/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAJ00592/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00165/C';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00165/C';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00509/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00509/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00624/B';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00624/B';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT00849/A';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT00849/A';
insert into public.part_models (part_id, model_code) select id, 'P4M' from public.parts where part_no = 'RAT01069/A';
insert into public.part_models (part_id, model_code) select id, 'P4D' from public.parts where part_no = 'RAT01069/A';

insert into public.zone_rules (customer_id, part_type, zone_id) values
  ('RE', 'RIM', 'F1-RK-C'),
  ('RE', 'HUB', 'F1-RK-B'),
  ('RE', 'DISC', 'F1-RK-B'),
  ('RE', 'TONER', 'F1-RK-B'),
  ('RE', 'SPOKE', 'F1-RK-A'),
  ('RE', 'NIPPLE', 'F1-RK-A'),
  ('RE', 'BOLT', 'F1-RK-A'),
  ('RE', 'BEARING', 'F2-RK-E'),
  ('RE', 'SPACER', 'F2-RK-E'),
  ('RE', 'SEAL', 'F2-RK-E'),
  ('RE', 'VALVE', 'F2-RK-E'),
  ('RE', 'RUBBER', 'F2-RK-E'),
  ('RE', 'TYRE', 'TENT-C'),
  ('RE', 'TUBE', 'TENT-C'),
  ('RE', 'ALLOY RIM', 'F1-RK-C'),
  ('RE', 'CAST', 'F1-RK-C'),
  ('RE', 'STICKER', 'F2-RK-D'),
  ('RE', 'RIM TAPE', 'F2-RK-D'),
  ('RE', null, 'TENT-D');
