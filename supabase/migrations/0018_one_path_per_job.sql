-- งานเดียว ทางเดียว
-- 1) สแกนเบิก = ใบเบิก (เข้าไลน์ / QC เบิก / ตัด NG) ที่ตัดจากกล่องที่สแกน
--    เดิมสแกนเบิกตัดยอดโดยไม่มีใบเบิก ⇒ ตอนเย็น FM-P-005 ไม่เห็นยอดนี้แล้วตัดซ้ำ
-- 2) ตรวจนับรายการในกล่อง (part) แล้วส่งขอปรับยอดต่อได้ทันที
-- 3) ช่องเก็บ: ผังกำหนดจำนวนช่อง · หลังบ้านปิดช่องชำรุด/เพิ่มช่องพิเศษ · บันทึกผังไม่ย้อนค่าที่หลังบ้านตั้ง

-- ===================== 1) สแกนเบิก = ใบเบิก =====================
-- p = { itemId, qty, kind: line|qc|ng, modelCode, docNo, toDept }
-- เลขใบเบิกเดียวกัน + ประเภท + Model + วันนี้ (ยังไม่กระทบ FM-P-005) ⇒ ต่อท้ายใบเดิม: 1 ใบกระดาษ = 1 ใบในระบบ
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

-- หน้าเว็บรุ่นเก่า (ก่อนกด refresh) ยังเรียกแบบเดิม ⇒ ส่งต่อเป็นใบเบิกเข้าไลน์ของ Model ตามใบรับสินค้าของกล่อง
create or replace function public.scan_issue(p_item uuid, p_qty numeric, p_ref text default null, p_note text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_model text;
begin
  select g.model_code into v_model from public.lpn_items i join public.lpns l on l.id = i.lpn_id left join public.grns g on g.id = l.grn_id where i.id = p_item;
  if v_model is null then raise exception 'กด refresh หน้าเว็บ แล้วเลือก Model ก่อนสแกนเบิก'; end if;
  return public.scan_issue_req(jsonb_build_object('itemId', p_item, 'qty', p_qty, 'kind', 'line', 'modelCode', v_model, 'docNo', p_ref, 'toDept', p_note)) ->> 'reqNo';
end;
$$;

-- ===================== 2) ตรวจนับรายการในกล่อง =====================
-- บันทึกการนับ (ไม่เปลี่ยนยอด) แล้วคืนส่วนต่าง · ถ้าไม่ตรง หน้าสแกนส่งขอปรับยอด (scan_adjust_request) ต่อทันที
create or replace function public.scan_count_item(p_item uuid, p_counted numeric)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.lpn_items;
  v_lpn public.lpns;
begin
  perform public.require_perm('scan.count');
  select * into v_item from public.lpn_items where id = p_item;
  select * into v_lpn from public.lpns where id = v_item.lpn_id and env = public.wms_env();
  if v_lpn.id is null then raise exception 'ไม่พบรายการในกล่อง'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'ใส่จำนวนที่นับได้'; end if;
  insert into public.wms_tx (kind, lpn_id, lpn_item_id, part_no, qty, new_qty, from_loc, created_code)
  values ('COUNT', v_lpn.id, v_item.id, v_item.part_no, v_item.qty, p_counted, v_lpn.location_code, public.my_code());
  return p_counted - v_item.qty;
end;
$$;

-- ===================== 3) ช่องเก็บ: ผัง vs หลังบ้าน =====================
alter table public.locations add column if not exists blocked boolean not null default false;
alter table public.locations add column if not exists manual boolean not null default false;
comment on column public.locations.blocked is 'ปิดใช้จากหน้าหลังบ้าน (เช่น ชำรุด) · บันทึกผังไม่เปิดคืน';
comment on column public.locations.manual is 'ช่องพิเศษที่เพิ่มในหน้าหลังบ้าน (ไม่ได้มาจากผัง) · บันทึกผังไม่ปิด';

-- เหมือน 0013 แต่: ไม่ปิดช่องพิเศษ และไม่เปิดช่องที่หลังบ้านปิดไว้
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
    where l.zone_id = p_zone and l.active and not l.manual and not (l.code = any (p_codes)) limit 10) b;
  if v_busy is not null then
    raise exception 'ช่อง % ยังมีของอยู่ — ย้ายของออกก่อนลดขนาดหรือจำนวนช่องของโซน', v_busy;
  end if;
  select string_agg(code, ', ') into v_busy from (
    select code from public.locations where code = any (p_codes) and zone_id <> p_zone and (active or manual or blocked) limit 10) b;
  if v_busy is not null then raise exception 'รหัสช่อง % ซ้ำกับโซนอื่น', v_busy; end if;

  update public.locations set active = false where zone_id = p_zone and active and not manual and not (code = any (p_codes));
  insert into public.locations (code, zone_id, kind, active)
  select c, p_zone, p_kind, true from unnest(p_codes) c
  on conflict (code) do update set zone_id = excluded.zone_id, kind = excluded.kind, active = not public.locations.blocked, manual = false;
end;
$$;
revoke execute on function public.sync_zone_locations(text, text[], text) from public, anon, authenticated;

-- หลังบ้าน: p_active = false ⇒ ปิดช่อง (ชำรุด) · true ⇒ เปิดคืน · รหัสใหม่ ⇒ ช่องพิเศษ
create or replace function public.master_upsert_location(p_code text, p_zone text, p_kind text, p_active boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  v_on boolean := coalesce(p_active, true);
  v_loc public.locations;
begin
  perform public.require_perm('master.edit');
  if coalesce(v_code, '') = '' then raise exception 'ต้องมีรหัสช่อง'; end if;
  select * into v_loc from public.locations where code = v_code for update;
  if v_loc.code is null then
    insert into public.locations (code, zone_id, kind, active, blocked, manual)
    values (v_code, p_zone, coalesce(p_kind, 'bin'), v_on, not v_on, true);
  elsif v_loc.active or v_loc.blocked or v_loc.manual then
    if v_loc.zone_id <> p_zone then raise exception 'รหัสช่อง % เป็นของโซนอื่นอยู่แล้ว', v_code; end if;
    update public.locations set active = v_on, blocked = not v_on, kind = coalesce(p_kind, kind) where code = v_code;
  elsif v_on then
    -- ช่องที่ผังไม่ใช้แล้ว (ลดจำนวนช่อง) ⇒ เปิดใหม่เป็นช่องพิเศษ
    update public.locations set zone_id = p_zone, kind = coalesce(p_kind, kind), active = true, blocked = false, manual = true where code = v_code;
  end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['scan_issue_req(jsonb)', 'scan_issue(uuid, numeric, text, text)', 'scan_count_item(uuid, numeric)', 'master_upsert_location(text, text, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
