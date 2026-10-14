-- กระบวนการรับเข้า → BOI → MI3 / MRA → NG พร้อมย้อนกลับไปหา lot และ invoice
-- กฎเดียวกับ web/src/inventory/ledger.ts (demo) แต่บังคับที่ฐานข้อมูลเพื่อไม่ให้ข้ามได้

-- ===================== Master =====================
create table public.customers (
  id    text primary key,
  name  text not null
);

create table public.product_models (
  code                 text primary key,
  customer_id          text    not null references public.customers (id),
  requires_inspection  boolean not null default true  -- ต้องผ่าน MI3 ก่อนเบิก MRA
);

alter table public.parts
  add column part_type   text,
  add column customer_id text references public.customers (id);

create table public.part_models (
  part_id     uuid not null references public.parts (id) on delete cascade,
  model_code  text not null references public.product_models (code),
  primary key (part_id, model_code)
);

-- กฎแนะนำโซน: ลูกค้า + กลุ่มสินค้า (part_type null = ค่าเริ่มต้นของลูกค้า)
create table public.zone_rules (
  id           bigint generated always as identity primary key,
  customer_id  text not null references public.customers (id),
  part_type    text,
  zone_id      text not null references public.zones (id),
  unique nulls not distinct (customer_id, part_type)
);

-- ===================== ใบรับเข้า (invoice) และ lot =====================
alter table public.inbound_receipts
  add column invoice_date         date,
  add column customer_id          text references public.customers (id),
  add column model_code           text references public.product_models (code),
  add column image_path           text,   -- ภาพ invoice ใน Supabase Storage (หลักฐาน)
  add column extraction           jsonb,  -- ผลอ่านดิบจาก AI ก่อนคนแก้ไข
  add column extraction_provider  text check (extraction_provider in ('mock', 'qwen', 'manual'));

-- 1 บรรทัดใบรับเข้า = 1 lot: qty คือยอดที่นับได้จริง (อาจเป็น 0 ถ้าไม่มาเลย)
alter table public.inbound_receipt_lines drop constraint inbound_receipt_lines_qty_check;
alter table public.inbound_receipt_lines
  add constraint inbound_receipt_lines_qty_check check (qty >= 0),
  add column invoice_qty  numeric not null default 0 check (invoice_qty >= 0),
  add column damaged_qty  numeric not null default 0 check (damaged_qty >= 0),
  add column zone_id      text references public.zones (id),
  add constraint damaged_within_counted check (damaged_qty <= qty);

-- ===================== การเคลื่อนไหวแบบ bucket =====================
alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements
  add column lot_id       uuid references public.inbound_receipt_lines (id),
  add column from_bucket  text check (from_bucket in ('BOI', 'MI3', 'MRA', 'NG_CUSTOMER', 'NG_SUPPLIER', 'RETURNED')),
  add column to_bucket    text check (to_bucket in ('BOI', 'MI3', 'MRA', 'NG_CUSTOMER', 'NG_SUPPLIER', 'RETURNED')),
  add column note         text,
  add constraint stock_movements_kind_check check (kind in (
    'receive', 'issue', 'transfer', 'adjust',
    'receive_ng', 'to_mi3', 'mi3_pass', 'mi3_ng', 'issue_mra', 'ng_in_process', 'return_ng'
  ));

create index stock_movements_lot_idx on public.stock_movements (lot_id);

-- ยอดคงเหลือของแต่ละ lot ในแต่ละ bucket
create view public.lot_bucket_balances with (security_invoker = true) as
select lot_id, bucket, sum(delta) as qty
from (
  select lot_id, to_bucket as bucket, qty as delta from public.stock_movements where lot_id is not null and to_bucket is not null
  union all
  select lot_id, from_bucket, -qty from public.stock_movements where lot_id is not null and from_bucket is not null
) m
group by lot_id, bucket;

create or replace function public.lot_balance(p_lot uuid, p_bucket text)
returns numeric
language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(case when to_bucket = p_bucket then qty else 0 end)
                - sum(case when from_bucket = p_bucket then qty else 0 end), 0)
  from stock_movements where lot_id = p_lot
$$;

-- ยืนยันรับเข้า (แทนฉบับเดิม): ยอดดีเข้า BOI, ของเสียหายเข้า NG ส่งคืน Supplier
create or replace function public.post_receipt(p_receipt_id uuid)
returns void
language plpgsql security invoker set search_path = public
as $$
declare
  l record;
  good numeric;
