-- 0022: แก้บั๊กชุดด่วนจากการตรวจระบบ (docs/known-issues.md A1 A2 A3 A5 B1) · แก้เฉพาะฟังก์ชัน ไม่เปลี่ยนตาราง ไม่ลบข้อมูล
--   A1 อนุมัติปรับยอด: ยอดในกล่องเปลี่ยนหลังส่งคำขอ (เบิก / คืน / ตรวจ MI3) ⇒ ไม่ให้อนุมัติ ให้นับใหม่ (เดิมตั้งยอดทับ ⇒ สต็อกผี)
--      กล่องที่ถูกยกเลิกใบรับแล้วอนุมัติปรับยอดไม่ได้ · ปรับสถานะกล่องที่รายการอยู่ตอนนี้
--   A2 รวมกล่อง: ห้ามรวมกล่องในพื้นที่กัก NG กับกล่องอื่น และกล่องรวมต้องอยู่พื้นที่ชนิดเดียวกับกล่องต้นทาง (NG / ไม่ใช่ NG)
--      ล็อกกล่องก่อนตรวจสถานะ (รวมพร้อมกันสองเครื่องไม่ชนกัน)
--   A3 ใบตรวจนับ Excel: part เดียวกันห้ามมีแถวช่องกับแถวโซนที่ซ้อนกัน (เดิมปรับยอดทั้งสองแถว)
--   A5 คืนของ (ยกเลิกใบเบิก / FM-P-005 คืน): คืนเข้ากล่องที่รายการอยู่ตอนนี้ (หลังรวม/แยกกล่อง) และเปิดสถานะกล่องนั้น
--      เดิมเปิดสถานะกล่องตอนเบิก ⇒ ของค้างในกล่อง "หมดแล้ว" มองไม่เห็น เบิกไม่ได้ · คืนแบบล่าสุดก่อนเรียงลำดับแน่นอน
--   B1 บรรทัด Invoice: part เดียวอยู่หลายเคส หน้าจอเคยส่งบรรทัด Invoice ซ้ำ ⇒ ตัดบรรทัดซ้ำ ให้เลขบรรทัดไม่ชนกัน
--      (เดิม GRN ล้มด้วย invoice_lines_pkey หรือ Invoice ถูกบันทึกซ้ำสองเท่า)

