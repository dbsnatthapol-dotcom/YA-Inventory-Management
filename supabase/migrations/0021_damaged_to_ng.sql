-- 0021: ของเสียหายที่พบตอนตรวจรับแยกเป็นกล่อง NG อัตโนมัติ (พื้นที่กัก NG → คิว "NG รอส่งคืน")
--       เบิกเข้าไลน์ / QC / FM-P-005 ไม่ตัดจากกล่องในพื้นที่ NG · ใบเบิก NG ตัดจากพื้นที่ NG ก่อน
--       สแกนเบิกเข้าไลน์จากกล่องในพื้นที่ NG ไม่ได้
-- เพิ่มคอลัมน์และแก้ฟังก์ชันเท่านั้น (ไม่ลบตาราง/ข้อมูล)

-- จำนวนเสียหายที่พบตอนตรวจรับ (นับรวมอยู่ใน counted_qty · แยกไปกล่อง NG)
alter table public.grn_lines add column if not exists damaged_qty numeric not null default 0 check (damaged_qty >= 0);

-- ===================== 1) รับของ: ของเสียหายแยกกล่อง NG =====================
-- เหมือน 0020 + lines[].damagedQty: ของดี (นับได้ − เสียหาย) เข้ากล่องตามเคส/MI3 เหมือนเดิม · ของเสียหายเข้ากล่องใหม่ที่พื้นที่กัก NG
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
      from jsonb_array_elements(coalesce(v_inv -> 'lines', '[]')) l;
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

-- ใบตรวจรับ: ส่งจำนวนเสียหายของแต่ละบรรทัดไปด้วย (เหมือน 0020)
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
      from jsonb_array_elements(c.invoice_lines) l;
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

-- ===================== 2) เบิกตาม FIFO ไม่ตัดของ NG เข้าไลน์ =====================
-- เหมือน 0014 + ข้ามกล่องในพื้นที่กัก NG (ยกเว้นใบเบิก NG ที่ตัดจากพื้นที่ NG ก่อน)
create or replace function public.wms_issue_fifo(p_req uuid, p_doc text, p_ref text, p_part text, p_qty numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_left numeric := p_qty;
  v_have numeric;
  v_take numeric;
  -- ใบเบิก NG ตัดจากพื้นที่กัก NG ก่อน · ใบอื่น (เข้าไลน์ / QC / FM-P-005) ไม่แตะของในพื้นที่ NG
  v_ng boolean := coalesce((select kind = 'ng' from public.requisitions where id = p_req), false);
  r record;
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  select coalesce(sum(i.qty), 0) into v_have
  from public.lpn_items i join public.lpns l on l.id = i.lpn_id left join public.locations lo on lo.code = l.location_code
  where i.part_no = p_part and i.qty > 0 and l.status = 'active' and not l.hold and l.env = public.wms_env()
    and (v_ng or lo.kind is distinct from 'ng');
  if v_have < p_qty then
    raise exception 'สต็อก % ไม่พอ · พร้อมเบิก % ขอเบิก %', p_part, v_have, p_qty;
  end if;
  for r in
    select i.id as item_id, i.qty, l.id as lpn_id, l.location_code
    from public.lpn_items i join public.lpns l on l.id = i.lpn_id left join public.locations lo on lo.code = l.location_code
    where i.part_no = p_part and i.qty > 0 and l.status = 'active' and not l.hold and l.env = public.wms_env()
      and (v_ng or lo.kind is distinct from 'ng')
    order by (lo.kind is distinct from 'ng'), l.created_at, l.lpn_no
    for update of i, l
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    update public.lpn_items set qty = qty - v_take where id = r.item_id;
    insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, from_loc, ref, requisition_id, created_code)
    values ('ISSUE', p_doc, r.lpn_id, r.item_id, p_part, v_take, r.location_code, p_ref, p_req, public.my_code());
    if not exists (select 1 from public.lpn_items where lpn_id = r.lpn_id and qty > 0) then
      update public.lpns set status = 'empty' where id = r.lpn_id;
    end if;
    v_left := v_left - v_take;
  end loop;
end;
$$;

-- ===================== 3) สแกนเบิก: ของในพื้นที่ NG เข้าไลน์ไม่ได้ =====================
-- เหมือน 0018 + ตรวจพื้นที่ของกล่อง
create or replace function public.scan_issue_req(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.lpn_items;
  v_lpn public.lpns;
  v_qty numeric := nullif(p ->> 'qty', '')::numeric;
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'line');
  v_model text := nullif(upper(trim(p ->> 'modelCode')), '');
  v_doc text := nullif(trim(p ->> 'docNo'), '');
  v_to text := nullif(trim(p ->> 'toDept'), '');
  v_day date := (now() at time zone 'Asia/Bangkok')::date;
  v_req public.requisitions;
  v_models text[];
  v_appended boolean := false;
  v_line integer;
