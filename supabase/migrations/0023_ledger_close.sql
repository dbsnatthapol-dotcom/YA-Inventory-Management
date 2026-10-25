-- 0023: ชุดบัญชีคุม / ปิดเดือน จากการตรวจระบบ (docs/known-issues.md A4 A6 A7 A8 A9 D2) · ไม่ลบข้อมูล
--   A4 part ที่ใช้หลาย Model: รายการเข้าบัญชีคุมของ Model ตามเอกสาร (ใบรับ / ใบเบิก)
--      ใบที่ไม่มี Model (QC / NG / ปรับยอด) ⇒ Model ของใบรับที่ของชิ้นนั้นมา ⇒ ยังไม่รู้ ⇒ Model เดียวของ part
--      part ร่วมที่ระบุ Model ไม่ได้ (เช่น ของเกินจากการตรวจนับ) ⇒ ไม่เข้าบัญชีของ Model ใด (หน้าเว็บแสดงแยก "ไม่ระบุ Model")
--   A6 บัญชีคุมจัดเดือนตามวันที่ในเอกสาร (ใบเบิก / FM-P-005) ตรงกับล็อกปิดเดือน · ใบ QC / NG ที่ไม่มี Model ก็ติดล็อกปิดเดือน
--   A7 ปรับยอดลงวันที่อนุมัติ (คำขอที่ส่งก่อนปิดไม่ย้อนเข้าเดือนที่ปิด) · ยกเลิก GRN กระทบเฉพาะ Model ของใบรับ (ตาม A4)
--   A8 รวม / แยกกล่อง: กล่องใหม่ใช้วันรับเข้าเดิม (เบิก FIFO ไม่เพี้ยน อายุของไม่นับใหม่) และคงเลขเคส
--   A9 FM-P-005: เลขที่ห้ามซ้ำ · ล็อก (Model + วัน) ระหว่างกระทบยอด / สแกนเบิก / บันทึกหรือยกเลิกใบย่อย (กันตัดสต็อกเกินเอกสาร)
--   D2 คนที่ปิดยอดกดรับทราบเองไม่ได้ · คนเดียวรับทราบทั้งฝั่ง Planning และบัญชีไม่ได้

-- ===================== D2 ผู้ปิดยอด / ผู้รับทราบ (เทียบด้วยบัญชีผู้ใช้ ไม่ใช่ชื่อ) =====================
alter table public.stock_closings add column if not exists closed_uid uuid;
alter table public.stock_closings add column if not exists planning_uid uuid;
alter table public.stock_closings add column if not exists account_uid uuid;

-- ===================== A4 Model ของรายการ =====================
-- Model ของใบรับที่ของชิ้นนั้นมา (ผ่านรายการในกล่อง ⇒ กล่อง) ⇒ ไม่รู้ ⇒ Model เดียวของ part (part ร่วม ⇒ null)
create or replace function public.ledger_item_model(p_item uuid, p_lpn uuid, p_part text)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select g.model_code from public.lpn_items i join public.grn_lines gl on gl.id = i.grn_line_id join public.grns g on g.id = gl.grn_id
      where i.id = p_item),
    (select g.model_code from public.lpns l join public.grns g on g.id = l.grn_id where l.id = p_lpn),
    (select min(pm.model_code) from public.parts p join public.part_models pm on pm.part_id = p.id
      where p.part_no = p_part having count(distinct pm.model_code) = 1))
$$;

-- ===================== A4 A6 A7 รายการบัญชีคุม =====================
-- at = วันที่ลงบัญชี: ใบเบิก / FM-P-005 ใช้วันที่ในเอกสาร (เวลาตามที่บันทึก) · ปรับยอดใช้เวลาอนุมัติ · นอกนั้นเวลาที่บันทึก
create or replace function public.stock_ledger_entries(p_parts text[], p_to timestamptz)
returns table (at timestamptz, part_no text, kind text, col text, qty numeric, inv_no text, order_no text, order_date date,
               doc_no text, lot text, note text, model_code text)
