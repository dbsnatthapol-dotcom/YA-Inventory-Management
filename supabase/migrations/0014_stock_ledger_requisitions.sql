-- บัญชีคุมสินค้า (FM-P-537) + ใบเบิกเข้าไลน์ประกอบ (ใบเบิกย่อย → FM-P-005 ยอดรวมจบวัน) + ส่งยอดให้ Planning
-- 1) Part: รหัสภายใน UAM คู่กับรหัสลูกค้า · ชุดวงล้อ (FG) + BOM จำนวน part ต่อ 1 วง
-- 2) ใบเบิก: ตัดสต็อกจากกล่องที่เข้าก่อน (FIFO) ทันทีที่บันทึกใบเบิกย่อย
--    FM-P-005 ตอนจบวัน: เทียบกับผลรวมใบย่อยของวัน/Model เดียวกัน ส่วนต่าง + ตัดเพิ่ม, − คืนเข้ากล่องที่เบิกล่าสุด
-- 3) รับของทดแทน (แยกช่อง "ทดแทน" ในบัญชีคุม)
-- 4) stock_ledger_rows: รายการเคลื่อนไหวต่อ part สำหรับสร้างบัญชีคุม (ยกมา / รับ / เบิก / NG / QC / คงเหลือ)

-- ===================== 1) Part =====================
alter table public.parts add column if not exists uam_code text unique;
comment on column public.parts.uam_code is 'รหัสภายใน UAM (เช่น 2011409) คู่กับ part_no ที่เป็นรหัสลูกค้า (เช่น RAT00586/B)';

-- ชุดวงล้อสำเร็จรูป (FG) ที่ไลน์ประกอบเบิก เช่น 2019333 = 17×2.50 TL · 1 Model มีได้หลายชุด (หน้า/หลัง/สี)
create table if not exists public.fg_items (
  code        text primary key,
  name        text not null,
  model_code  text references public.product_models (code),
  active      boolean not null default true
);
-- BOM: part ที่ใช้ต่อ 1 วง เช่น BEARING 2, SPOKE 9 · 0 = เคยอยู่ใน BOM แต่เอาออกแล้ว
create table if not exists public.fg_bom (
  fg_code  text not null references public.fg_items (code) on delete cascade,
  part_no  text not null,
  qty_per  numeric not null check (qty_per >= 0),
  primary key (fg_code, part_no)
);
alter table public.fg_items enable row level security;
alter table public.fg_bom enable row level security;
drop policy if exists "fg_items read by staff" on public.fg_items;
create policy "fg_items read by staff" on public.fg_items for select to authenticated using (public.is_staff());
drop policy if exists "fg_bom read by staff" on public.fg_bom;
create policy "fg_bom read by staff" on public.fg_bom for select to authenticated using (public.is_staff());

-- บันทึกชุด FG + BOM ทั้งชุด · เลิกใช้ชุดด้วย active = false
-- p = { code, name, modelCode, active, lines: [{ partNo, qtyPer }] }
create or replace function public.master_save_fg(p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p ->> 'code', '')));
begin
  perform public.require_perm('master.edit');
  if v_code = '' or coalesce(trim(p ->> 'name'), '') = '' then raise exception 'ต้องมีรหัสและชื่อชุดวงล้อ'; end if;
  insert into public.fg_items (code, name, model_code, active)
  values (v_code, trim(p ->> 'name'), nullif(p ->> 'modelCode', ''), coalesce((p ->> 'active')::boolean, true))
  on conflict (code) do update set name = excluded.name, model_code = excluded.model_code, active = excluded.active;
  -- part ที่ไม่อยู่ในรายการใหม่ ⇒ qty_per = 0 (ไม่อยู่ใน BOM แล้ว แต่เก็บประวัติไว้)
  update public.fg_bom set qty_per = 0
  where fg_code = v_code and part_no not in (
    select l ->> 'partNo' from jsonb_array_elements(coalesce(p -> 'lines', '[]')) l where coalesce((l ->> 'qtyPer')::numeric, 0) > 0);
  insert into public.fg_bom (fg_code, part_no, qty_per)
  select v_code, l ->> 'partNo', (l ->> 'qtyPer')::numeric
  from jsonb_array_elements(coalesce(p -> 'lines', '[]')) l where coalesce((l ->> 'qtyPer')::numeric, 0) > 0
  on conflict (fg_code, part_no) do update set qty_per = excluded.qty_per;