begin
  perform public.require_perm('scan.issue');
  if v_kind not in ('line', 'qc', 'ng') then raise exception 'เลือกว่าเบิกไปไหน (เข้าไลน์ / QC เบิก / NG)'; end if;
  if v_kind = 'line' and v_model is null then raise exception 'เลือก Model ที่เบิกเข้าไลน์'; end if;
  if v_model is not null and not exists (select 1 from public.product_models where code = v_model) then
    raise exception 'ไม่รู้จัก Model %', v_model;
  end if;
  select * into v_item from public.lpn_items where id = (p ->> 'itemId')::uuid for update;
  select * into v_lpn from public.lpns where id = v_item.lpn_id and env = public.wms_env() for update;
  if v_lpn.id is null or v_lpn.status <> 'active' then raise exception 'ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว'; end if;
  if v_lpn.hold then raise exception 'เบิกไม่ได้ · กล่องนี้ยังไม่ผ่านการตรวจ MI3'; end if;
  -- ของในพื้นที่กัก NG ห้ามเข้าไลน์ (เบิก NG / ส่งคืน หรือ QC ได้)
  if v_kind = 'line' and exists (select 1 from public.locations where code = v_lpn.location_code and kind = 'ng') then
    raise exception 'เบิกเข้าไลน์ไม่ได้ · กล่องนี้อยู่พื้นที่กัก NG (เบิกได้เฉพาะ NG / ส่งคืน หรือ QC)';
  end if;
  if v_qty is null or v_qty <= 0 then raise exception 'ใส่จำนวนที่เบิก'; end if;
  if v_qty > v_item.qty then raise exception 'เบิกได้ไม่เกิน % ชิ้น', v_item.qty; end if;
  -- part ต้องอยู่ใน Model ที่เลือก (ถ้า part ผูก Model ไว้) ไม่งั้น FM-P-005 ของ Model จริงจะไม่เห็นใบนี้
  if v_model is not null then
    select array_agg(m.model_code order by m.model_code) into v_models
    from public.parts x join public.part_models m on m.part_id = x.id where x.part_no = v_item.part_no;
    if v_models is not null and not (v_model = any (v_models)) then
      raise exception '% ไม่ได้อยู่ใน Model % (อยู่ใน %)', v_item.part_no, v_model, array_to_string(v_models, ', ');
    end if;
    if public.month_closed(v_model, v_day) then
      raise exception 'บัญชีคุม % เดือน % ปิดยอดแล้ว · ให้ผู้มีสิทธิ์เปิดเดือนก่อน', v_model, to_char(v_day, 'YYYY-MM');
    end if;
  end if;

  if v_doc is not null then
    select * into v_req from public.requisitions
    where env = public.wms_env() and kind = v_kind and doc_no = v_doc and doc_date = v_day
      and model_code is not distinct from v_model and status = 'posted' and reconciled_by is null
    order by created_at desc limit 1
    for update;
    v_appended := v_req.id is not null;
  end if;
  if v_req.id is null then
    insert into public.requisitions (kind, req_no, doc_no, doc_date, model_code, to_dept, note, created_code)
    values (v_kind, public.next_doc_no('RQ'), v_doc, v_day, v_model, v_to, 'สแกนเบิกจากกล่อง', public.my_code())
    returning * into v_req;
  end if;

  update public.lpn_items set qty = qty - v_qty where id = v_item.id;
  insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, from_loc, to_loc, ref, requisition_id, created_code)
  values ('ISSUE', v_req.req_no, v_lpn.id, v_item.id, v_item.part_no, v_qty, v_lpn.location_code, coalesce(v_to, v_req.to_dept),
          coalesce(v_req.doc_no, v_req.req_no), v_req.id, public.my_code());
  if not exists (select 1 from public.lpn_items where lpn_id = v_lpn.id and qty > 0) then
    update public.lpns set status = 'empty' where id = v_lpn.id;
  end if;

  -- 1 part = 1 บรรทัดในใบ (สแกนหลายกล่องของ part เดียวกัน ⇒ รวมในบรรทัดเดิม)
  update public.requisition_lines set qty = qty + v_qty, req_qty = coalesce(req_qty, 0) + v_qty, balance = public.part_on_hand(v_item.part_no)
  where req_id = v_req.id and part_no = v_item.part_no;
  if not found then
    select coalesce(max(line_no), 0) + 1 into v_line from public.requisition_lines where req_id = v_req.id;
    insert into public.requisition_lines (req_id, line_no, part_no, req_qty, qty, balance)
    values (v_req.id, v_line, v_item.part_no, v_qty, v_qty, public.part_on_hand(v_item.part_no));
  end if;
  return jsonb_build_object('id', v_req.id, 'reqNo', v_req.req_no, 'docNo', v_req.doc_no, 'appended', v_appended);
end;
$$;
