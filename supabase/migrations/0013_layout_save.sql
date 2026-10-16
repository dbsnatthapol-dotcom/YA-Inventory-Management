-- ปรับผังคลังจากหน้า "ปรับผัง" แล้วบันทึกลงฐานข้อมูลกลาง (ทุกคนเห็นผังเดียวกัน)
-- 1) โซนเก็บของ: ประเภท (พาเลทวางพื้น / rack), จำนวนชั้น, ที่วางต่อชั้น
-- 2) สิทธิ์ใหม่ layout.edit (ผู้จัดการ + วิศวกร · admin ได้เสมอ)
-- 3) layout_save: บันทึกโซน/บันได/ลิฟต์/ทางเดินที่แก้ + สร้างช่องเก็บตามจำนวนที่วาง
--    ห้ามลบโซน ลดขนาด หรือลดจำนวนช่องที่ยังมีของ (ต้องย้ายของออกก่อน)
-- 4) create_grn: ผู้รับของเลือกโซนเก็บเองได้ต่อรายการ (ไม่เลือก = ระบบแนะนำตามกฎเหมือนเดิม)

-- ===================== 1) ค่าการเก็บของโซน =====================
alter table public.zones add column if not exists storage text check (storage in ('floor', 'rack'));
alter table public.zones add column if not exists levels smallint check (levels between 1 and 10);
alter table public.zones add column if not exists slots_per_level integer check (slots_per_level >= 0);
comment on column public.zones.storage is 'โซนเก็บของ: floor = พาเลทวางพื้น (ค่าเริ่มต้น), rack = ชั้นวาง';
comment on column public.zones.levels is 'จำนวนชั้น (ซ้อนพาเลท / ระดับ rack) · ว่าง = ค่าเริ่มต้น (พาเลท 2 ชั้น, rack 3 ระดับ)';
comment on column public.zones.slots_per_level is 'ที่วางพาเลทต่อชั้น · ว่าง = เต็มพื้นที่โซน';

-- rack เตี้ยบนชั้นลอยอาคาร F
update public.zones set storage = 'rack', levels = 2 where id in ('FBM-RK-G', 'FBM-RK-H') and storage is null;

-- ===================== 2) สิทธิ์ =====================
insert into public.role_permissions (role, perm) values ('manager', 'layout.edit'), ('engineer', 'layout.edit')
on conflict (role, perm) do nothing;

