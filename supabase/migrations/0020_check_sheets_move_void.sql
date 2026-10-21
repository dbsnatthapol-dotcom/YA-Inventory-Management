-- 0020: ใบตรวจรับจาก Packing List (ตรวจทีละเคส หลายคนพร้อมกัน) · 1 เคส = 1 กล่อง
--       ย้ายหลายกล่องโดยเลือกจากรายการ (ไม่ต้องสแกน) · ยกเลิกใบรับ · บัญชีคุมไม่ถูกตัดที่ 1,000 แถว
-- เพิ่มคอลัมน์ ตาราง และฟังก์ชันเท่านั้น (ไม่ลบตาราง/ข้อมูล)

-- ===================== 1) คอลัมน์ใหม่ =====================
-- เลขเคส/พาเลทจาก Packing List (ป้ายของผู้ส่งที่ติดมากับของ)
alter table public.lpns add column if not exists case_no text;
alter table public.grn_lines add column if not exists case_no text;
-- ย้ายผ่านหน้าสแกน (scan) หรือเลือกจากรายการ (list) · รายการเก่าว่าง
alter table public.wms_tx add column if not exists via text check (via in ('scan', 'list'));
-- ยกเลิกใบรับ: เลขใบไม่ถูกนำกลับมาใช้ · กล่องของใบนั้นเป็น void · บัญชีคุมไม่นับรับเข้าของใบนี้
alter table public.grns add column if not exists status text not null default 'active' check (status in ('active', 'void'));
alter table public.grns add column if not exists void_reason text;
alter table public.grns add column if not exists voided_by uuid references auth.users (id);
alter table public.grns add column if not exists voided_code text;
alter table public.grns add column if not exists voided_at timestamptz;

-- ===================== 2) ใบตรวจรับ =====================
create table if not exists public.receipt_checks (
  id              uuid primary key default gen_random_uuid(),
  env             text not null default public.wms_env(),
  check_no        text not null,
  status          text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  model_code      text references public.product_models (code),
  customer_id     text references public.customers (id),
  replacement     boolean not null default false,
  pl_ref          text not null,
  so_no           text,
  packages        text,
  title           text,
  invoice_no      text,
  po_no           text,
  doc_date        date,
  movement_type   text,
  -- รายการใน Invoice [{lineNo, partNo, description, qty}] (AI อ่าน หรือกรอกเองเมื่อ AI อ่านไม่ได้)
  invoice_lines   jsonb not null default '[]',
  pl_images       text[] not null default '{}',
  inv_images      text[] not null default '{}',
  note            text,
  grn_id          uuid references public.grns (id),
  created_by      uuid references auth.users (id) default auth.uid(),
  created_code    text,
  created_at      timestamptz not null default now(),
  done_code       text,
  done_at         timestamptz,
  cancel_reason   text,
  cancelled_code  text,
  cancelled_at    timestamptz,
  unique (check_no, env)
);

create table if not exists public.receipt_check_lines (
  id            uuid primary key default gen_random_uuid(),
  check_id      uuid not null references public.receipt_checks (id),
  line_no       integer not null,
  -- '' = Packing List ไม่ระบุเคส (1 บรรทัด = 1 กล่อง เหมือนเดิม)
  case_no       text not null default '',
  part_no       text not null,
  description   text,
  pl_qty        numeric not null default 0 check (pl_qty >= 0),
  inv_line      integer,
  -- โซนเก็บที่เลือกเอง (ว่าง = ตามกฎ)
  zone_id       text references public.zones (id),
  -- พบตอนตรวจ ไม่มีใน Packing List
  extra         boolean not null default false,
  -- ว่าง = ยังไม่ตรวจ
  actual_qty    numeric check (actual_qty >= 0),
  damaged_qty   numeric not null default 0 check (damaged_qty >= 0),
  note          text,
  photos        text[] not null default '{}',
  checked_by    uuid references auth.users (id),
  checked_code  text,
  checked_at    timestamptz,
  -- กันบันทึกทับกันเมื่อหลายคนตรวจใบเดียวกัน
  version       integer not null default 0,
  unique (check_id, line_no)
);
create index if not exists receipt_check_lines_check on public.receipt_check_lines (check_id);
create index if not exists receipt_checks_env_status on public.receipt_checks (env, status);