begin
  update inbound_receipts
     set status = 'received', received_at = now(), received_by = auth.uid()
   where id = p_receipt_id and status = 'draft';
  if not found then
    raise exception 'Receipt % is not in draft status', p_receipt_id;
  end if;

  for l in select * from inbound_receipt_lines where receipt_id = p_receipt_id loop
    good := l.qty - l.damaged_qty;
    if good > 0 then
      insert into stock_movements (part_id, lot_id, to_location_id, to_bucket, qty, kind, ref_receipt_line_id)
      values (l.part_id, l.id, l.putaway_location_id, 'BOI', good, 'receive', l.id);
      if l.putaway_location_id is not null then
        insert into stock (part_id, location_id, qty) values (l.part_id, l.putaway_location_id, good)
        on conflict (part_id, location_id) do update set qty = stock.qty + excluded.qty, updated_at = now();
      end if;
    end if;
    if l.damaged_qty > 0 then
      insert into stock_movements (part_id, lot_id, to_bucket, qty, kind, ref_receipt_line_id, note)
      values (l.part_id, l.id, 'NG_SUPPLIER', l.damaged_qty, 'receive_ng', l.id, 'เสียหายตอนรับเข้า');
    end if;
  end loop;
end;
$$;

-- บันทึกการเคลื่อนไหวของ lot พร้อมตรวจกฎ (ล็อก lot ไว้กันบันทึกพร้อมกันจนยอดติดลบ)
create or replace function public.move_lot(
  p_lot   uuid,
  p_kind  text,
  p_qty   numeric,
  p_to    text default null,
  p_from  text default null,
  p_note  text default null
)
returns bigint
language plpgsql security invoker set search_path = public
as $$
declare
  lot          record;
  v_from       text;
  v_to         text;
  needs_qc     boolean;
  can_issue    numeric;
  new_id       bigint;
begin
  select l.*, r.model_code into lot
    from inbound_receipt_lines l join inbound_receipts r on r.id = l.receipt_id
   where l.id = p_lot
     for update of l;
  if not found then raise exception 'Lot % not found', p_lot; end if;
  if p_qty is null or p_qty <= 0 or p_qty <> trunc(p_qty) then
    raise exception 'Quantity must be a positive whole number';
  end if;

  case p_kind
    when 'to_mi3'        then v_from := 'BOI'; v_to := 'MI3';
    when 'mi3_pass'      then v_from := 'MI3'; v_to := 'BOI';
    when 'issue_mra'     then v_from := 'BOI'; v_to := 'MRA';
    when 'mi3_ng'        then v_from := 'MI3'; v_to := coalesce(p_to, 'NG_CUSTOMER');
    when 'ng_in_process' then v_from := 'MRA'; v_to := coalesce(p_to, 'NG_CUSTOMER');
    when 'return_ng'     then v_from := p_from; v_to := 'RETURNED';
    else raise exception 'Unsupported movement kind %', p_kind;
  end case;

  if p_kind in ('mi3_ng', 'ng_in_process') and v_to not in ('NG_CUSTOMER', 'NG_SUPPLIER') then
    raise exception 'NG must go to NG_CUSTOMER or NG_SUPPLIER';
  end if;
  if p_kind = 'return_ng' and (v_from is null or v_from not in ('NG_CUSTOMER', 'NG_SUPPLIER')) then
    raise exception 'Only NG stock can be returned';
  end if;

  if p_qty > lot_balance(p_lot, v_from) then
    raise exception 'Lot % has only % in %', p_lot, lot_balance(p_lot, v_from), v_from;
  end if;

  if p_kind = 'issue_mra' then
    select coalesce(m.requires_inspection, true) into needs_qc from product_models m where m.code = lot.model_code;
    if coalesce(needs_qc, true) then
      select coalesce(sum(case when kind = 'mi3_pass' then qty else 0 end), 0)
           - coalesce(sum(case when kind = 'issue_mra' then qty else 0 end), 0)
        into can_issue
        from stock_movements where lot_id = p_lot;
      if p_qty > can_issue then
        raise exception 'Model % must pass MI3 before MRA issue (can issue %)', lot.model_code, can_issue;
      end if;
    end if;
  end if;

  insert into stock_movements (part_id, lot_id, from_bucket, to_bucket, qty, kind, note)
  values (lot.part_id, p_lot, v_from, v_to, p_qty, p_kind, p_note)
  returning id into new_id;
  return new_id;
end;
$$;

-- ===================== RLS =====================
do $$
declare
  t text;
begin
  foreach t in array array['customers', 'product_models', 'part_models', 'zone_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s staff access" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end;
$$;
