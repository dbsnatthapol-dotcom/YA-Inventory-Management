-- Step 0.4 (ต่อ): ฟังก์ชันงานคลัง (รับของ → ป้าย → สแกน → กระทบยอด Invoice) และหลังบ้าน
-- โหมดทดลองแบ่งเป็น "รอบ": ล้างข้อมูลทดลอง = ขึ้นรอบใหม่ ข้อมูลรอบเก่าถูกซ่อนไว้ ไม่ลบทิ้ง (กู้คืนได้)
-- ทุกตารางรายการมีคอลัมน์ env = 'live' หรือ 'trial-<รอบ>' และ RLS ให้เห็นเฉพาะ env ปัจจุบัน

-- ===================== env ปัจจุบัน =====================
insert into public.app_settings (key, value) values ('trial_round', '1') on conflict (key) do nothing;

create or replace function public.wms_env()
returns text
language sql stable security definer set search_path = public
as $$
  select case when public.wms_trial()
    then 'trial-' || coalesce((select value #>> '{}' from public.app_settings where key = 'trial_round'), '1')
    else 'live' end
$$;

alter table public.invoices      add column env text not null default public.wms_env();
alter table public.packing_lists add column env text not null default public.wms_env();
alter table public.grns          add column env text not null default public.wms_env();
alter table public.lpns          add column env text not null default public.wms_env();
alter table public.wms_tx        add column env text not null default public.wms_env();

alter table public.invoices drop constraint invoices_invoice_no_trial_key;
alter table public.invoices add constraint invoices_invoice_no_env_key unique (invoice_no, env);
alter table public.grns drop constraint grns_grn_no_trial_key;
alter table public.grns add constraint grns_grn_no_env_key unique (grn_no, env);
alter table public.lpns drop constraint lpns_lpn_no_trial_key;
alter table public.lpns add constraint lpns_lpn_no_env_key unique (lpn_no, env);
create index lpns_location_idx on public.lpns (env, location_code) where status = 'active';

alter table public.doc_counters add column env text not null default 'live';
alter table public.doc_counters drop constraint doc_counters_pkey;
alter table public.doc_counters add primary key (prefix, yymm, env);

-- เห็นเฉพาะข้อมูลของ env ปัจจุบัน (สลับโหมดแล้วทุกเครื่องเห็นชุดเดียวกันทันที)
do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'packing_lists', 'grns', 'lpns', 'wms_tx'] loop
    execute format('alter policy "%s read by staff" on public.%I using (public.is_staff() and env = public.wms_env())', t, t);
  end loop;
end;
$$;
alter policy "invoice_lines read by staff" on public.invoice_lines
  using (public.is_staff() and exists (select 1 from public.invoices i where i.id = invoice_id));
alter policy "grn_lines read by staff" on public.grn_lines
  using (public.is_staff() and exists (select 1 from public.grns g where g.id = grn_id));
alter policy "lpn_items read by staff" on public.lpn_items
  using (public.is_staff() and exists (select 1 from public.lpns l where l.id = lpn_id));

-- ===================== สิทธิ์: ปิดด้วย allowed = false (ไม่ลบแถว) =====================
alter table public.role_permissions add column allowed boolean not null default true;

create or replace function public.has_perm(p_perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.staff_role() is null then false
    when public.staff_role() = 'admin' then true
    else exists (select 1 from public.role_permissions where role = public.staff_role() and perm = p_perm and allowed)
  end
$$;

create or replace function public.my_permissions()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when public.staff_role() = 'admin' then array['*']
    else coalesce((select array_agg(perm order by perm) from public.role_permissions where role = public.staff_role() and allowed), '{}')
  end
$$;

-- หัวหน้าโซน: เอาออกได้โดยตั้งเป็นว่าง
alter table public.zone_heads alter column staff_id drop not null;

create or replace function public.zone_head_list()
returns table (zone_id text, staff_id uuid, employee_code text, full_name text)
language sql stable security definer set search_path = public
as $$
  select h.zone_id, h.staff_id, s.employee_code, s.full_name
  from public.zone_heads h join public.staff_profiles s on s.id = h.staff_id
  where public.is_staff()
$$;

-- ===================== เลขเอกสาร =====================
create or replace function public.next_doc_no(p_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_yymm text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  v_env text := public.wms_env();
  v_n integer;
begin
  insert into public.doc_counters as c (prefix, yymm, trial, env, last) values (p_prefix, v_yymm, v_env <> 'live', v_env, 1)
  on conflict (prefix, yymm, env) do update set last = c.last + 1
  returning last into v_n;
  return p_prefix || '-' || v_yymm || '-' || lpad(v_n::text, case when p_prefix = 'LPN' then 6 else 4 end, '0');
end;
$$;

-- ===================== รับของ: สร้าง GRN จาก Packing List (+ Invoice) =====================
-- p jsonb = {
--   invoice: { invoiceNo, customerId, poNo, docDate, movementType, lines: [{lineNo, partNo, description, qty}], extraction },
--   packingList: { refDoc, soNo, packages, extraction },
--   modelCode, note,
--   lines: [{ partNo, description, plQty, countedQty }]
-- }
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

-- ===================== รวมหลายป้ายเป็นกล่องเดียว =====================
create or replace function public.merge_lpns(p_lpn_ids uuid[], p_location text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  v_new uuid;
  v_no text;
  v_first public.lpns;
begin
  perform public.require_perm('label.print');
  if coalesce(array_length(p_lpn_ids, 1), 0) < 2 then raise exception 'เลือกอย่างน้อย 2 ป้ายเพื่อรวม'; end if;
  select * into v_first from public.lpns where id = p_lpn_ids[1] and status = 'active' and env = v_env;
  if v_first.id is null then raise exception 'ไม่พบป้ายที่เลือก'; end if;
  if (select count(*) from public.lpns where id = any (p_lpn_ids) and status = 'active' and env = v_env) <> array_length(p_lpn_ids, 1) then
    raise exception 'มีป้ายที่ถูกรวมหรือใช้หมดไปแล้ว';
  end if;
  v_no := public.next_doc_no('LPN');
  insert into public.lpns (lpn_no, grn_id, location_code, hold)
  values (v_no, v_first.grn_id, coalesce(p_location, v_first.location_code), (select bool_or(hold) from public.lpns where id = any (p_lpn_ids)))
  returning id into v_new;
  update public.lpn_items set lpn_id = v_new where lpn_id = any (p_lpn_ids);
  update public.lpns set status = 'merged', merged_into = v_new where id = any (p_lpn_ids);
  insert into public.wms_tx (kind, doc_no, lpn_id, to_loc, ref, created_code)
  values ('MERGE', v_no, v_new, coalesce(p_location, v_first.location_code),
          (select string_agg(lpn_no, ', ' order by lpn_no) from public.lpns where id = any (p_lpn_ids)), public.my_code());
  return jsonb_build_object('lpnId', v_new, 'lpnNo', v_no);
end;
$$;

-- ===================== สแกน: จัดเก็บ / ย้ายที่ =====================
create or replace function public.scan_move(p_lpn uuid, p_to text, p_kind text default 'MOVE')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.lpns;
begin
  if p_kind not in ('PUT', 'MOVE') then raise exception 'ประเภทไม่ถูกต้อง'; end if;
  perform public.require_perm(case when p_kind = 'PUT' then 'scan.put' else 'scan.move' end);
  select * into v from public.lpns where id = p_lpn and status = 'active' and env = public.wms_env() for update;
  if v.id is null then raise exception 'ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว'; end if;
  if coalesce(trim(p_to), '') = '' then raise exception 'เลือกช่องปลายทาง'; end if;
  if upper(trim(p_to)) = v.location_code then raise exception 'กล่องอยู่ที่ช่องนี้แล้ว'; end if;
  update public.lpns set location_code = upper(trim(p_to)) where id = p_lpn;
  insert into public.wms_tx (kind, lpn_id, from_loc, to_loc, created_code) values (p_kind, p_lpn, v.location_code, upper(trim(p_to)), public.my_code());
end;
$$;

-- ===================== สแกน: เบิก / ตัดยอด =====================
create or replace function public.scan_issue(p_item uuid, p_qty numeric, p_ref text default null, p_note text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.lpn_items;
  v_lpn public.lpns;
  v_doc text;
begin
  perform public.require_perm('scan.issue');
  select * into v_item from public.lpn_items where id = p_item for update;
  select * into v_lpn from public.lpns where id = v_item.lpn_id and env = public.wms_env() for update;
  if v_lpn.id is null or v_lpn.status <> 'active' then raise exception 'ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว'; end if;
  if v_lpn.hold then raise exception 'เบิกไม่ได้ · กล่องนี้ยังไม่ผ่านการตรวจ MI3'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'ใส่จำนวนที่เบิก'; end if;
  if p_qty > v_item.qty then raise exception 'เบิกได้ไม่เกิน % ชิ้น', v_item.qty; end if;
  v_doc := public.next_doc_no('GI');
  update public.lpn_items set qty = qty - p_qty where id = p_item;
  insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, from_loc, to_loc, ref, created_code)
  values ('ISSUE', v_doc, v_lpn.id, p_item, v_item.part_no, p_qty, v_lpn.location_code, nullif(p_note, ''), nullif(p_ref, ''), public.my_code());
  if not exists (select 1 from public.lpn_items where lpn_id = v_lpn.id and qty > 0) then
    update public.lpns set status = 'empty' where id = v_lpn.id;
  end if;
  return v_doc;
end;
$$;

-- ===================== สแกน: ขอแก้ไขยอด → วิศวกรอนุมัติ =====================
create or replace function public.scan_adjust_request(p_item uuid, p_new_qty numeric, p_reason text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.lpn_items;
  v_doc text;
begin
  perform public.require_perm('scan.adjust');
  select i.* into v_item from public.lpn_items i join public.lpns l on l.id = i.lpn_id where i.id = p_item and l.env = public.wms_env();
  if v_item.id is null then raise exception 'ไม่พบรายการในกล่อง'; end if;
  if p_new_qty is null or p_new_qty < 0 then raise exception 'ใส่ยอดที่ถูกต้อง'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ระบุเหตุผลก่อนส่ง'; end if;
  if p_new_qty = v_item.qty then raise exception 'ยอดเท่าเดิม ไม่ต้องแก้ไข'; end if;
  if exists (select 1 from public.wms_tx where lpn_item_id = p_item and kind = 'ADJ' and status = 'pending') then
    raise exception 'มีคำขอแก้ไขยอดของรายการนี้รออนุมัติอยู่แล้ว';
  end if;
  v_doc := public.next_doc_no('ADJ');
  insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, new_qty, reason, status, created_code)
  values ('ADJ', v_doc, v_item.lpn_id, p_item, v_item.part_no, v_item.qty, p_new_qty, p_reason, 'pending', public.my_code());
  return v_doc;
end;
$$;

create or replace function public.scan_adjust_decide(p_tx uuid, p_approve boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.wms_tx;
begin
  perform public.require_perm('scan.adjust.approve');
  select * into v from public.wms_tx where id = p_tx and kind = 'ADJ' and env = public.wms_env() for update;
  if v.id is null or v.status <> 'pending' then raise exception 'รายการนี้ถูกพิจารณาไปแล้ว'; end if;
  if v.created_by = auth.uid() then raise exception 'อนุมัติรายการของตัวเองไม่ได้'; end if;
  if p_approve then
    update public.lpn_items set qty = v.new_qty where id = v.lpn_item_id;
    update public.lpns l set status = case when exists (select 1 from public.lpn_items where lpn_id = l.id and qty > 0) then 'active' else 'empty' end
    where l.id = v.lpn_id and l.status in ('active', 'empty');
  end if;
  update public.wms_tx set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_code = public.my_code(), decided_at = now()
  where id = p_tx;
end;
$$;

-- ===================== สแกน: ตรวจนับ =====================
create or replace function public.scan_count(p_lpn uuid, p_counted numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_sys numeric;
begin
  perform public.require_perm('scan.count');
  if p_counted is null or p_counted < 0 then raise exception 'ใส่จำนวนที่นับได้'; end if;
  if not exists (select 1 from public.lpns where id = p_lpn and env = public.wms_env()) then raise exception 'ไม่พบป้าย'; end if;
  select coalesce(sum(qty), 0) into v_sys from public.lpn_items where lpn_id = p_lpn;
  insert into public.wms_tx (kind, lpn_id, qty, new_qty, created_code) values ('COUNT', p_lpn, v_sys, p_counted, public.my_code());
  return p_counted - v_sys;
end;
$$;

-- ===================== สแกน: ผลตรวจ MI3 =====================
create or replace function public.scan_qi(p_lpn uuid, p_pass numeric, p_ng numeric, p_note text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.lpns;
  v_item public.lpn_items;
  v_total numeric;
  v_doc text;
begin
  perform public.require_perm('scan.qi');
  select * into v from public.lpns where id = p_lpn and status = 'active' and env = public.wms_env() for update;
  if v.id is null then raise exception 'ไม่พบป้าย'; end if;
  if not v.hold then raise exception 'กล่องนี้ไม่ต้องตรวจ หรือผ่านการตรวจแล้ว'; end if;
  if (select count(*) from public.lpn_items where lpn_id = p_lpn) <> 1 then raise exception 'บันทึกผลตรวจได้ทีละ part · แยกกล่องก่อน'; end if;
  select * into v_item from public.lpn_items where lpn_id = p_lpn;
  v_total := v_item.qty;
  if coalesce(p_pass, -1) < 0 or coalesce(p_ng, -1) < 0 or p_pass + p_ng <> v_total then
    raise exception 'ผ่าน + NG ต้องเท่ากับ % ชิ้น', v_total;
  end if;
  v_doc := public.next_doc_no('QI');
  update public.lpn_items set qty = p_pass where id = v_item.id;
  update public.lpns set hold = false, status = case when p_pass > 0 then 'active' else 'empty' end where id = p_lpn;
  insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, pass_qty, ng_qty, reason, created_code)
  values ('QI', v_doc, p_lpn, v_item.id, v_item.part_no, v_total, p_pass, p_ng, nullif(p_note, ''), public.my_code());
  return v_doc;
end;
$$;

-- ===================== Invoice: ปิดว่ารับครบ / แจ้งความต่าง =====================
create or replace function public.invoice_set_status(p_invoice uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_status in ('complete', 'closed', 'open') then perform public.require_perm('invoice.close');
  elsif p_status = 'discrepancy_reported' then perform public.require_perm('invoice.report');
  else raise exception 'สถานะไม่ถูกต้อง'; end if;
  update public.invoices set status = p_status, status_note = nullif(p_note, ''), status_by = auth.uid(), status_at = now()
  where id = p_invoice and env = public.wms_env();
  if not found then raise exception 'ไม่พบ Invoice'; end if;
end;
$$;

-- ===================== หลังบ้าน (admin) =====================
create or replace function public.admin_only()
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if public.staff_role() is distinct from 'admin' then raise exception 'เฉพาะผู้ดูแลระบบ' using errcode = '42501'; end if;
end;
$$;

create or replace function public.admin_set_permission(p_role text, p_perm text, p_allowed boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.admin_only();
  insert into public.role_permissions (role, perm, allowed) values (p_role, p_perm, p_allowed)
  on conflict (role, perm) do update set allowed = excluded.allowed;
end;
$$;

create or replace function public.admin_set_zone_head(p_zone text, p_staff uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.admin_only();
  insert into public.zone_heads (zone_id, staff_id) values (p_zone, p_staff)
  on conflict (zone_id) do update set staff_id = excluded.staff_id, updated_at = now();
end;
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.admin_only();
  if p_key not in ('wms_mode', 'qi_part_types') then raise exception 'ไม่รู้จักค่าตั้ง %', p_key; end if;
  if p_key = 'wms_mode' and p_value #>> '{}' not in ('trial', 'live') then raise exception 'โหมดต้องเป็น trial หรือ live'; end if;
  insert into public.app_settings (key, value, updated_at, updated_by) values (p_key, p_value, now(), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
end;
$$;

-- เริ่มรอบทดลองใหม่: ข้อมูลทดลองรอบก่อนถูกซ่อน (ไม่ลบ) และเลขเอกสารทดลองเริ่มนับใหม่
create or replace function public.admin_new_trial_round()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_round integer;
begin
  perform public.admin_only();
  update public.app_settings set value = to_jsonb(coalesce((value #>> '{}')::integer, 1) + 1), updated_at = now(), updated_by = auth.uid()
  where key = 'trial_round'
  returning (value #>> '{}')::integer into v_round;
  return v_round;
end;
$$;

-- ข้อมูลหลัก: เพิ่ม/แก้ part (Model เพิ่มได้อย่างเดียว เพื่อไม่ให้ประวัติเดิมหลุด) และช่องเก็บ
create or replace function public.master_upsert_part(p_part_no text, p_name text, p_type text, p_customer text, p_models text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.require_perm('master.edit');
  if coalesce(trim(p_part_no), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'ต้องมี Part No. และชื่อ'; end if;
  insert into public.parts (part_no, name, part_type, customer_id) values (trim(p_part_no), trim(p_name), nullif(upper(trim(p_type)), ''), p_customer)
  on conflict (part_no) do update set name = excluded.name, part_type = excluded.part_type, customer_id = excluded.customer_id
  returning id into v_id;
  insert into public.part_models (part_id, model_code) select v_id, unnest(coalesce(p_models, '{}')) on conflict do nothing;
end;
$$;

create or replace function public.master_upsert_location(p_code text, p_zone text, p_kind text, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('master.edit');
  if coalesce(trim(p_code), '') = '' then raise exception 'ต้องมีรหัสช่อง'; end if;
  insert into public.locations (code, zone_id, kind, active) values (upper(trim(p_code)), p_zone, coalesce(p_kind, 'bin'), coalesce(p_active, true))
  on conflict (code) do update set zone_id = excluded.zone_id, kind = excluded.kind, active = excluded.active;
end;
$$;

create or replace function public.master_set_zone_rule(p_customer text, p_type text, p_zone text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('master.edit');
  insert into public.zone_rules (customer_id, part_type, zone_id) values (p_customer, nullif(upper(trim(p_type)), ''), p_zone)
  on conflict (customer_id, part_type) do update set zone_id = excluded.zone_id;
end;
$$;

-- ===================== สิทธิ์เรียกฟังก์ชัน =====================
do $$
declare
  f text;
begin
  foreach f in array array[
    'has_perm(text)', 'my_permissions()', 'wms_trial()', 'wms_env()', 'zone_head_list()', 'staff_directory()', 'next_doc_no(text)',
    'require_perm(text)', 'my_code()', 'create_grn(jsonb)', 'merge_lpns(uuid[], text)', 'scan_move(uuid, text, text)',
    'scan_issue(uuid, numeric, text, text)', 'scan_adjust_request(uuid, numeric, text)', 'scan_adjust_decide(uuid, boolean)',
    'scan_count(uuid, numeric)', 'scan_qi(uuid, numeric, numeric, text)', 'invoice_set_status(uuid, text, text)',
    'admin_only()', 'admin_set_permission(text, text, boolean)', 'admin_set_zone_head(text, uuid)', 'admin_set_setting(text, jsonb)',
    'admin_new_trial_round()', 'master_upsert_part(text, text, text, text, text[])', 'master_upsert_location(text, text, text, boolean)',
    'master_set_zone_rule(text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