-- ใบรับที่ออกจากใบตรวจรับ
alter table public.grns add column if not exists check_id uuid references public.receipt_checks (id);

alter table public.receipt_checks enable row level security;
create policy "receipt_checks read by staff" on public.receipt_checks for select to authenticated
  using (public.is_staff() and env = public.wms_env());
alter table public.receipt_check_lines enable row level security;
create policy "receipt_check_lines read by staff" on public.receipt_check_lines for select to authenticated
  using (public.is_staff() and exists (select 1 from public.receipt_checks c where c.id = check_id and c.env = public.wms_env()));
grant select on public.receipt_checks, public.receipt_check_lines to authenticated;

-- รหัสหลักเสมอ (เหมือนตารางคลังอื่น)
create trigger part_canon before insert on public.receipt_check_lines for each row execute function public.trg_part_canon();

-- สิทธิ์ใหม่: ยกเลิกใบรับ (ผู้ดูแลระบบได้เสมอ)
insert into public.role_permissions (role, perm) values ('manager', 'grn.void') on conflict (role, perm) do nothing;

-- รายการ Invoice ให้อยู่รูปเดียวกัน: รหัสหลัก จำนวนไม่ติดลบ ตัดแถวที่ไม่มี Part No.
create or replace function public.check_inv_lines(p jsonb)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'lineNo', coalesce(nullif(l ->> 'lineNo', '')::numeric::integer, n::integer),
      'partNo', public.part_canon(l ->> 'partNo'),
      'description', coalesce(l ->> 'description', ''),
      'qty', greatest(coalesce(nullif(l ->> 'qty', '')::numeric, 0), 0)) order by n), '[]')
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]' end) with ordinality as x(l, n)
  where coalesce(trim(l ->> 'partNo'), '') <> ''
$$;