end;
$$;

-- บันทึก part ทีเดียว: ชื่อ กลุ่ม ลูกค้า รหัส UAM และ Model ที่ใช้
-- p = { partNo, name, type, customerId, uamCode, models: [code] }
create or replace function public.master_save_part(p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_uam text := nullif(trim(coalesce(p ->> 'uamCode', '')), '');
begin
  perform public.require_perm('master.edit');
  if coalesce(trim(p ->> 'partNo'), '') = '' or coalesce(trim(p ->> 'name'), '') = '' then raise exception 'ต้องมี Part No. และชื่อ'; end if;
  if v_uam is not null and exists (select 1 from public.parts where uam_code = v_uam and part_no <> trim(p ->> 'partNo')) then
    raise exception 'รหัส UAM % ใช้กับ part อื่นแล้ว', v_uam;
  end if;
  insert into public.parts (part_no, name, part_type, customer_id, uam_code)
  values (trim(p ->> 'partNo'), trim(p ->> 'name'), nullif(upper(trim(coalesce(p ->> 'type', ''))), ''), nullif(p ->> 'customerId', ''), v_uam)
  on conflict (part_no) do update set name = excluded.name, part_type = excluded.part_type, customer_id = excluded.customer_id, uam_code = excluded.uam_code
  returning id into v_id;
  insert into public.part_models (part_id, model_code)
  select v_id, m from jsonb_array_elements_text(coalesce(p -> 'models', '[]')) m
  on conflict do nothing;
end;
$$;

-- ===================== 3) รับของทดแทน =====================
alter table public.grns add column if not exists replacement boolean not null default false;
comment on column public.grns.replacement is 'รับของทดแทน (แทนของ NG ที่ส่งคืน) — ลงช่อง "ทดแทน" ในบัญชีคุม';

-- ===================== 2) ใบเบิก =====================
create table if not exists public.requisitions (
  id             uuid primary key default gen_random_uuid(),
  env            text not null default public.wms_env(),
  kind           text not null check (kind in ('line', 'fm005', 'qc', 'ng')),
  req_no         text not null,
  doc_no         text,
  doc_date       date not null,
  model_code     text,
  fg_code        text,
  fg_qty         numeric,
  from_dept      text,
  to_dept        text,
  note           text,
  status         text not null default 'posted' check (status in ('posted', 'void')),
  reconciled_by  uuid references public.requisitions (id),
  created_by     uuid references auth.users (id) default auth.uid(),
  created_code   text,
  created_at     timestamptz not null default now()
);
comment on table public.requisitions is 'line = ใบเบิกย่อยเข้าไลน์ (ทยอยเบิก), fm005 = ใบเบิกสินค้า FM-P-005 ยอดรวมจบวัน, qc = QC เบิก, ng = ตัด NG ส่งคืน';
create index if not exists requisitions_day_idx on public.requisitions (env, doc_date, model_code);

create table if not exists public.requisition_lines (
  id        uuid primary key default gen_random_uuid(),
  req_id    uuid not null references public.requisitions (id) on delete cascade,
  line_no   integer not null,
  part_no   text not null,
  req_qty   numeric,
  qty       numeric not null default 0,
  balance   numeric
);
comment on column public.requisition_lines.req_qty is 'ใบย่อย: จำนวนขอเบิก · FM-P-005: ผลรวมใบย่อยของวัน';
comment on column public.requisition_lines.qty is 'ใบย่อย: จ่ายจริง (ตัดสต็อก) · FM-P-005: ยอดในเอกสาร';
comment on column public.requisition_lines.balance is 'สต็อกคงเหลือของ part หลังบันทึก';
create index if not exists requisition_lines_req_idx on public.requisition_lines (req_id);