-- ===================== A1 อนุมัติปรับยอด =====================
create or replace function public.scan_adjust_decide(p_tx uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.wms_tx;
  v_item public.lpn_items;
  v_box public.lpns;
begin
  perform public.require_perm('scan.adjust.approve');
  select * into v from public.wms_tx where id = p_tx and kind = 'ADJ' and env = public.wms_env() for update;
  if v.id is null or v.status <> 'pending' then raise exception 'รายการนี้ถูกพิจารณาไปแล้ว'; end if;
  if v.created_by = auth.uid() then raise exception 'อนุมัติรายการของตัวเองไม่ได้'; end if;
  if p_approve then
    -- ยอดที่ขอนับจากยอดตอนส่งคำขอ: ถ้ายอดเปลี่ยนหลังขอ (เบิก / คืน / ตรวจ MI3) ตัวเลขที่นับมาไม่จริงแล้ว ⇒ นับใหม่
    select * into v_item from public.lpn_items where id = v.lpn_item_id for update;
    if v_item.id is null then raise exception 'ไม่พบรายการในกล่อง'; end if;
    select * into v_box from public.lpns where id = v_item.lpn_id for update;
    if v_box.status not in ('active', 'empty') then
      raise exception 'กล่อง % ถูกยกเลิกแล้ว (ยกเลิกใบรับ) · กดไม่อนุมัติคำขอนี้', v_box.lpn_no;
    end if;
    if v_item.qty <> v.qty then
      raise exception 'ยอด % ในกล่อง % เปลี่ยนหลังส่งคำขอ (ตอนขอ % · ตอนนี้ %) · กดไม่อนุมัติแล้วให้นับใหม่',
        v.part_no, v_box.lpn_no, v.qty, v_item.qty;
    end if;
    update public.lpn_items set qty = v.new_qty where id = v_item.id;
    update public.lpns l set status = case when exists (select 1 from public.lpn_items where lpn_id = l.id and qty > 0) then 'active' else 'empty' end
    where l.id = v_item.lpn_id;
  end if;
  update public.wms_tx set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_code = public.my_code(), decided_at = now()
  where id = p_tx;
end;
$$;

-- ===================== A2 รวมกล่อง =====================
create or replace function public.merge_lpns(p_lpn_ids uuid[], p_location text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  v_new uuid;
  v_no text;
  v_first public.lpns;
  v_to text;
  v_ng integer;
  v_good integer;
begin
  perform public.require_perm('label.print');
  if coalesce(array_length(p_lpn_ids, 1), 0) < 2 then raise exception 'เลือกอย่างน้อย 2 ป้ายเพื่อรวม'; end if;
  -- ล็อกกล่องที่เลือก (เรียงตาม id กันล็อกไขว้) ก่อนตรวจสถานะ
  perform id from public.lpns where id = any (p_lpn_ids) order by id for update;
  select * into v_first from public.lpns where id = p_lpn_ids[1] and status = 'active' and env = v_env;
  if v_first.id is null then raise exception 'ไม่พบป้ายที่เลือก'; end if;
  if (select count(*) from public.lpns where id = any (p_lpn_ids) and status = 'active' and env = v_env) <> array_length(p_lpn_ids, 1) then
    raise exception 'มีป้ายที่ถูกรวมหรือใช้หมดไปแล้ว';
  end if;
  -- ของเสียหายอยู่พื้นที่กัก NG: รวมกับของดีแล้วกล่องรวมหลุดออกจากพื้นที่ NG ⇒ ถูกเบิกเข้าไลน์
  select count(*) filter (where lo.kind = 'ng'), count(*) filter (where lo.kind is distinct from 'ng')
    into v_ng, v_good
  from public.lpns l left join public.locations lo on lo.code = l.location_code
  where l.id = any (p_lpn_ids);
  if v_ng > 0 and v_good > 0 then
    raise exception 'รวมกล่อง NG (ของเสียหาย) กับกล่องของดีไม่ได้ · พิมพ์ป้ายแยกกัน ของ NG ต้องอยู่พื้นที่กัก NG';
  end if;
  v_to := coalesce(nullif(upper(trim(p_location)), ''), v_first.location_code);
  if (v_ng > 0) <> coalesce((select kind = 'ng' from public.locations where code = v_to), false) then
    raise exception '%', case when v_ng > 0 then 'กล่อง NG รวมแล้วต้องอยู่พื้นที่กัก NG · เลือกช่อง NG' else 'รวมกล่องของดีไปไว้พื้นที่กัก NG ไม่ได้' end;
  end if;
  v_no := public.next_doc_no('LPN');
  insert into public.lpns (lpn_no, grn_id, location_code, hold)
  values (v_no, v_first.grn_id, v_to, (select bool_or(hold) from public.lpns where id = any (p_lpn_ids)))
  returning id into v_new;
  update public.lpn_items set prev_lpn_id = lpn_id, lpn_id = v_new where lpn_id = any (p_lpn_ids);
  update public.lpns set status = 'merged', merged_into = v_new where id = any (p_lpn_ids);
  insert into public.wms_tx (kind, doc_no, lpn_id, to_loc, ref, created_code)
  values ('MERGE', v_no, v_new, v_to,
          (select string_agg(lpn_no, ', ' order by lpn_no) from public.lpns where id = any (p_lpn_ids)), public.my_code());
  return jsonb_build_object('lpnId', v_new, 'lpnNo', v_no);
end;
$$;

-- ===================== A3 ใบตรวจนับ Excel =====================
create or replace function public.stock_count_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_no text;
  l jsonb;
  v_n integer := 0;
  v_locs text[];
  v_part text;
  v_qty numeric;
  v_zone text;
  v_clash text;
  v_clash_no integer;
begin
  perform public.require_perm('scan.count');
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการตรวจนับ'; end if;
  v_no := public.next_doc_no('CNT');
  insert into public.stock_counts (count_no, note, created_code) values (v_no, nullif(trim(coalesce(p ->> 'note', '')), ''), public.my_code())
  returning id into v_id;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_n := v_n + 1;
    v_locs := public.count_locations(l ->> 'loc');
    if v_locs is null then raise exception 'แถว %: ไม่พบช่องเก็บหรือโซน "%"', v_n, l ->> 'loc'; end if;
    v_part := public.part_canon(l ->> 'partNo');
    if not exists (select 1 from public.parts where part_no = v_part) then raise exception 'แถว %: ไม่พบ part "%" ใน Master', v_n, l ->> 'partNo'; end if;
    v_qty := (l ->> 'counted')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'แถว %: จำนวนนับต้องเป็น 0 ขึ้นไป', v_n; end if;
    -- part เดียวกันห้ามมีแถวที่ช่องซ้อนกัน (ช่องซ้ำ หรือแถวโซนที่รวมช่องนั้น) ไม่งั้นอนุมัติแล้วปรับยอดซ้ำสองรอบ
    select s.line_no, s.loc into v_clash_no, v_clash from public.stock_count_lines s
    where s.count_id = v_id and s.part_no = v_part and public.count_locations(s.loc) && v_locs
    order by s.line_no limit 1;
    if v_clash is not null then
      raise exception 'แถว %: % ที่ % ซ้อนกับแถว % (%) ในไฟล์เดียวกัน (ช่องเดียวกัน หรือโซนที่มีช่องนั้น) · part เดียวกันให้นับระดับเดียว: รายช่อง หรือทั้งโซน',
        v_n, v_part, upper(trim(l ->> 'loc')), v_clash_no, v_clash;
    end if;
    select zone_id into v_zone from public.locations where code = v_locs[1];
    insert into public.stock_count_lines (count_id, line_no, loc, zone_id, part_no, system_qty, counted_qty)
    values (v_id, v_n, upper(trim(l ->> 'loc')), v_zone, v_part, public.count_system_qty(v_locs, v_part), v_qty);
  end loop;
  return jsonb_build_object('id', v_id, 'countNo', v_no);
end;
$$;

-- ===================== A5 คืนของเข้ากล่องที่รายการอยู่ตอนนี้ =====================
create or replace function public.wms_return_lifo(p_req uuid, p_from uuid[], p_doc text, p_ref text, p_part text, p_qty numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_left numeric := p_qty;
  v_take numeric;
  v_box uuid;
  v_loc text;
  r record;
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  for r in
    select t.lpn_item_id, t.qty
    from public.wms_tx t join public.lpns l on l.id = t.lpn_id
    where t.kind = 'ISSUE' and t.requisition_id = any (p_from) and t.part_no = p_part
    -- กล่องที่ตัดล่าสุดก่อน (คำสั่งเดียวกันเวลาเท่ากัน ⇒ กล่องที่ตัดทีหลังคือกล่องที่ใหม่กว่า)
    order by t.created_at desc, l.created_at desc, l.lpn_no desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    -- รายการอาจย้ายไปกล่องใหม่หลังเบิก (รวมกล่อง) ⇒ คืนเข้ากล่องที่รายการอยู่ตอนนี้
    update public.lpn_items set qty = qty + v_take where id = r.lpn_item_id returning lpn_id into v_box;
    if v_box is null then raise exception 'ไม่พบรายการที่จะคืน %', p_part; end if;
    update public.lpns set status = 'active' where id = v_box and status = 'empty';
    select location_code into v_loc from public.lpns where id = v_box;
    insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, to_loc, ref, requisition_id, created_code)
    values ('RETURN', p_doc, v_box, r.lpn_item_id, p_part, v_take, v_loc, p_ref, p_req, public.my_code());
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'คืน % ได้ไม่ครบ (เกินยอดที่เบิกไว้ %)', p_part, v_left; end if;
end;
$$;

create or replace function public.requisition_void(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.requisitions;
  v_box uuid;
  v_loc text;
  r record;
begin
  perform public.require_perm('scan.issue');
  select * into v from public.requisitions where id = p_id and env = public.wms_env() for update;
  if v.id is null or v.status <> 'posted' then raise exception 'ไม่พบใบเบิก หรือยกเลิกไปแล้ว'; end if;
  if v.kind = 'fm005' then raise exception 'ยกเลิก FM-P-005 ไม่ได้ · แจ้งผู้ดูแลระบบ'; end if;
  if v.reconciled_by is not null then raise exception 'ใบนี้กระทบยอดกับ FM-P-005 แล้ว ยกเลิกไม่ได้'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ระบุเหตุผลที่ยกเลิก'; end if;
  for r in select * from public.wms_tx where kind = 'ISSUE' and requisition_id = p_id loop
    -- คืนเข้ากล่องที่รายการอยู่ตอนนี้ (อาจถูกรวมกล่องหลังเบิก)
    update public.lpn_items set qty = qty + r.qty where id = r.lpn_item_id returning lpn_id into v_box;
    if v_box is null then raise exception 'ไม่พบรายการที่จะคืน %', r.part_no; end if;
    update public.lpns set status = 'active' where id = v_box and status = 'empty';
    select location_code into v_loc from public.lpns where id = v_box;
    insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, to_loc, ref, reason, requisition_id, created_code)
    values ('RETURN', v.req_no, v_box, r.lpn_item_id, r.part_no, r.qty, v_loc, r.ref, 'ยกเลิกใบเบิก: ' || trim(p_reason), p_id, public.my_code());
  end loop;
  update public.requisitions set status = 'void', note = concat_ws(' · ', note, 'ยกเลิก: ' || trim(p_reason)) where id = p_id;
end;
$$;

-- ===================== B1 บรรทัด Invoice ไม่ซ้ำ =====================
-- บรรทัดที่ซ้ำทุกอย่าง (เลขบรรทัด + part + จำนวน) เก็บบรรทัดแรก · ไม่มีเลขบรรทัด หรือเลขชนกับบรรทัดอื่น ⇒ ให้เลขต่อจากเลขสูงสุด
create or replace function public.check_inv_lines(p jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  e record;
  v_out jsonb := '[]';
  v_seen text[] := '{}';
  v_used integer[] := '{}';
  v_max integer;
  v_no integer;
  v_part text;
  v_qty numeric;
  v_key text;
begin
  select coalesce(max(nullif(l ->> 'lineNo', '')::numeric::integer), 0) into v_max
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]' end) l;
  for e in
    select l, n from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]' end) with ordinality as x(l, n)
    where coalesce(trim(l ->> 'partNo'), '') <> ''
    order by n
  loop
    v_no := nullif(e.l ->> 'lineNo', '')::numeric::integer;
    v_part := public.part_canon(e.l ->> 'partNo');
    v_qty := greatest(coalesce(nullif(e.l ->> 'qty', '')::numeric, 0), 0);
    v_key := concat_ws('|', coalesce(v_no::text, '-'), v_part, v_qty::text);
    continue when v_key = any (v_seen);
    v_seen := v_seen || v_key;
    if v_no is null or v_no = any (v_used) then
      v_max := v_max + 1;
      v_no := v_max;
    end if;
    v_used := v_used || v_no;
    v_out := v_out || jsonb_build_array(jsonb_build_object('lineNo', v_no, 'partNo', v_part, 'description', coalesce(e.l ->> 'description', ''), 'qty', v_qty));
  end loop;
  return v_out;
end;
$$;

-- รับของตรง / ออก GRN จากใบตรวจรับ: ใส่บรรทัด Invoice ผ่าน check_inv_lines (นอกนั้นเหมือน 0021)
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
  v_case text;
  v_case_lpn uuid;
  v_counted numeric;
  v_damaged numeric;
  v_good numeric;
  v_ng_loc text;
begin
  perform public.require_perm('receive.create');
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการรับเข้า'; end if;
  if coalesce(v_pl ->> 'refDoc', '') = '' then raise exception 'ต้องมีเลขอ้างอิงของ Packing List'; end if;

  select customer_id, requires_inspection into v_customer, v_requires from public.product_models where code = v_model;
  v_customer := coalesce(v_customer, nullif(v_inv ->> 'customerId', ''));
  select array(select jsonb_array_elements_text(value)) into v_qi_types from public.app_settings where key = 'qi_part_types';
  -- พื้นที่กัก NG: ของเสียหายจากการตรวจรับแยกเป็นกล่องของตัวเองที่นี่ (ไม่มีพื้นที่ NG ⇒ อยู่กล่องเดียวกับของดีเหมือนเดิม)
  select code into v_ng_loc from public.locations where kind = 'ng' and active and not blocked order by code limit 1;

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
      -- บรรทัดซ้ำ / เลขบรรทัดชนกัน จัดให้เรียบร้อยก่อน (ไม่งั้นรับของล้มด้วย invoice_lines_pkey)
      from jsonb_array_elements(public.check_inv_lines(v_inv -> 'lines')) l;
    end if;
  end if;

  insert into public.packing_lists (ref_doc, so_no, packages, invoice_id, extraction)
  values (v_pl ->> 'refDoc', nullif(v_pl ->> 'soNo', ''), nullif(v_pl ->> 'packages', ''), v_invoice_id, v_pl -> 'extraction')
  returning id into v_pl_id;

  v_grn_no := public.next_doc_no('GRN');
  insert into public.grns (grn_no, packing_list_id, invoice_id, customer_id, model_code, receiver_code, note, replacement, check_id)
  values (v_grn_no, v_pl_id, v_invoice_id, v_customer, v_model, public.my_code(), nullif(p ->> 'note', ''),
          coalesce((p ->> 'replacement')::boolean, false), nullif(p ->> 'checkId', '')::uuid)
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_no := v_no + 1;
    v_counted := coalesce((v_line ->> 'countedQty')::numeric, 0);
    v_damaged := coalesce(nullif(v_line ->> 'damagedQty', '')::numeric, 0);
    if v_damaged < 0 or v_damaged <> trunc(v_damaged) or v_damaged > v_counted then
      raise exception 'จำนวนเสียหายของรายการที่ % ต้องเป็นจำนวนเต็ม 0 ถึง %', v_no, v_counted;
    end if;
    v_good := case when v_ng_loc is null then v_counted else v_counted - v_damaged end;
    select part_type into v_type from public.parts where part_no = v_line ->> 'partNo';
    v_needs := coalesce(coalesce(v_requires, true) and v_type = any (v_qi_types), false);
    v_zone := nullif(v_line ->> 'zoneId', '');
    v_case := nullif(upper(trim(coalesce(v_line ->> 'caseNo', ''))), '');
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

    insert into public.grn_lines (grn_id, line_no, part_no, description, part_type, pl_qty, counted_qty, invoice_qty, needs_qi, home_location, case_no, damaged_qty)
    values (v_grn_id, v_no, v_line ->> 'partNo', v_line ->> 'description', v_type,
            coalesce((v_line ->> 'plQty')::numeric, 0), (v_line ->> 'countedQty')::numeric, v_inv_qty, v_needs, v_home, v_case, v_damaged)
    returning id into v_line_id;

    if v_good > 0 then
      v_case_lpn := null;
      if v_case is not null and not v_needs then
        -- กล่องของเคสนี้ที่จุดรับของ (ไม่ใช่กล่อง NG ของเคสเดียวกัน)
        select id, lpn_no into v_case_lpn, v_lpn_no from public.lpns
        where grn_id = v_grn_id and case_no = v_case and not hold and status = 'active' and location_code = v_loc limit 1;
      end if;
      if v_case_lpn is null then
        v_lpn_no := public.next_doc_no('LPN');
        insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no) values (v_lpn_no, v_grn_id, v_loc, v_needs, v_case) returning id into v_lpn_id;
      else
        v_lpn_id := v_case_lpn;
      end if;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', v_good);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', v_good, v_loc, v_pl ->> 'refDoc', public.my_code());
    end if;
    -- ของเสียหาย: กล่อง NG แยก 1 กล่องต่อรายการ (เข้าคิว "NG รอส่งคืน" · ตัดยอดด้วยการเบิก NG ตอนส่งคืน)
    if v_ng_loc is not null and v_damaged > 0 then
      v_lpn_no := public.next_doc_no('LPN');
      insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no) values (v_lpn_no, v_grn_id, v_ng_loc, false, v_case) returning id into v_lpn_id;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', v_damaged);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, reason, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', v_damaged, v_ng_loc, v_pl ->> 'refDoc', 'เสียหายจากการตรวจรับ → NG', public.my_code());
    end if;
  end loop;

  return jsonb_build_object('grnId', v_grn_id, 'grnNo', v_grn_no, 'invoiceId', v_invoice_id);