-- ===================== 3) สร้างใบตรวจรับจาก Packing List (+ Invoice) =====================
-- p = { modelCode, replacement, note,
--       packingList: { refDoc, soNo, packages, title, imagePaths },
--       invoice: { invoiceNo, poNo, docDate, movementType, lines, imagePaths },
--       lines: [{ caseNo, partNo, description, plQty, invLine, zoneId }] }
create or replace function public.check_create(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_model text := nullif(p ->> 'modelCode', '');
  v_pl jsonb := coalesce(p -> 'packingList', '{}');
  v_inv jsonb := case when jsonb_typeof(p -> 'invoice') = 'object' then p -> 'invoice' else '{}' end;
  v_customer text;
  v_id uuid;
  v_no text;
  v_line jsonb;
  v_n integer := 0;
  v_zone text;
begin
  perform public.require_perm('receive.create');
  select customer_id into v_customer from public.product_models where code = v_model;
  if v_customer is null then raise exception 'เลือก Model'; end if;
  if coalesce(trim(v_pl ->> 'refDoc'), '') = '' then raise exception 'ต้องมีเลขอ้างอิงของ Packing List'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการให้ตรวจ'; end if;

  v_no := public.next_doc_no('CHK');
  insert into public.receipt_checks (check_no, model_code, customer_id, replacement, pl_ref, so_no, packages, title,
      invoice_no, po_no, doc_date, movement_type, invoice_lines, pl_images, inv_images, note, created_code)
  values (v_no, v_model, v_customer, coalesce((p ->> 'replacement')::boolean, false), trim(v_pl ->> 'refDoc'),
      nullif(trim(v_pl ->> 'soNo'), ''), nullif(trim(v_pl ->> 'packages'), ''), nullif(trim(v_pl ->> 'title'), ''),
      nullif(trim(v_inv ->> 'invoiceNo'), ''), nullif(trim(v_inv ->> 'poNo'), ''), nullif(v_inv ->> 'docDate', '')::date,
      nullif(trim(v_inv ->> 'movementType'), ''), public.check_inv_lines(v_inv -> 'lines'),
      array(select jsonb_array_elements_text(case when jsonb_typeof(v_pl -> 'imagePaths') = 'array' then v_pl -> 'imagePaths' else '[]' end)),
      array(select jsonb_array_elements_text(case when jsonb_typeof(v_inv -> 'imagePaths') = 'array' then v_inv -> 'imagePaths' else '[]' end)),
      nullif(trim(p ->> 'note'), ''), public.my_code())
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_n := v_n + 1;
    if coalesce(trim(v_line ->> 'partNo'), '') = '' then raise exception 'รายการที่ % ยังไม่มี Part No.', v_n; end if;
    v_zone := nullif(v_line ->> 'zoneId', '');
    if v_zone is not null and not exists (select 1 from public.zones where id = v_zone) then
      raise exception 'ไม่พบโซน % (รายการที่ %)', v_zone, v_n;
    end if;
    insert into public.receipt_check_lines (check_id, line_no, case_no, part_no, description, pl_qty, inv_line, zone_id)
    values (v_id, v_n, coalesce(upper(trim(v_line ->> 'caseNo')), ''), trim(v_line ->> 'partNo'),
        coalesce(nullif(trim(v_line ->> 'description'), ''), (select name from public.parts where part_no = public.part_canon(v_line ->> 'partNo'))),
        greatest(coalesce(nullif(v_line ->> 'plQty', '')::numeric, 0), 0), nullif(v_line ->> 'invLine', '')::numeric::integer, v_zone);
  end loop;
  return jsonb_build_object('id', v_id, 'checkNo', v_no);
end;
$$;

-- ===================== 4) บันทึกผลตรวจทีละบรรทัด =====================
-- p (ส่งเฉพาะช่องที่เปลี่ยน): actual (null = ยกเลิกการตรวจบรรทัดนี้), damaged, note, photos,
--   แก้ข้อมูลจาก PL ที่ AI อ่านผิด: partNo, description, plQty, caseNo, zoneId
-- p_version ต้องตรงกับที่หน้าจอเห็น ไม่งั้นแปลว่ามีคนบันทึกไปก่อน
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
  if v.version <> p_version then raise exception 'รายการนี้มีคนบันทึกไปก่อนแล้ว · โหลดใหม่แล้วตรวจอีกครั้ง'; end if;

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