alter table public.requisitions enable row level security;
alter table public.requisition_lines enable row level security;
drop policy if exists "requisitions read by staff" on public.requisitions;
create policy "requisitions read by staff" on public.requisitions for select to authenticated using (public.is_staff() and env = public.wms_env());
drop policy if exists "requisition_lines read by staff" on public.requisition_lines;
create policy "requisition_lines read by staff" on public.requisition_lines for select to authenticated
  using (public.is_staff() and exists (select 1 from public.requisitions r where r.id = req_id));

alter table public.wms_tx add column if not exists requisition_id uuid references public.requisitions (id);
alter table public.wms_tx drop constraint if exists wms_tx_kind_check;
alter table public.wms_tx add constraint wms_tx_kind_check
  check (kind in ('RECEIVE', 'PUT', 'MOVE', 'ISSUE', 'ADJ', 'COUNT', 'QI', 'MERGE', 'UNMERGE', 'SPLIT', 'RETURN'));

-- ยอดคงเหลือของ part (รวมของรอ MI3)
create or replace function public.part_on_hand(p_part text)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(i.qty), 0) from public.lpn_items i join public.lpns l on l.id = i.lpn_id
  where i.part_no = p_part and l.status = 'active' and l.env = public.wms_env()
$$;

-- ตัดสต็อกจากกล่องที่รับเข้าก่อน (FIFO) ไม่แตะของรอ MI3
create or replace function public.wms_issue_fifo(p_req uuid, p_doc text, p_ref text, p_part text, p_qty numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_left numeric := p_qty;
  v_have numeric;
  v_take numeric;
  r record;
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  select coalesce(sum(i.qty), 0) into v_have from public.lpn_items i join public.lpns l on l.id = i.lpn_id
  where i.part_no = p_part and i.qty > 0 and l.status = 'active' and not l.hold and l.env = public.wms_env();
  if v_have < p_qty then
    raise exception 'สต็อก % ไม่พอ · พร้อมเบิก % ขอเบิก %', p_part, v_have, p_qty;
  end if;
  for r in
    select i.id as item_id, i.qty, l.id as lpn_id, l.location_code
    from public.lpn_items i join public.lpns l on l.id = i.lpn_id
    where i.part_no = p_part and i.qty > 0 and l.status = 'active' and not l.hold and l.env = public.wms_env()
    order by l.created_at, l.lpn_no
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

-- คืนเข้ากล่องที่ถูกเบิกล่าสุดก่อน (จากใบเบิกที่ระบุ)
create or replace function public.wms_return_lifo(p_req uuid, p_from uuid[], p_doc text, p_ref text, p_part text, p_qty numeric)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_left numeric := p_qty;
  v_take numeric;
  r record;
begin
  if p_qty is null or p_qty <= 0 then return; end if;
  for r in
    select t.lpn_id, t.lpn_item_id, t.qty, l.location_code
    from public.wms_tx t join public.lpns l on l.id = t.lpn_id
    where t.kind = 'ISSUE' and t.requisition_id = any (p_from) and t.part_no = p_part
    order by t.created_at desc
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    update public.lpn_items set qty = qty + v_take where id = r.lpn_item_id;
    update public.lpns set status = 'active' where id = r.lpn_id and status = 'empty';
    insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, to_loc, ref, requisition_id, created_code)
    values ('RETURN', p_doc, r.lpn_id, r.lpn_item_id, p_part, v_take, r.location_code, p_ref, p_req, public.my_code());
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'คืน % ได้ไม่ครบ (เกินยอดที่เบิกไว้ %)', p_part, v_left; end if;
end;
$$;

-- บันทึกใบเบิก (ใบย่อยเข้าไลน์ / QC เบิก / ตัด NG) แล้วตัดสต็อกทันที
-- p = { kind, docNo, docDate, modelCode, fgCode, fgQty, fromDept, toDept, note, lines: [{ partNo, reqQty, qty }] }
create or replace function public.requisition_post(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'line');
  v_id uuid;
  v_no text;
  v_ref text;
  v jsonb;
  v_n integer := 0;