language sql stable security definer set search_path = public
as $$
  select x.* from (
    select
      case
        when t.kind in ('ISSUE', 'RETURN') and q.doc_date is not null
          then (q.doc_date + (t.created_at at time zone 'Asia/Bangkok')::time) at time zone 'Asia/Bangkok'
        when t.kind = 'ADJ' then coalesce(t.decided_at, t.created_at)
        else t.created_at
      end as at,
      t.part_no,
      t.kind,
      case
        when t.kind = 'RECEIVE' then case when coalesce(g.replacement, false) then 'recv_rep' else 'recv' end
        when t.kind in ('ISSUE', 'RETURN') then case q.kind when 'qc' then 'qc' when 'ng' then 'ng' else 'issue' end
        when t.kind = 'QI' then 'ng'
        else 'adj'
      end as col,
      case
        when t.kind = 'RETURN' then -t.qty
        when t.kind = 'QI' then t.ng_qty
        when t.kind = 'ADJ' then t.new_qty - t.qty
        else t.qty
      end as qty,
      case when t.kind = 'RECEIVE' then i.invoice_no end as inv_no,
      case when t.kind = 'RECEIVE' then i.po_no end as order_no,
      case when t.kind = 'RECEIVE' then i.doc_date end as order_date,
      case
        when t.kind in ('ISSUE', 'RETURN') then coalesce(q.doc_no, q.req_no, t.ref, t.doc_no)
        when t.kind = 'RECEIVE' then g.grn_no
        else t.doc_no
      end as doc_no,
      g.grn_no as lot,
      coalesce(t.reason, case when q.kind = 'fm005' then 'กระทบยอด FM-P-005' end) as note,
      coalesce(case when t.kind in ('ISSUE', 'RETURN') then q.model_code end, gi.model_code, g.model_code, sole.model_code) as model_code
    from public.wms_tx t
    left join public.lpns l on l.id = t.lpn_id
    left join public.grns g on g.id = l.grn_id
    left join public.invoices i on i.id = g.invoice_id
    left join public.requisitions q on q.id = t.requisition_id
    left join public.lpn_items it on it.id = t.lpn_item_id
    left join public.grn_lines gl on gl.id = it.grn_line_id
    left join public.grns gi on gi.id = gl.grn_id
    left join lateral (
      select min(pm.model_code) as model_code from public.parts p join public.part_models pm on pm.part_id = p.id
      where p.part_no = t.part_no having count(distinct pm.model_code) = 1
    ) sole on true
    where public.is_staff() and t.env = public.wms_env() and t.part_no = any (p_parts)
      and (t.kind in ('RECEIVE', 'ISSUE', 'RETURN') or (t.kind = 'QI' and t.ng_qty > 0) or (t.kind = 'ADJ' and t.status = 'approved'))
      and (t.kind <> 'RECEIVE' or g.status is distinct from 'void')
  ) x
  where x.at < p_to
  -- เวลาเดียวกัน (เช่น เบิก FIFO หลายกล่องในคำสั่งเดียว) ⇒ เอกสารเดียวกันอยู่ติดกัน รวมเป็นบรรทัดเดียวได้
  order by x.at, x.doc_no, x.col, x.qty desc
$$;

-- ชื่อเดิม (คอลัมน์เดิม) ใช้วันที่ลงบัญชีแบบใหม่
create or replace function public.stock_ledger_rows(p_parts text[], p_to timestamptz)
returns table (at timestamptz, part_no text, kind text, col text, qty numeric, inv_no text, order_no text, order_date date, doc_no text, lot text, note text)
language sql stable security definer set search_path = public
as $$
  select e.at, e.part_no, e.kind, e.col, e.qty, e.inv_no, e.order_no, e.order_date, e.doc_no, e.lot, e.note
  from public.stock_ledger_entries(p_parts, p_to) e
  where public.is_staff()