-- ทั้งเคส: ok = ตรงตาม Packing List · missing = ไม่มีเคสนี้มากับรถ (นับได้ 0)
-- แตะเฉพาะบรรทัดที่ยังไม่ได้ตรวจ ไม่ทับสิ่งที่คนอื่นบันทึกไว้
create or replace function public.check_case_save(p_check uuid, p_case text, p_mode text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  n integer;
begin
  perform public.require_perm('receive.create');
  if p_mode not in ('ok', 'missing') then raise exception 'คำสั่งไม่ถูกต้อง'; end if;
  perform 1 from public.receipt_checks where id = p_check and env = public.wms_env() and status = 'open' for update;
  if not found then raise exception 'ไม่พบใบตรวจรับที่ยังเปิดอยู่'; end if;
  update public.receipt_check_lines set
    actual_qty = case when p_mode = 'ok' then pl_qty else 0 end,
    damaged_qty = 0,
    note = case when p_mode = 'missing' then coalesce(note, 'ไม่มีเคสนี้มากับรถ') else note end,
    checked_by = auth.uid(), checked_code = public.my_code(), checked_at = now(), version = version + 1
  where check_id = p_check and case_no = coalesce(upper(trim(p_case)), '') and actual_qty is null and not extra;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- เพิ่มบรรทัด: ของที่พบเพิ่ม (ไม่มีใน PL) หรือบรรทัดที่ AI อ่านตกไป
create or replace function public.check_line_add(p_check uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.receipt_check_lines;
  v_n integer;
  v_actual numeric := nullif(p ->> 'actual', '')::numeric;
  v_pl numeric := greatest(coalesce(nullif(p ->> 'plQty', '')::numeric, 0), 0);
begin
  perform public.require_perm('receive.create');
  perform 1 from public.receipt_checks where id = p_check and env = public.wms_env() and status = 'open' for update;
  if not found then raise exception 'ไม่พบใบตรวจรับที่ยังเปิดอยู่'; end if;
  if coalesce(trim(p ->> 'partNo'), '') = '' then raise exception 'ใส่ Part No.'; end if;
  if v_actual is not null and (v_actual < 0 or v_actual <> trunc(v_actual)) then raise exception 'จำนวนที่นับได้ต้องเป็นจำนวนเต็มไม่ติดลบ'; end if;
  if v_pl <> trunc(v_pl) then raise exception 'จำนวนใน Packing List ต้องเป็นจำนวนเต็มไม่ติดลบ'; end if;
  select coalesce(max(line_no), 0) + 1 into v_n from public.receipt_check_lines where check_id = p_check;
  insert into public.receipt_check_lines (check_id, line_no, case_no, part_no, description, pl_qty, extra, actual_qty, note,
      checked_by, checked_code, checked_at)
  values (p_check, v_n, coalesce(upper(trim(p ->> 'caseNo')), ''), trim(p ->> 'partNo'),
      coalesce(nullif(trim(p ->> 'description'), ''), (select name from public.parts where part_no = public.part_canon(p ->> 'partNo'))),
      v_pl, v_pl = 0, v_actual, nullif(trim(p ->> 'note'), ''),
      case when v_actual is null then null else auth.uid() end,
      case when v_actual is null then null else public.my_code() end,
      case when v_actual is null then null else now() end)
  returning * into v;
  return to_jsonb(v);
end;
$$;

-- หัวใบ (ส่งเฉพาะช่องที่เปลี่ยน): invoiceNo, poNo, docDate, movementType, invoiceLines, note, replacement, plImages, invImages
create or replace function public.check_header_save(p_check uuid, p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('receive.create');
  update public.receipt_checks set
    invoice_no = case when p ? 'invoiceNo' then nullif(trim(p ->> 'invoiceNo'), '') else invoice_no end,
    po_no = case when p ? 'poNo' then nullif(trim(p ->> 'poNo'), '') else po_no end,
    doc_date = case when p ? 'docDate' then nullif(p ->> 'docDate', '')::date else doc_date end,
    movement_type = case when p ? 'movementType' then nullif(trim(p ->> 'movementType'), '') else movement_type end,
    invoice_lines = case when p ? 'invoiceLines' then public.check_inv_lines(p -> 'invoiceLines') else invoice_lines end,
    note = case when p ? 'note' then nullif(trim(p ->> 'note'), '') else note end,
    replacement = case when p ? 'replacement' then coalesce((p ->> 'replacement')::boolean, false) else replacement end,
    pl_images = case when jsonb_typeof(p -> 'plImages') = 'array' then array(select jsonb_array_elements_text(p -> 'plImages')) else pl_images end,
    inv_images = case when jsonb_typeof(p -> 'invImages') = 'array' then array(select jsonb_array_elements_text(p -> 'invImages')) else inv_images end
  where id = p_check and env = public.wms_env() and status = 'open';
  if not found then raise exception 'ไม่พบใบตรวจรับที่ยังเปิดอยู่'; end if;
end;
$$;

create or replace function public.check_cancel(p_check uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('receive.create');
  if coalesce(trim(p_reason), '') = '' then raise exception 'ใส่เหตุผลที่ยกเลิก'; end if;
  update public.receipt_checks set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_code = public.my_code(), cancelled_at = now()
  where id = p_check and env = public.wms_env() and status = 'open';
  if not found then raise exception 'ไม่พบใบตรวจรับที่ยังเปิดอยู่'; end if;
end;
$$;

-- ===================== 5) ตรวจครบ → ออก GRN จากยอดที่นับได้จริง =====================
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
        'plQty', l.pl_qty, 'countedQty', l.actual_qty, 'zoneId', l.zone_id) order by l.line_no)
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

-- ===================== 6) รับของ: 1 เคส = 1 กล่อง =====================
-- เหมือน 0014 + lines[].caseNo: บรรทัดเคสเดียวกันอยู่กล่องเดียวกัน (ป้ายเดียว)
--   part ที่ต้องตรวจ MI3 แยกกล่องตาม part เพราะบันทึกผลตรวจทีละ part · ไม่มีเลขเคส = 1 บรรทัด 1 กล่องเหมือนเดิม
-- + checkId: ใบตรวจรับที่ออกใบรับนี้
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
  insert into public.grns (grn_no, packing_list_id, invoice_id, customer_id, model_code, receiver_code, note, replacement, check_id)
  values (v_grn_no, v_pl_id, v_invoice_id, v_customer, v_model, public.my_code(), nullif(p ->> 'note', ''),
          coalesce((p ->> 'replacement')::boolean, false), nullif(p ->> 'checkId', '')::uuid)
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_no := v_no + 1;
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

    insert into public.grn_lines (grn_id, line_no, part_no, description, part_type, pl_qty, counted_qty, invoice_qty, needs_qi, home_location, case_no)
    values (v_grn_id, v_no, v_line ->> 'partNo', v_line ->> 'description', v_type,
            coalesce((v_line ->> 'plQty')::numeric, 0), (v_line ->> 'countedQty')::numeric, v_inv_qty, v_needs, v_home, v_case)
    returning id into v_line_id;

    if (v_line ->> 'countedQty')::numeric > 0 then
      v_case_lpn := null;
      if v_case is not null and not v_needs then
        select id, lpn_no into v_case_lpn, v_lpn_no from public.lpns
        where grn_id = v_grn_id and case_no = v_case and not hold and status = 'active' limit 1;
      end if;
      if v_case_lpn is null then
        v_lpn_no := public.next_doc_no('LPN');
        insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no) values (v_lpn_no, v_grn_id, v_loc, v_needs, v_case) returning id into v_lpn_id;
      else
        v_lpn_id := v_case_lpn;
      end if;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', (v_line ->> 'countedQty')::numeric);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', (v_line ->> 'countedQty')::numeric, v_loc, v_pl ->> 'refDoc', public.my_code());
    end if;
  end loop;

  return jsonb_build_object('grnId', v_grn_id, 'grnNo', v_grn_no, 'invoiceId', v_invoice_id);