begin
  perform public.require_perm('scan.issue');
  if v_kind not in ('line', 'qc', 'ng') then raise exception 'ประเภทใบเบิกไม่ถูกต้อง'; end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(p -> 'lines', '[]')) l where coalesce((l ->> 'qty')::numeric, 0) > 0) then
    raise exception 'ไม่มีรายการที่จะเบิก';
  end if;
  v_no := public.next_doc_no('RQ');
  v_ref := coalesce(nullif(trim(p ->> 'docNo'), ''), v_no);
  insert into public.requisitions (kind, req_no, doc_no, doc_date, model_code, fg_code, fg_qty, from_dept, to_dept, note, created_code)
  values (v_kind, v_no, nullif(trim(p ->> 'docNo'), ''), coalesce(nullif(p ->> 'docDate', '')::date, (now() at time zone 'Asia/Bangkok')::date),
          nullif(p ->> 'modelCode', ''), nullif(p ->> 'fgCode', ''), nullif(p ->> 'fgQty', '')::numeric, nullif(p ->> 'fromDept', ''), nullif(p ->> 'toDept', ''),
          nullif(p ->> 'note', ''), public.my_code())
  returning id into v_id;
  for v in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((v ->> 'qty')::numeric, 0) <= 0 then continue; end if;
    v_n := v_n + 1;
    perform public.wms_issue_fifo(v_id, v_no, v_ref, v ->> 'partNo', (v ->> 'qty')::numeric);
    insert into public.requisition_lines (req_id, line_no, part_no, req_qty, qty, balance)
    values (v_id, v_n, v ->> 'partNo', nullif(v ->> 'reqQty', '')::numeric, (v ->> 'qty')::numeric, public.part_on_hand(v ->> 'partNo'));
  end loop;
  return jsonb_build_object('id', v_id, 'reqNo', v_no);
end;
$$;

