-- 0025: ชุดเก็บกวาดจากการตรวจระบบ (docs/known-issues.md A11 A12 D1 D3 D4) · ไม่ลบข้อมูล ไม่ลบตาราง/นโยบาย
--   A11 นับ / ขอปรับยอดได้เฉพาะกล่องที่ยังใช้งาน (กล่องของใบรับที่ยกเลิก หรือกล่องที่ถูกรวมไปแล้ว ทำไม่ได้)
--       กล่องที่ "ใช้หมดแล้ว" ยังนับได้ (เจอของในกล่อง → ขอปรับยอด → อนุมัติแล้วเปิดกล่อง · กติกาเดียวกับ scan_adjust_decide 0022)
--   A12 ด่านสุดท้ายที่ตาราง: จำนวนในกล่อง / รายการเคลื่อนไหว / ใบเบิก / บรรทัดรับ ต้องเป็นจำนวนเต็ม (ชิ้น)
--       ใบเบิกเข้าไลน์ต้องมี Model (ไม่งั้นกระทบ FM-P-005 ไม่ได้ ⇒ ตัดซ้ำ) · แก้แถวเดิมตรวจเฉพาะช่องที่เปลี่ยน
--   D1 ถอนสิทธิ์เขียนตารางข้อมูลหลักตรง ๆ (หน้าเว็บใช้คำสั่งที่ตรวจสิทธิ์ "แก้ข้อมูลหลัก" อยู่แล้ว) · ใช้ revoke ไม่ลบนโยบาย
--   D3 ฟังก์ชันภายใน (ออกเลขเอกสาร / อ่านยอดคงคลัง / ยอดปิดเดือน) เรียกตรงจากหน้าเว็บไม่ได้ · ใช้ผ่านคำสั่งที่ตรวจสิทธิ์เท่านั้น
--   D4 บันทึกใบตรวจรับต้องส่งเลขรุ่นของรายการมาเสมอ (เดิมส่งค่าว่างแล้วข้ามการกันบันทึกทับได้)
--       (รวมกล่องพร้อมกันสองเครื่อง: ล็อกกล่องแล้วตั้งแต่ 0022)

-- ===================== A11 =====================
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
  if v_lpn.status not in ('active', 'empty') then
    raise exception 'กล่อง % %แล้ว · นับได้เฉพาะกล่องที่ใช้งานอยู่', v_lpn.lpn_no, case v_lpn.status when 'void' then 'ถูกยกเลิก (ยกเลิกใบรับ)' else 'ถูกรวมเข้ากล่องอื่น' end;
  end if;
  if p_counted is null or p_counted < 0 or p_counted <> trunc(p_counted) then raise exception 'ใส่จำนวนที่นับได้ (จำนวนเต็ม)'; end if;
  insert into public.wms_tx (kind, lpn_id, lpn_item_id, part_no, qty, new_qty, from_loc, created_code)
  values ('COUNT', v_lpn.id, v_item.id, v_item.part_no, v_item.qty, p_counted, v_lpn.location_code, public.my_code());
  return p_counted - v_item.qty;
end;
$$;