$$;

-- หน้าเว็บ: ก้อนเดียว (jsonb) + Model ของรายการ
create or replace function public.stock_ledger_json(p_parts text[], p_to timestamptz)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.at, r.doc_no, r.col, r.qty desc), '[]') from public.stock_ledger_entries(p_parts, p_to) r
  where public.is_staff()
$$;

-- ยอดต่อ part ของ Model ในเดือน: เฉพาะรายการที่เป็นของ Model นี้ (ตรงกับบัญชีคุมฝั่งเว็บ)
create or replace function public.ledger_month_totals(p_model text, p_month text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with b as (
    select (p_month || '-01 00:00 Asia/Bangkok')::timestamptz as t0,
           ((p_month || '-01')::date + interval '1 month')::date::text as next_day
  ), rng as (
    select t0, (next_day || ' 00:00 Asia/Bangkok')::timestamptz as t1 from b
  ), mp as (
    select p.part_no from public.parts p join public.part_models m on m.part_id = p.id where m.model_code = p_model
  ), r as (
    select x.* from rng, public.stock_ledger_entries((select coalesce(array_agg(part_no), '{}') from mp), rng.t1) x
    where x.model_code = p_model
  ), agg as (
    select mp.part_no,
      coalesce(sum(case when r.col in ('recv', 'recv_rep', 'adj') then r.qty else -r.qty end) filter (where r.at < rng.t0), 0) as opening,
      coalesce(sum(r.qty) filter (where r.at >= rng.t0 and (r.col in ('recv', 'recv_rep') or (r.col = 'adj' and r.qty > 0))), 0) as qty_in,
      coalesce(sum(case when r.col = 'adj' then -r.qty else r.qty end)
        filter (where r.at >= rng.t0 and (r.col in ('issue', 'ng', 'qc') or (r.col = 'adj' and r.qty < 0))), 0) as qty_out
    from mp cross join rng left join r on r.part_no = mp.part_no
    group by mp.part_no
  )
  select coalesce(jsonb_agg(jsonb_build_object('partNo', part_no, 'opening', opening, 'in', qty_in, 'out', qty_out,
    'closing', opening + qty_in - qty_out) order by part_no), '[]')
  from agg
$$;

-- ===================== A6 ใบ QC / NG ที่ไม่มี Model ติดล็อกปิดเดือน =====================
-- ใบที่มี Model ตรวจที่ trigger ของใบเบิกแล้ว · ใบที่ไม่มี Model ตรวจราย part ตาม Model ของใบรับที่ของมา
create or replace function public.trg_wms_tx_month_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req public.requisitions;
  v_model text;
begin
  if new.kind not in ('ISSUE', 'RETURN') or new.requisition_id is null then return new; end if;
  select * into v_req from public.requisitions where id = new.requisition_id;
  if v_req.id is null or v_req.model_code is not null then return new; end if;
  v_model := public.ledger_item_model(new.lpn_item_id, new.lpn_id, new.part_no);
  if v_model is not null and public.month_closed(v_model, v_req.doc_date) then
    raise exception 'บัญชีคุม % เดือน % ปิดยอดแล้ว (% ในใบนี้เป็นของ %) · ให้ผู้มีสิทธิ์เปิดเดือนก่อน',
      v_model, to_char(v_req.doc_date, 'YYYY-MM'), new.part_no, v_model;
  end if;
  return new;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'wms_tx_month_lock' and tgrelid = 'public.wms_tx'::regclass) then
    create trigger wms_tx_month_lock before insert on public.wms_tx for each row execute function public.trg_wms_tx_month_lock();
  end if;
end;
$$;

-- ===================== A9 FM-P-005 ห้ามซ้ำ + ล็อกระหว่างกระทบยอด =====================
create unique index if not exists requisitions_fm005_doc_uq on public.requisitions (env, doc_no) where kind = 'fm005' and status = 'posted';