end;
$$;

-- ===================== 7) ยกเลิกใบรับ =====================
-- ได้เมื่อของจากใบนี้ยังไม่ถูกใช้: ไม่มีเบิก/คืน ตรวจ MI3 แก้ยอด (รวมที่รออนุมัติ) และไม่ได้รวมอยู่กับของใบอื่น
-- และเดือนที่รับยังไม่ปิดยอด · ย้ายที่ / รวม-แยกกล่องภายในใบเดียวกันไม่เป็นไร
-- ใบรับที่ออกจากใบตรวจรับ ⇒ ใบตรวจรับเปิดกลับมาแก้แล้วยืนยันใหม่ได้
create or replace function public.grn_void(p_grn uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  g public.grns;
  v_box uuid[];
  v_used text;
  v_check uuid;
  v_boxes integer;
begin
  perform public.require_perm('grn.void');
  if coalesce(trim(p_reason), '') = '' then raise exception 'ใส่เหตุผลที่ยกเลิก'; end if;
  select * into g from public.grns where id = p_grn and env = public.wms_env() for update;
  if g.id is null then raise exception 'ไม่พบใบรับสินค้า'; end if;
  if g.status = 'void' then raise exception 'ใบรับนี้ยกเลิกไปแล้ว'; end if;
  if public.month_closed(g.model_code, (g.received_at at time zone 'Asia/Bangkok')::date) then
    raise exception 'บัญชีคุม % เดือน % ปิดยอดแล้ว · ให้ผู้มีสิทธิ์เปิดเดือนก่อน', g.model_code, to_char(g.received_at at time zone 'Asia/Bangkok', 'YYYY-MM');
  end if;

  -- กล่องที่มีของจากใบนี้อยู่ตอนนี้ + กล่องทุกใบที่ออกจากใบนี้
  v_box := array(
    select i.lpn_id from public.lpn_items i join public.grn_lines gl on gl.id = i.grn_line_id where gl.grn_id = p_grn
    union select l.id from public.lpns l where l.grn_id = p_grn);
  perform 1 from public.lpns where id = any (v_box) for update;

  select string_agg(distinct w, ', ') into v_used from (
    select case t.kind when 'ISSUE' then 'เบิก' when 'RETURN' then 'เบิก' when 'QI' then 'ตรวจ MI3' else 'แก้ยอด' end w
      from public.wms_tx t
      where t.lpn_id = any (v_box) and t.kind in ('ISSUE', 'RETURN', 'QI', 'ADJ') and t.status <> 'rejected'
    union all
    select 'รวมอยู่กับของใบอื่น' from public.lpn_items i
      where i.lpn_id = any (v_box) and i.grn_line_id not in (select id from public.grn_lines where grn_id = p_grn)
  ) x;
  if v_used is not null then raise exception 'ยกเลิกใบรับไม่ได้ · ของจากใบนี้มีรายการต่อแล้ว: %', v_used; end if;

  update public.lpns set status = 'void' where id = any (v_box) and status = 'active';
  get diagnostics v_boxes = row_count;
  update public.grns set status = 'void', void_reason = trim(p_reason), voided_by = auth.uid(), voided_code = public.my_code(), voided_at = now()
  where id = p_grn;
  update public.print_jobs set status = 'cancelled', done_by = auth.uid(), done_code = public.my_code(), done_at = now()
  where grn_id = p_grn and status = 'queued';
  update public.receipt_checks
  set status = 'open', grn_id = null, done_code = null, done_at = null,
      note = concat_ws(' · ', note, 'ยกเลิก ' || g.grn_no || ': ' || trim(p_reason))
  where grn_id = p_grn
  returning id into v_check;
  return jsonb_build_object('grnNo', g.grn_no, 'boxes', v_boxes, 'checkId', v_check);
end;
$$;

-- ===================== 8) ย้ายหลายกล่องพร้อมกัน (เลือกจากรายการ) =====================
-- ปลายทางต้องเป็นช่องที่มีในระบบและเปิดใช้ · จากจุดรับของ/จุดพัก ⇒ PUT (จัดเก็บ) · อื่น ๆ ⇒ MOVE
create or replace function public.move_lpns(p_ids uuid[], p_to text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_to text := upper(trim(coalesce(p_to, '')));
  v_loc public.locations;
  v public.lpns;
  v_from_kind text;
  v_kind text;
  v_total integer := (select count(distinct x) from unnest(p_ids) x);
  v_seen integer := 0;
  n integer := 0;
begin
  if v_total = 0 then raise exception 'เลือกกล่องที่จะย้าย'; end if;
  if v_total > 200 then raise exception 'ย้ายได้ครั้งละไม่เกิน 200 กล่อง'; end if;
  select * into v_loc from public.locations where code = v_to;
  if v_loc.code is null or not v_loc.active or v_loc.blocked then raise exception 'ไม่พบช่อง % หรือช่องนี้ปิดใช้อยู่', v_to; end if;
  for v in select * from public.lpns where id = any (p_ids) and env = public.wms_env() order by lpn_no for update loop
    v_seen := v_seen + 1;
    if v.status <> 'active' then raise exception 'ป้าย % ใช้งานไม่ได้แล้ว · โหลดรายการใหม่', v.lpn_no; end if;
    continue when v.location_code = v_to;
    select kind into v_from_kind from public.locations where code = v.location_code;
    v_kind := case when v_from_kind in ('staging', 'hold') then 'PUT' else 'MOVE' end;
    perform public.require_perm(case when v_kind = 'PUT' then 'scan.put' else 'scan.move' end);
    update public.lpns set location_code = v_to where id = v.id;
    insert into public.wms_tx (kind, lpn_id, from_loc, to_loc, created_code, via) values (v_kind, v.id, v.location_code, v_to, public.my_code(), 'list');
    n := n + 1;
  end loop;
  if v_seen < v_total then raise exception 'ไม่พบบางกล่อง · โหลดรายการใหม่'; end if;
  return jsonb_build_object('moved', n, 'same', v_seen - n);
end;
$$;

-- หน้าสแกน: เหมือน 0009 + บันทึกว่าย้ายผ่านหน้าสแกน
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
  insert into public.wms_tx (kind, lpn_id, from_loc, to_loc, created_code, via) values (p_kind, p_lpn, v.location_code, upper(trim(p_to)), public.my_code(), 'scan');
end;
$$;

-- ช่องแนะนำตามกฎโซน "ตอนนี้" (กฎเปลี่ยนหลังรับของ ⇒ แนะนำตามกฎใหม่) · หลายกล่องได้ช่องว่างไม่ซ้ำกัน
-- คืน [{lpnId, code}] ตามลำดับที่ส่งมา · code ว่าง = ไม่มีกฎหรือโซนเต็ม
create or replace function public.suggest_slots(p_ids uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  r record;
  v_taken text[] := '{}';
  v_code text;
  v_out jsonb := '[]';
begin
  if not public.is_staff() then raise exception 'ไม่มีสิทธิ์'; end if;
  for r in
    select l.id, coalesce(g.customer_id, m.customer_id) customer, pt.part_type
    from unnest(p_ids) with ordinality u(id, n)
    join public.lpns l on l.id = u.id and l.env = v_env
    left join public.grns g on g.id = l.grn_id
    left join public.product_models m on m.code = g.model_code
    left join lateral (select i.part_no from public.lpn_items i where i.lpn_id = l.id and i.qty > 0 order by i.qty desc, i.part_no limit 1) it on true
    left join public.parts pt on pt.part_no = it.part_no
    order by u.n
  loop
    v_code := null;
    select lo.code into v_code
    from public.zone_rules zr
    join public.locations lo on lo.zone_id = zr.zone_id and lo.active and not lo.blocked and lo.kind in ('bin', 'floor')
    where zr.customer_id = r.customer and (zr.part_type = r.part_type or zr.part_type is null)
      and not exists (select 1 from public.lpns x where x.location_code = lo.code and x.status = 'active' and x.env = v_env)
      and not (lo.code = any (v_taken))
    order by (zr.part_type is null), lo.code
    limit 1;
    if v_code is not null then v_taken := v_taken || v_code; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('lpnId', r.id, 'code', v_code));
  end loop;
  return v_out;
end;
$$;

-- ===================== 9) บัญชีคุม: ไม่นับรับเข้าของใบที่ยกเลิก + ส่งเป็นก้อนเดียว (ไม่ถูกตัดที่ 1,000 แถว) =====================
create or replace function public.stock_ledger_rows(p_parts text[], p_to timestamptz)
returns table (at timestamptz, part_no text, kind text, col text, qty numeric, inv_no text, order_no text, order_date date, doc_no text, lot text, note text)
language sql stable security definer set search_path = public
as $$
  select t.created_at, t.part_no, t.kind,
    case
      when t.kind = 'RECEIVE' then case when coalesce(g.replacement, false) then 'recv_rep' else 'recv' end
      when t.kind in ('ISSUE', 'RETURN') then case q.kind when 'qc' then 'qc' when 'ng' then 'ng' else 'issue' end
      when t.kind = 'QI' then 'ng'
      else 'adj'
    end,
    case
      when t.kind = 'RETURN' then -t.qty
      when t.kind = 'QI' then t.ng_qty
      when t.kind = 'ADJ' then t.new_qty - t.qty
      else t.qty
    end,
    case when t.kind = 'RECEIVE' then i.invoice_no end,
    case when t.kind = 'RECEIVE' then i.po_no end,
    case when t.kind = 'RECEIVE' then i.doc_date end,
    case
      when t.kind in ('ISSUE', 'RETURN') then coalesce(q.doc_no, q.req_no, t.ref, t.doc_no)
      when t.kind = 'RECEIVE' then g.grn_no
      else t.doc_no
    end,
    g.grn_no,
    coalesce(t.reason, case when q.kind = 'fm005' then 'กระทบยอด FM-P-005' end)
  from public.wms_tx t
  left join public.lpns l on l.id = t.lpn_id
  left join public.grns g on g.id = l.grn_id
  left join public.invoices i on i.id = g.invoice_id
  left join public.requisitions q on q.id = t.requisition_id
  where public.is_staff() and t.env = public.wms_env() and t.part_no = any (p_parts) and t.created_at < p_to
    and (t.kind in ('RECEIVE', 'ISSUE', 'RETURN') or (t.kind = 'QI' and t.ng_qty > 0) or (t.kind = 'ADJ' and t.status = 'approved'))
    and (t.kind <> 'RECEIVE' or g.status is distinct from 'void')
  order by t.created_at