-- ===================== 3) ช่องเก็บของโซน =====================
-- ให้ช่อง active ของโซนตรงกับรายการ: ช่องที่ไม่อยู่ในรายการปิดใช้ (ถ้ายังมีของ ⇒ error), ช่องใหม่เพิ่ม/เปิดใช้
create or replace function public.sync_zone_locations(p_zone text, p_codes text[], p_kind text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_busy text;
begin
  select string_agg(code, ', ' order by code) into v_busy from (
    select distinct l.code from public.locations l
    join public.lpns x on x.location_code = l.code and x.status = 'active' and x.env in (public.wms_env(), 'live')
    where l.zone_id = p_zone and l.active and not (l.code = any (p_codes)) limit 10) b;
  if v_busy is not null then
    raise exception 'ช่อง % ยังมีของอยู่ — ย้ายของออกก่อนลดขนาดหรือจำนวนช่องของโซน', v_busy;
  end if;
  select string_agg(code, ', ') into v_busy from (
    select code from public.locations where code = any (p_codes) and zone_id <> p_zone and active limit 10) b;
  if v_busy is not null then raise exception 'รหัสช่อง % ซ้ำกับโซนอื่น', v_busy; end if;

  update public.locations set active = false where zone_id = p_zone and active and not (code = any (p_codes));
  insert into public.locations (code, zone_id, kind, active)
  select c, p_zone, p_kind, true from unnest(p_codes) c
  on conflict (code) do update set zone_id = excluded.zone_id, kind = excluded.kind, active = true;
end;
$$;
revoke execute on function public.sync_zone_locations(text, text[], text) from public, anon, authenticated;

-- ช่องเก็บตามค่าใหม่: โซน-ที่วาง-ชั้น (RK-A-01-1) · ค่าเริ่มต้นพาเลทวางพื้นซ้อน 2 ชั้น
-- (ข้ามเมื่อติดตั้งใหม่ — seed.sql สร้างให้แล้ว)
do $$
declare
  r record;
begin
  if not exists (select 1 from public.zones where id = 'F1-RK-A') then return; end if;
  for r in
    select v.* from (values
      ('F1-RK-A', 'RK-A', 48, 2, 'floor'), ('F1-RK-B', 'RK-B', 48, 2, 'floor'), ('F1-RK-C', 'RK-C', 48, 2, 'floor'),
      ('F2-RK-D', 'RK-D', 40, 2, 'floor'), ('F2-RK-E', 'RK-E', 48, 2, 'floor'), ('F3-RK-F', 'RK-F', 48, 2, 'floor'),
      ('FBM-RK-G', 'RK-G', 30, 2, 'bin'), ('FBM-RK-H', 'RK-H', 28, 2, 'bin'),
      ('FB2-RK-J', 'RK-J', 28, 2, 'floor'), ('FB2-RK-K', 'RK-K', 28, 2, 'floor'), ('FB2-RK-L', 'RK-L', 24, 2, 'floor'), ('FB2-RK-M', 'RK-M', 28, 2, 'floor')
    ) as v (zone_id, code, per_level, levels, kind)
    join public.zones z on z.id = v.zone_id and z.code = v.code
  loop
    perform public.sync_zone_locations(r.zone_id,
      array(select r.code || '-' || lpad(p::text, 2, '0') || '-' || l from generate_series(1, r.per_level) p cross join generate_series(1, r.levels) l order by p, l),
      r.kind);
  end loop;
end;
$$;

-- ===================== 3) บันทึกผัง =====================
-- p jsonb = {
--   zones:     [{ id, code, name, floorId, kind, x, z, width, depth, accessNodeId, stores, storage, levels, slotsPerLevel }]  เพิ่ม/แก้
--   removed:   [zoneId]
--   nodes:     [{ id, floorId, x, z }]           จุดเข้าบันได/ลิฟต์ที่สร้างใหม่
--   addEdges:  [{ from, to, mode }]
--   dropEdges: [{ from, to }]
--   locations: [{ zoneId, kind, codes: [..] }]   ช่องเก็บที่ควรมีของโซนที่แก้
-- }
create or replace function public.layout_save(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id text;
  v_zone public.zones;
  v_busy text;
  v jsonb;
  v_removed integer := 0;
begin
  perform public.require_perm('layout.edit');

  -- ลบโซน: ต้องไม่มีของ ไม่ใช่จุดรับเข้า และไม่ถูกใช้ในกฎแนะนำโซน
  for v_id in select jsonb_array_elements_text(coalesce(p -> 'removed', '[]')) loop
    select * into v_zone from public.zones where id = v_id;
    if not found then continue; end if;
    if v_zone.kind = 'receiving' or v_zone.code in ('RCV-01', 'MI3-QC') then
      raise exception 'ลบ % ไม่ได้ (จุดรับเข้า/จุดตรวจหลักของระบบ)', v_zone.code;
    end if;
    select string_agg(distinct x.lpn_no, ', ') into v_busy from public.lpns x
    where x.status = 'active' and x.env in (public.wms_env(), 'live')
      and (x.location_code = v_zone.code or x.location_code in (select code from public.locations where zone_id = v_id));
    if v_busy is not null then raise exception 'โซน % ยังมีของ (%) — ย้ายของออกก่อนลบ', v_zone.code, left(v_busy, 120); end if;
    if exists (select 1 from public.zone_rules where zone_id = v_id) then
      raise exception 'โซน % ถูกใช้ในกฎแนะนำโซน — เปลี่ยนกฎในหน้าหลังบ้านก่อนลบ', v_zone.code;
    end if;
    begin
      delete from public.zones where id = v_id;
    exception when foreign_key_violation then
      raise exception 'ลบโซน % ไม่ได้ เพราะยังมีข้อมูลอื่นอ้างถึง (เช่น ประวัติรับเข้า/แผนเบิก)', v_zone.code;
    end;
    v_removed := v_removed + 1;
  end loop;

  insert into public.nav_nodes (id, floor_id, x, z)
  select n ->> 'id', n ->> 'floorId', (n ->> 'x')::numeric, (n ->> 'z')::numeric
  from jsonb_array_elements(coalesce(p -> 'nodes', '[]')) n
  on conflict (id) do update set floor_id = excluded.floor_id, x = excluded.x, z = excluded.z;

  for v in select * from jsonb_array_elements(coalesce(p -> 'zones', '[]')) loop
    -- รหัสจุดรับเข้า/จุดตรวจหลักใช้ในงานรับของ ห้ามเปลี่ยน
    if exists (select 1 from public.zones where id = v ->> 'id' and code in ('RCV-01', 'MI3-QC') and code <> v ->> 'code') then
      raise exception 'เปลี่ยนรหัส % ไม่ได้ (ใช้ในงานรับของ)', (select code from public.zones where id = v ->> 'id');
    end if;
    insert into public.zones (id, code, name, floor_id, kind, x, z, width, depth, access_node_id, stores, storage, levels, slots_per_level)
    values (v ->> 'id', v ->> 'code', v ->> 'name', v ->> 'floorId', v ->> 'kind',
            (v ->> 'x')::numeric, (v ->> 'z')::numeric, (v ->> 'width')::numeric, (v ->> 'depth')::numeric, v ->> 'accessNodeId',
            case when jsonb_typeof(v -> 'stores') = 'array' then array(select jsonb_array_elements_text(v -> 'stores')) end,
            v ->> 'storage', (v ->> 'levels')::smallint, (v ->> 'slotsPerLevel')::integer)
    on conflict (id) do update set code = excluded.code, name = excluded.name, floor_id = excluded.floor_id, kind = excluded.kind,
      x = excluded.x, z = excluded.z, width = excluded.width, depth = excluded.depth, access_node_id = excluded.access_node_id,
      storage = excluded.storage, levels = excluded.levels, slots_per_level = excluded.slots_per_level;
  end loop;

  delete from public.nav_edges e
  using jsonb_array_elements(coalesce(p -> 'dropEdges', '[]')) d
  where e.from_node_id = d ->> 'from' and e.to_node_id = d ->> 'to';
  insert into public.nav_edges (from_node_id, to_node_id, mode)
  select a ->> 'from', a ->> 'to', a ->> 'mode' from jsonb_array_elements(coalesce(p -> 'addEdges', '[]')) a
  on conflict (from_node_id, to_node_id) do update set mode = excluded.mode;

  for v in select * from jsonb_array_elements(coalesce(p -> 'locations', '[]')) loop
    perform public.sync_zone_locations(v ->> 'zoneId', array(select jsonb_array_elements_text(v -> 'codes')), v ->> 'kind');
  end loop;

  return jsonb_build_object('zones', jsonb_array_length(coalesce(p -> 'zones', '[]')), 'removed', v_removed);
end;
$$;

-- ===================== 4) รับของ: เลือกโซนเก็บเองได้ =====================
-- lines: [{ partNo, description, plQty, countedQty, zoneId? }] · zoneId = โซนที่ผู้รับเลือก (ช่องว่างแรกในโซนนั้น)
create or replace function public.create_grn(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  v_inv jsonb := p -> 'invoice';
  v_pl jsonb := p -> 'packingList';
  v_model text := nullif(p ->> 'modelCode', '');
  v_customer text;
  v_requires boolean;
  v_qi_types text[];
  v_invoice_id uuid;
  v_pl_id uuid;
  v_grn_id uuid;
  v_grn_no text;
  v_line jsonb;
  v_no integer := 0;
  v_type text;
  v_needs boolean;
  v_zone text;
  v_home text;
  v_loc text;
  v_line_id uuid;
  v_lpn_id uuid;
  v_lpn_no text;
  v_inv_qty numeric;
begin
  perform public.require_perm('receive.create');
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการรับเข้า'; end if;
  if coalesce(v_pl ->> 'refDoc', '') = '' then raise exception 'ต้องมีเลขอ้างอิงของ Packing List'; end if;

  select customer_id, requires_inspection into v_customer, v_requires from public.product_models where code = v_model;
  v_customer := coalesce(v_customer, nullif(v_inv ->> 'customerId', ''));
  select array(select jsonb_array_elements_text(value)) into v_qi_types from public.app_settings where key = 'qi_part_types';

  -- Invoice: เลขเดิม = ผูกกับใบเดิม ไม่สร้างซ้ำ
  if coalesce(v_inv ->> 'invoiceNo', '') <> '' then
    select id into v_invoice_id from public.invoices where invoice_no = v_inv ->> 'invoiceNo' and env = v_env;
    if v_invoice_id is null then
      insert into public.invoices (invoice_no, customer_id, po_no, doc_date, movement_type, extraction)
      values (v_inv ->> 'invoiceNo', v_customer, nullif(v_inv ->> 'poNo', ''), nullif(v_inv ->> 'docDate', '')::date,
              nullif(v_inv ->> 'movementType', ''), v_inv -> 'extraction')
      returning id into v_invoice_id;
      insert into public.invoice_lines (invoice_id, line_no, part_no, description, qty)
      select v_invoice_id, (l ->> 'lineNo')::integer, l ->> 'partNo', l ->> 'description', (l ->> 'qty')::numeric
      from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]')) l;
    end if;
  end if;

  insert into public.packing_lists (ref_doc, so_no, packages, invoice_id, extraction)
  values (v_pl ->> 'refDoc', nullif(v_pl ->> 'soNo', ''), nullif(v_pl ->> 'packages', ''), v_invoice_id, v_pl -> 'extraction')
  returning id into v_pl_id;

  v_grn_no := public.next_doc_no('GRN');
  insert into public.grns (grn_no, packing_list_id, invoice_id, customer_id, model_code, receiver_code, note)
  values (v_grn_no, v_pl_id, v_invoice_id, v_customer, v_model, public.my_code(), nullif(p ->> 'note', ''))
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_no := v_no + 1;
    select part_type into v_type from public.parts where part_no = v_line ->> 'partNo';
    v_needs := coalesce(coalesce(v_requires, true) and v_type = any (v_qi_types), false);
    v_zone := nullif(v_line ->> 'zoneId', '');
    if v_zone is not null and not exists (select 1 from public.zones where id = v_zone) then
      raise exception 'ไม่พบโซน % (รายการที่ %)', v_zone, v_no;
    end if;
    if v_zone is not null then
      -- โซนที่ผู้รับเลือก: ช่องแรกที่ว่าง ถ้าเต็ม/ไม่มีช่องย่อย ใช้รหัสโซน
      select coalesce(
        (select l.code from public.locations l
           where l.zone_id = v_zone and l.active and l.kind in ('bin', 'floor')
             and not exists (select 1 from public.lpns x where x.location_code = l.code and x.status = 'active' and x.env = v_env)
             and not exists (select 1 from public.grn_lines g where g.grn_id = v_grn_id and g.home_location = l.code)
           order by l.code limit 1),
        (select code from public.zones where id = v_zone))
      into v_home;
    else
      -- ช่องแนะนำ: ช่องแรกที่ว่างในโซนตามกฎ (ลูกค้า + กลุ่ม part) ถ้าไม่มีช่องย่อย ใช้รหัสโซน
      select coalesce(
        (select l.code from public.zone_rules r join public.locations l on l.zone_id = r.zone_id and l.active and l.kind in ('bin', 'floor')
           where r.customer_id = v_customer and (r.part_type = v_type or r.part_type is null)
             and not exists (select 1 from public.lpns x where x.location_code = l.code and x.status = 'active' and x.env = v_env)
             and not exists (select 1 from public.grn_lines g where g.grn_id = v_grn_id and g.home_location = l.code)
           order by (r.part_type is null), l.code limit 1),
        (select z.code from public.zone_rules r join public.zones z on z.id = r.zone_id
           where r.customer_id = v_customer and (r.part_type = v_type or r.part_type is null) order by (r.part_type is null) limit 1),
        'RCV-01')
      into v_home;
    end if;
    v_loc := case when v_needs then 'MI3-QC' else 'RCV-01' end;
    select qty into v_inv_qty from public.invoice_lines where invoice_id = v_invoice_id and part_no = v_line ->> 'partNo' limit 1;

    insert into public.grn_lines (grn_id, line_no, part_no, description, part_type, pl_qty, counted_qty, invoice_qty, needs_qi, home_location)
    values (v_grn_id, v_no, v_line ->> 'partNo', v_line ->> 'description', v_type,
            coalesce((v_line ->> 'plQty')::numeric, 0), (v_line ->> 'countedQty')::numeric, v_inv_qty, v_needs, v_home)
    returning id into v_line_id;

    -- 1 part = 1 ป้าย (รวมกล่องภายหลังได้ด้วย merge_lpns)
    if (v_line ->> 'countedQty')::numeric > 0 then
      v_lpn_no := public.next_doc_no('LPN');
      insert into public.lpns (lpn_no, grn_id, location_code, hold) values (v_lpn_no, v_grn_id, v_loc, v_needs) returning id into v_lpn_id;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', (v_line ->> 'countedQty')::numeric);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', (v_line ->> 'countedQty')::numeric, v_loc, v_pl ->> 'refDoc', public.my_code());
    end if;
  end loop;

  return jsonb_build_object('grnId', v_grn_id, 'grnNo', v_grn_no, 'invoiceId', v_invoice_id);
end;
$$;