create or replace function public.scan_adjust_request(p_item uuid, p_new_qty numeric, p_reason text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_item public.lpn_items;
  v_lpn public.lpns;
  v_doc text;
begin
  perform public.require_perm('scan.adjust');
  select i.* into v_item from public.lpn_items i join public.lpns l on l.id = i.lpn_id where i.id = p_item and l.env = public.wms_env();
  if v_item.id is null then raise exception 'ไม่พบรายการในกล่อง'; end if;
  select * into v_lpn from public.lpns where id = v_item.lpn_id;
  if v_lpn.status not in ('active', 'empty') then
    raise exception 'กล่อง % %แล้ว · ขอปรับยอดได้เฉพาะกล่องที่ใช้งานอยู่', v_lpn.lpn_no, case v_lpn.status when 'void' then 'ถูกยกเลิก (ยกเลิกใบรับ)' else 'ถูกรวมเข้ากล่องอื่น' end;
  end if;
  if p_new_qty is null or p_new_qty < 0 or p_new_qty <> trunc(p_new_qty) then raise exception 'ใส่ยอดที่ถูกต้อง (จำนวนเต็ม)'; end if;
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

-- ===================== A12 =====================
-- ช่องจำนวนที่ส่งชื่อมาทาง tg_argv ต้องเป็นจำนวนเต็ม · แก้แถวเดิมตรวจเฉพาะช่องที่เปลี่ยน (ข้อมูลเก่าไม่ทำให้รายการอื่นล้ม)
create or replace function public.wms_whole_qty()
returns trigger
language plpgsql set search_path = public
as $$
declare
  k text;
  v numeric;
  j jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  foreach k in array tg_argv loop
    v := (j ->> k)::numeric;
    continue when v is null or v = trunc(v) or (o is not null and (o ->> k) is not distinct from (j ->> k));
    raise exception 'จำนวนต้องเป็นจำนวนเต็ม (ชิ้น) · ได้ %', v using errcode = '22023';
  end loop;
  return new;
end;
$$;

create or replace function public.requisition_needs_model()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.kind = 'line' and new.model_code is null then
    raise exception 'ใบเบิกเข้าไลน์ต้องระบุ Model (ไม่งั้นกระทบ FM-P-005 ไม่ได้)' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- สร้างครั้งเดียว (ไม่ใช้ drop)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_lpn_items_whole_qty' and tgrelid = 'public.lpn_items'::regclass) then
    create trigger trg_lpn_items_whole_qty before insert or update on public.lpn_items
      for each row execute function public.wms_whole_qty('qty');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_wms_tx_whole_qty' and tgrelid = 'public.wms_tx'::regclass) then
    create trigger trg_wms_tx_whole_qty before insert or update on public.wms_tx
      for each row execute function public.wms_whole_qty('qty', 'new_qty', 'pass_qty', 'ng_qty');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_requisition_lines_whole_qty' and tgrelid = 'public.requisition_lines'::regclass) then
    create trigger trg_requisition_lines_whole_qty before insert or update on public.requisition_lines
      for each row execute function public.wms_whole_qty('qty', 'req_qty');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_grn_lines_whole_qty' and tgrelid = 'public.grn_lines'::regclass) then
    create trigger trg_grn_lines_whole_qty before insert or update on public.grn_lines
      for each row execute function public.wms_whole_qty('counted_qty', 'damaged_qty');
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_requisitions_need_model' and tgrelid = 'public.requisitions'::regclass) then
    create trigger trg_requisitions_need_model before insert on public.requisitions
      for each row execute function public.requisition_needs_model();
  end if;
end;
$$;

-- ===================== D1 =====================
-- ตารางข้อมูลหลักแก้ผ่านคำสั่งที่ตรวจสิทธิ์เท่านั้น (master_save_part / master_upsert_location / master_set_zone_rule …) · อ่านได้เหมือนเดิม
revoke insert, update, delete on public.customers, public.locations, public.part_models, public.parts, public.product_models, public.suppliers, public.zone_rules
  from anon, authenticated;

-- ===================== D3 =====================
revoke all on function public.next_doc_no(text) from public, anon, authenticated;
revoke all on function public.part_on_hand(text) from public, anon, authenticated;
revoke all on function public.ledger_month_totals(text, text) from public, anon, authenticated;
revoke all on function public.count_system_qty(text[], text) from public, anon, authenticated;
revoke all on function public.count_locations(text) from public, anon, authenticated;
revoke all on function public.month_closed(text, date) from public, anon, authenticated;

-- ===================== D4 =====================
-- บันทึกบรรทัดใบตรวจรับ: เหมือน 0020 + ต้องส่งเลขรุ่นมาเสมอ
create or replace function public.check_line_save(p_line uuid, p_version integer, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.receipt_check_lines;
  v_check uuid;
  v_status text;
  v_actual numeric;
  v_damaged numeric;
  v_pl numeric;
  v_zone text;
begin
  perform public.require_perm('receive.create');
  -- ล็อกใบก่อนบรรทัดเสมอ (ลำดับเดียวกับ check_case_save / check_complete จึงไม่ติดรอกัน)
  -- ระหว่างปิดใบ: รอให้เสร็จก่อน แล้วจะเห็นว่าปิดแล้ว
  select check_id into v_check from public.receipt_check_lines where id = p_line;
  select status into v_status from public.receipt_checks where id = v_check and env = public.wms_env() for share;
  if v_status is null then raise exception 'ไม่พบรายการตรวจรับ'; end if;
  if v_status <> 'open' then raise exception 'ใบตรวจรับนี้ปิดแล้ว'; end if;
  select * into v from public.receipt_check_lines where id = p_line for update;
  -- D4: ต้องส่งเลขรุ่นของรายการมาเสมอ (เดิมส่งค่าว่างแล้วข้ามการกันบันทึกทับได้)
  if p_version is null or v.version <> p_version then raise exception 'รายการนี้มีคนบันทึกไปก่อนแล้ว · โหลดใหม่แล้วตรวจอีกครั้ง'; end if;

  v_actual := case when p ? 'actual' then nullif(p ->> 'actual', '')::numeric else v.actual_qty end;
  v_damaged := case when p ? 'damaged' then coalesce(nullif(p ->> 'damaged', '')::numeric, 0) else v.damaged_qty end;
  v_pl := case when p ? 'plQty' then coalesce(nullif(p ->> 'plQty', '')::numeric, 0) else v.pl_qty end;
  v_zone := case when p ? 'zoneId' then nullif(p ->> 'zoneId', '') else v.zone_id end;
  if v_actual is not null and (v_actual < 0 or v_actual <> trunc(v_actual)) then raise exception 'จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ'; end if;
  if v_damaged < 0 or v_damaged <> trunc(v_damaged) then raise exception 'จำนวนเสียหายต้องเป็นจำนวนเต็มไม่ติดลบ'; end if;
  if v_pl < 0 or v_pl <> trunc(v_pl) then raise exception 'จำนวนใน Packing List ต้องเป็นจำนวนเต็มไม่ติดลบ'; end if;
  if v_actual is null then v_damaged := 0; end if;
  if v_damaged > coalesce(v_actual, 0) then raise exception 'จำนวนเสียหายมากกว่าที่นับได้'; end if;
  if p ? 'partNo' and coalesce(trim(p ->> 'partNo'), '') = '' then raise exception 'ใส่ Part No.'; end if;
  if v_zone is not null and not exists (select 1 from public.zones where id = v_zone) then raise exception 'ไม่พบโซน %', v_zone; end if;

  update public.receipt_check_lines set
    actual_qty = v_actual,
    damaged_qty = v_damaged,
    pl_qty = v_pl,
    zone_id = v_zone,
    note = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
    photos = case when jsonb_typeof(p -> 'photos') = 'array' then array(select jsonb_array_elements_text(p -> 'photos')) else photos end,
    part_no = case when p ? 'partNo' then public.part_canon(p ->> 'partNo') else part_no end,
    description = case when p ? 'description' then nullif(trim(p ->> 'description'), '')
                       when p ? 'partNo' then coalesce((select name from public.parts where part_no = public.part_canon(p ->> 'partNo')), description)
                       else description end,
    case_no = case when p ? 'caseNo' then coalesce(upper(trim(p ->> 'caseNo')), '') else case_no end,
    checked_by = case when not p ? 'actual' then checked_by when v_actual is null then null else auth.uid() end,
    checked_code = case when not p ? 'actual' then checked_code when v_actual is null then null else public.my_code() end,
    checked_at = case when not p ? 'actual' then checked_at when v_actual is null then null else now() end,
    version = version + 1
  where id = p_line
  returning * into v;
  return to_jsonb(v);
end;
$$;

-- ฟังก์ชันของ trigger เรียกตรงไม่ได้อยู่แล้ว · ถอนสิทธิ์ไว้ให้รายการสิทธิ์สะอาด
revoke all on function public.wms_whole_qty() from public, anon, authenticated;
revoke all on function public.requisition_needs_model() from public, anon, authenticated;