-- FM-P-005 ยอดรวมจบวัน: กระทบกับใบย่อยของวันและ Model เดียวกันที่ยังไม่ได้กระทบ
-- p = { docNo, docDate, modelCode, fgCode, fgQty, fromDept, toDept, note, lines: [{ partNo, qty }] }
create or replace function public.requisition_reconcile(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_date date := nullif(p ->> 'docDate', '')::date;
  v_model text := nullif(p ->> 'modelCode', '');
  v_doc text := nullif(trim(p ->> 'docNo'), '');
  v_subs uuid[];
  v_id uuid;
  v_no text;
  v_n integer := 0;
  r record;
begin
  perform public.require_perm('scan.issue');
  if v_doc is null then raise exception 'ใส่เลขที่ FM-P-005'; end if;
  if v_date is null or v_model is null then raise exception 'ใส่วันที่และ Model'; end if;
  if exists (select 1 from public.requisitions where env = public.wms_env() and kind = 'fm005' and doc_no = v_doc and status = 'posted') then
    raise exception 'FM-P-005 เลขที่ % บันทึกไปแล้ว', v_doc;
  end if;
  select coalesce(array_agg(id), '{}') into v_subs from public.requisitions
  where env = public.wms_env() and kind = 'line' and status = 'posted' and reconciled_by is null and doc_date = v_date and model_code = v_model;

  v_no := public.next_doc_no('RQ');
  insert into public.requisitions (kind, req_no, doc_no, doc_date, model_code, fg_code, fg_qty, from_dept, to_dept, note, created_code)
  values ('fm005', v_no, v_doc, v_date, v_model, nullif(p ->> 'fgCode', ''), nullif(p ->> 'fgQty', '')::numeric, nullif(p ->> 'fromDept', ''), nullif(p ->> 'toDept', ''),
          nullif(p ->> 'note', ''), public.my_code())
  returning id into v_id;

  for r in
    with fm as (
      select l ->> 'partNo' as part_no, sum(coalesce((l ->> 'qty')::numeric, 0)) as qty
      from jsonb_array_elements(coalesce(p -> 'lines', '[]')) l group by 1
    ), sub as (
      select part_no, sum(qty) as qty from public.requisition_lines where req_id = any (v_subs) group by 1
    )
    select coalesce(fm.part_no, sub.part_no) as part_no, coalesce(fm.qty, 0) as fm_qty, coalesce(sub.qty, 0) as sub_qty
    from fm full join sub on sub.part_no = fm.part_no
    order by 1
  loop
    v_n := v_n + 1;
    if r.fm_qty > r.sub_qty then
      perform public.wms_issue_fifo(v_id, v_no, v_doc, r.part_no, r.fm_qty - r.sub_qty);
    elsif r.fm_qty < r.sub_qty then
      perform public.wms_return_lifo(v_id, v_subs, v_no, v_doc, r.part_no, r.sub_qty - r.fm_qty);
    end if;
    insert into public.requisition_lines (req_id, line_no, part_no, req_qty, qty, balance)
    values (v_id, v_n, r.part_no, r.sub_qty, r.fm_qty, public.part_on_hand(r.part_no));
  end loop;
  update public.requisitions set reconciled_by = v_id where id = any (v_subs);
  return jsonb_build_object('id', v_id, 'reqNo', v_no, 'subs', coalesce(array_length(v_subs, 1), 0));
end;
$$;

-- ยกเลิกใบเบิก (ยังไม่กระทบ FM-P-005): คืนของเข้ากล่องเดิมทั้งหมด
create or replace function public.requisition_void(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.requisitions;
  r record;
begin
  perform public.require_perm('scan.issue');
  select * into v from public.requisitions where id = p_id and env = public.wms_env() for update;
  if v.id is null or v.status <> 'posted' then raise exception 'ไม่พบใบเบิก หรือยกเลิกไปแล้ว'; end if;
  if v.kind = 'fm005' then raise exception 'ยกเลิก FM-P-005 ไม่ได้ · แจ้งผู้ดูแลระบบ'; end if;
  if v.reconciled_by is not null then raise exception 'ใบนี้กระทบยอดกับ FM-P-005 แล้ว ยกเลิกไม่ได้'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ระบุเหตุผลที่ยกเลิก'; end if;
  for r in select * from public.wms_tx where kind = 'ISSUE' and requisition_id = p_id loop
    update public.lpn_items set qty = qty + r.qty where id = r.lpn_item_id;
    update public.lpns set status = 'active' where id = r.lpn_id and status = 'empty';
    insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, to_loc, ref, reason, requisition_id, created_code)
    values ('RETURN', v.req_no, r.lpn_id, r.lpn_item_id, r.part_no, r.qty, r.from_loc, r.ref, 'ยกเลิกใบเบิก: ' || trim(p_reason), p_id, public.my_code());
  end loop;
  update public.requisitions set status = 'void', note = concat_ws(' · ', note, 'ยกเลิก: ' || trim(p_reason)) where id = p_id;
end;
$$;

-- ===================== 4) รายการเคลื่อนไหวสำหรับบัญชีคุม =====================
-- col: recv = รับเข้าปกติ, recv_rep = รับทดแทน, issue = เบิก (ติดลบ = คืน), ng = NG, qc = QC เบิก, adj = ปรับยอด (+/-)
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
  order by t.created_at
$$;

-- สิทธิ์เรียกฟังก์ชัน
do $$
declare
  f text;
begin
  foreach f in array array['master_save_part(jsonb)', 'master_save_fg(jsonb)', 'part_on_hand(text)', 'requisition_post(jsonb)', 'requisition_reconcile(jsonb)',
    'requisition_void(uuid, text)', 'stock_ledger_rows(text[], timestamptz)', 'create_grn(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['wms_issue_fifo(uuid, text, text, text, numeric)', 'wms_return_lifo(uuid, uuid[], text, text, text, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;

-- ===================== รับของ: บันทึกว่าเป็นของทดแทน =====================
-- เหมือน 0013 + p.replacement
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
  insert into public.grns (grn_no, packing_list_id, invoice_id, customer_id, model_code, receiver_code, note, replacement)
  values (v_grn_no, v_pl_id, v_invoice_id, v_customer, v_model, public.my_code(), nullif(p ->> 'note', ''), coalesce((p ->> 'replacement')::boolean, false))
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