$$;

create or replace function public.stock_ledger_json(p_parts text[], p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.at), '[]') from public.stock_ledger_rows(p_parts, p_to) r
$$;

-- ===================== 10) ล้าง/กู้คืนข้อมูลรายการ (0019) รวมใบตรวจรับด้วย =====================
create or replace function public.env_counts(p_env text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'grns',           (select count(*) from public.grns where env = p_env),
    'lpns',           (select count(*) from public.lpns where env = p_env),
    'wms_tx',         (select count(*) from public.wms_tx where env = p_env),
    'requisitions',   (select count(*) from public.requisitions where env = p_env),
    'invoices',       (select count(*) from public.invoices where env = p_env),
    'packing_lists',  (select count(*) from public.packing_lists where env = p_env),
    'stock_counts',   (select count(*) from public.stock_counts where env = p_env),
    'stock_closings', (select count(*) from public.stock_closings where env = p_env),
    'print_jobs',     (select count(*) from public.print_jobs where env = p_env),
    'receipt_checks', (select count(*) from public.receipt_checks where env = p_env))
$$;

create or replace function public.env_lock()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  lock table public.stock_closings, public.requisitions, public.wms_tx, public.lpns, public.grns, public.packing_lists,
    public.invoices, public.stock_counts, public.print_jobs, public.receipt_checks in share row exclusive mode;