end;
$$;

create or replace function public.check_complete(p_check uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  c public.receipt_checks;
  v_left integer;
  v_inv uuid;
  v_res jsonb;
  v_grn public.grns;
begin
  perform public.require_perm('receive.create');
  select * into c from public.receipt_checks where id = p_check and env = public.wms_env() for update;
  if c.id is null then raise exception 'ไม่พบใบตรวจรับ'; end if;
  if c.status <> 'open' then raise exception 'ใบตรวจรับนี้ปิดแล้ว'; end if;
  select count(*) into v_left from public.receipt_check_lines where check_id = p_check and actual_qty is null;
  if v_left > 0 then raise exception 'ยังตรวจไม่ครบ % รายการ', v_left; end if;
  if not exists (select 1 from public.receipt_check_lines where check_id = p_check and actual_qty > 0) then
    raise exception 'ไม่มีของที่นับได้เลย · ถ้าของไม่มาทั้งเที่ยวให้ยกเลิกใบตรวจรับ';
  end if;

  -- Invoice ที่มีในระบบแล้วแต่ยังไม่มีรายการ (เช่น AI อ่านได้แค่หัวเอกสาร): เติมรายการจากใบตรวจรับก่อนออก GRN
  if c.invoice_no is not null and jsonb_array_length(c.invoice_lines) > 0 then
    select id into v_inv from public.invoices where invoice_no = c.invoice_no and env = c.env;
    if v_inv is not null and not exists (select 1 from public.invoice_lines where invoice_id = v_inv) then
      insert into public.invoice_lines (invoice_id, line_no, part_no, description, qty)
      select v_inv, (l ->> 'lineNo')::integer, l ->> 'partNo', l ->> 'description', (l ->> 'qty')::numeric
      from jsonb_array_elements(public.check_inv_lines(c.invoice_lines)) l;
    end if;
  end if;

  v_res := public.create_grn(jsonb_build_object(
    'modelCode', c.model_code,
    'replacement', c.replacement,
    'note', c.note,
    'checkId', c.id,
    'packingList', jsonb_build_object('refDoc', c.pl_ref, 'soNo', c.so_no, 'packages', c.packages),
    'invoice', case when c.invoice_no is null then null else jsonb_build_object(
        'invoiceNo', c.invoice_no, 'customerId', c.customer_id, 'poNo', c.po_no, 'docDate', c.doc_date,
        'movementType', c.movement_type, 'lines', c.invoice_lines) end,
    'lines', (select jsonb_agg(jsonb_build_object(
        'caseNo', l.case_no, 'partNo', l.part_no, 'description', coalesce(l.description, ''),
        'plQty', l.pl_qty, 'countedQty', l.actual_qty, 'damagedQty', l.damaged_qty, 'zoneId', l.zone_id) order by l.line_no)
      from public.receipt_check_lines l where l.check_id = p_check)));

  select * into v_grn from public.grns where id = (v_res ->> 'grnId')::uuid;
  if coalesce(array_length(c.pl_images, 1), 0) > 0 then
    update public.packing_lists set image_paths = image_paths || c.pl_images where id = v_grn.packing_list_id;
  end if;
  if v_grn.invoice_id is not null and coalesce(array_length(c.inv_images, 1), 0) > 0 then
    update public.invoices set image_paths = image_paths || c.inv_images where id = v_grn.invoice_id and not (image_paths @> c.inv_images);
  end if;
  update public.receipt_checks set status = 'done', grn_id = v_grn.id, done_code = public.my_code(), done_at = now() where id = p_check;
  return jsonb_build_object('grnId', v_grn.id, 'grnNo', v_grn.grn_no);
end;
$$;