-- ล็อก (Model + วัน) จนจบรายการ: กระทบยอด FM-P-005 กับสแกนเบิก / บันทึก / ยกเลิกใบย่อยของวันเดียวกันไม่ทำพร้อมกัน
create or replace function public.fm005_lock(p_model text, p_day date)
returns void
language sql security definer set search_path = public
as $$
  select pg_advisory_xact_lock(hashtextextended('fm005|' || public.wms_env() || '|' || coalesce(p_model, '') || '|' || p_day::text, 0))
$$;

create or replace function public.requisition_post(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'line');
  v_day date := coalesce(nullif(p ->> 'docDate', '')::date, (now() at time zone 'Asia/Bangkok')::date);
  v_model text := nullif(p ->> 'modelCode', '');
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
  -- ใบย่อยเข้าไลน์: รอให้การกระทบ FM-P-005 ของ Model + วันเดียวกันที่กำลังทำจบก่อน
  if v_kind = 'line' and v_model is not null then perform public.fm005_lock(v_model, v_day); end if;
  v_no := public.next_doc_no('RQ');
  v_ref := coalesce(nullif(trim(p ->> 'docNo'), ''), v_no);
  insert into public.requisitions (kind, req_no, doc_no, doc_date, model_code, fg_code, fg_qty, from_dept, to_dept, note, created_code)
  values (v_kind, v_no, nullif(trim(p ->> 'docNo'), ''), v_day,
          v_model, nullif(p ->> 'fgCode', ''), nullif(p ->> 'fgQty', '')::numeric, nullif(p ->> 'fromDept', ''), nullif(p ->> 'toDept', ''),
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

-- FM-P-005 ยอดรวมจบวัน: เหมือน 0014 + ล็อกเลขที่ (กดซ้ำพร้อมกัน) และล็อก (Model + วัน) ก่อนอ่านใบย่อย
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
  -- กดบันทึกเลขเดียวกันพร้อมกัน: คนที่สองรอ แล้วเห็นว่าบันทึกไปแล้ว
  perform pg_advisory_xact_lock(hashtextextended('fm005doc|' || public.wms_env() || '|' || v_doc, 0));
  if exists (select 1 from public.requisitions where env = public.wms_env() and kind = 'fm005' and doc_no = v_doc and status = 'posted') then
    raise exception 'FM-P-005 เลขที่ % บันทึกไปแล้ว', v_doc;
  end if;
  -- สแกนเบิก / ใบย่อยของ Model + วันนี้ รอจนกระทบเสร็จ (ไม่งั้นใบย่อยที่เพิ่มระหว่างนี้ถูกตัดซ้ำ)
  perform public.fm005_lock(v_model, v_date);
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

-- สแกนเบิก: เหมือน 0021 + ใบย่อยเข้าไลน์ล็อก (Model + วัน) ก่อนล็อกกล่อง (ลำดับเดียวกับการกระทบยอด ไม่ติดตายกัน)
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
  if v_kind = 'line' then perform public.fm005_lock(v_model, v_day); end if;
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

-- ยกเลิกใบเบิก: เหมือน 0022 + ใบย่อยเข้าไลน์ล็อก (Model + วัน) ก่อนล็อกใบ
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
  select * into v from public.requisitions where id = p_id and env = public.wms_env();
  if v.id is not null and v.kind = 'line' and v.model_code is not null then perform public.fm005_lock(v.model_code, v.doc_date); end if;
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

-- ===================== A8 รวม / แยกกล่อง: วันรับเข้าเดิม + เลขเคส =====================
-- รวมกล่อง: เหมือน 0022 + กล่องรวมใช้วันรับเข้าเก่าสุดของกล่องต้นทาง (FIFO) · เคสเดียวกันทุกกล่อง ⇒ คงเลขเคส
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
  insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no, created_at)
  select v_no, v_first.grn_id, v_to, bool_or(hold),
         case when count(case_no) = count(*) and count(distinct case_no) = 1 then min(case_no) end,
         min(created_at)
  from public.lpns where id = any (p_lpn_ids)
  returning id into v_new;
  update public.lpn_items set prev_lpn_id = lpn_id, lpn_id = v_new where lpn_id = any (p_lpn_ids);
  update public.lpns set status = 'merged', merged_into = v_new where id = any (p_lpn_ids);
  insert into public.wms_tx (kind, doc_no, lpn_id, to_loc, ref, created_code)
  values ('MERGE', v_no, v_new, v_to,
          (select string_agg(lpn_no, ', ' order by lpn_no) from public.lpns where id = any (p_lpn_ids)), public.my_code());
  return jsonb_build_object('lpnId', v_new, 'lpnNo', v_no);