end;
$$;

create or replace function public.env_move(p_from text, p_to text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v jsonb := '{}';
  n bigint;
  t text;
begin
  foreach t in array case when p_to = public.wms_env()
      then array['requisitions', 'wms_tx', 'lpns', 'grns', 'packing_lists', 'invoices', 'stock_counts', 'print_jobs', 'receipt_checks', 'stock_closings']
      else array['stock_closings', 'requisitions', 'wms_tx', 'lpns', 'grns', 'packing_lists', 'invoices', 'stock_counts', 'print_jobs', 'receipt_checks'] end
  loop
    execute format('update public.%I set env = $1 where env = $2', t) using p_to, p_from;
    get diagnostics n = row_count;
    v := v || jsonb_build_object(t, n);
  end loop;
  return v;
end;
$$;

-- ===================== สิทธิ์เรียกฟังก์ชัน =====================
do $$
declare
  f text;
begin
  foreach f in array array['check_create(jsonb)', 'check_line_save(uuid, integer, jsonb)', 'check_case_save(uuid, text, text)',
    'check_line_add(uuid, jsonb)', 'check_header_save(uuid, jsonb)', 'check_cancel(uuid, text)', 'check_complete(uuid)',
    'grn_void(uuid, text)', 'move_lpns(uuid[], text)', 'suggest_slots(uuid[])', 'stock_ledger_json(text[], timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.check_inv_lines(jsonb) from public, anon, authenticated';
end;
$$;