end;
$$;

-- แยกกล่อง: เหมือน 0011 + กล่องใหม่ใช้วันรับเข้าและเลขเคสของกล่องเดิม
create or replace function public.split_lpn(p_lpn uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.lpns;
  v_new uuid;
  v_no text;
  r record;
  it public.lpn_items;
  v_moved int := 0;
begin
  perform public.require_perm('label.print');
  select * into v from public.lpns where id = p_lpn and status = 'active' and env = public.wms_env() for update;
  if v.id is null then raise exception 'ไม่พบป้าย หรือป้ายนี้ใช้งานไม่ได้แล้ว'; end if;
  v_no := public.next_doc_no('LPN');
  insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no, created_at)
  values (v_no, v.grn_id, v.location_code, v.hold, v.case_no, v.created_at)
  returning id into v_new;

  for r in
    select (e ->> 'itemId')::uuid as item_id, (e ->> 'qty')::numeric as qty
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
  loop
    continue when r.qty is null or r.qty <= 0;
    select * into it from public.lpn_items where id = r.item_id and lpn_id = p_lpn for update;
    if it.id is null then raise exception 'รายการที่เลือกไม่ได้อยู่ในกล่องนี้'; end if;
    if r.qty <> trunc(r.qty) then raise exception 'จำนวนต้องเป็นจำนวนเต็ม'; end if;
    if r.qty > it.qty then raise exception '% มีในกล่องแค่ % ชิ้น', it.part_no, it.qty; end if;
    if r.qty = it.qty then
      update public.lpn_items set lpn_id = v_new, prev_lpn_id = null where id = it.id;
    else
      update public.lpn_items set qty = qty - r.qty where id = it.id;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_new, it.grn_line_id, it.part_no, r.qty);
    end if;
    v_moved := v_moved + 1;
  end loop;

  if v_moved = 0 then raise exception 'ใส่จำนวนที่จะแยกออกอย่างน้อย 1 รายการ'; end if;
  if not exists (select 1 from public.lpn_items where lpn_id = p_lpn and qty > 0) then
    raise exception 'ต้องเหลือของในกล่องเดิมอย่างน้อย 1 รายการ · ถ้าจะย้ายทั้งกล่องใช้ "ย้ายที่" ในแท็บสแกน';
  end if;

  -- กล่องรวมถูกห้ามเบิกเพราะมีของรอ MI3: หลังแยก ห้ามเบิกเฉพาะกล่องที่ยังมี part ที่ต้องตรวจ
  if v.hold then
    update public.lpns l set hold = exists (
      select 1 from public.lpn_items i join public.grn_lines g on g.id = i.grn_line_id
      where i.lpn_id = l.id and i.qty > 0 and g.needs_qi
    ) where l.id in (p_lpn, v_new);
  end if;

  insert into public.wms_tx (kind, doc_no, lpn_id, from_loc, to_loc, ref, created_code)
  values ('SPLIT', v_no, p_lpn, v.location_code, v.location_code,
          (select string_agg(part_no || ' ' || qty::text, ', ' order by part_no) from public.lpn_items where lpn_id = v_new),
          public.my_code());
  return jsonb_build_object('lpnId', v_new, 'lpnNo', v_no);
end;
$$;

-- ===================== D2 ปิดยอด / รับทราบ =====================
-- ปิดยอด: เหมือน 0015 + เก็บบัญชีผู้ปิด · ปิดซ้ำหลังเปิดเดือน ล้างผู้รับทราบทั้งสองฝั่ง
create or replace function public.stock_close(p_model text, p_month text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_this text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
  v_id uuid;
begin
  perform public.require_perm('ledger.close');
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'เดือนไม่ถูกต้อง'; end if;
  if p_month >= v_this then raise exception 'ปิดยอดได้เมื่อจบเดือน % แล้ว', p_month; end if;
  if not exists (select 1 from public.product_models where code = p_model) then raise exception 'ไม่พบ Model %', p_model; end if;
  if exists (select 1 from public.stock_closings where env = public.wms_env() and model_code = p_model and month = p_month and status = 'closed') then
    raise exception '% เดือน % ปิดยอดไปแล้ว', p_model, p_month;
  end if;
  insert into public.stock_closings (model_code, month, status, totals, closed_by, closed_uid, closed_at, note)
  values (p_model, p_month, 'closed', public.ledger_month_totals(p_model, p_month), public.my_label(), auth.uid(), now(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (env, model_code, month) do update set
    status = 'closed', totals = excluded.totals, closed_by = excluded.closed_by, closed_uid = excluded.closed_uid, closed_at = excluded.closed_at,
    note = excluded.note, planning_by = null, planning_at = null, planning_uid = null, account_by = null, account_at = null, account_uid = null
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- รับทราบยอด: side = planning | account · คนปิดยอดรับทราบเองไม่ได้ · คนเดียวรับทราบทั้งสองฝั่งไม่ได้
create or replace function public.stock_close_ack(p_id uuid, p_side text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.stock_closings;
  v_me uuid := auth.uid();
  v_label text := public.my_label();
begin
  if p_side not in ('planning', 'account') then raise exception 'side ต้องเป็น planning หรือ account'; end if;
  perform public.require_perm(case p_side when 'planning' then 'ledger.ack.planning' else 'ledger.ack.account' end);
  select * into v from public.stock_closings where id = p_id and env = public.wms_env() and status = 'closed' for update;
  if v.id is null or (p_side = 'planning' and v.planning_at is not null) or (p_side = 'account' and v.account_at is not null) then
    raise exception 'ไม่พบรายการ หรือรับทราบไปแล้ว';
  end if;
  if v.closed_uid = v_me or (v.closed_uid is null and v.closed_by = v_label) then
    raise exception 'คนที่ปิดยอดรับทราบเองไม่ได้ · ให้ % กดรับทราบ', case p_side when 'planning' then 'Planning' else 'บัญชี' end;
  end if;
  if (p_side = 'planning' and (v.account_uid = v_me or (v.account_uid is null and v.account_by = v_label)))
     or (p_side = 'account' and (v.planning_uid = v_me or (v.planning_uid is null and v.planning_by = v_label))) then
    raise exception 'รับทราบอีกฝั่งไปแล้ว · ฝั่ง % ต้องเป็นอีกคน', case p_side when 'planning' then 'Planning' else 'บัญชี' end;
  end if;
  if p_side = 'planning' then
    update public.stock_closings set planning_by = v_label, planning_at = now(), planning_uid = v_me where id = p_id;
  else
    update public.stock_closings set account_by = v_label, account_at = now(), account_uid = v_me where id = p_id;
  end if;
end;
$$;

-- ===================== สิทธิ์เรียกฟังก์ชัน =====================
-- ฟังก์ชันภายใน (เรียกจากฟังก์ชันอื่นเท่านั้น)
do $$
declare
  f text;
begin
  foreach f in array array['ledger_item_model(uuid, uuid, text)', 'stock_ledger_entries(text[], timestamptz)', 'fm005_lock(text, date)',
    'trg_wms_tx_month_lock()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;
