-- Step 0.4: รับของตาม Packing List + Invoice → GRN → ป้าย QR (LPN) → สแกนหน้างาน → กระทบยอด Invoice
-- พร้อมหลังบ้าน: ตารางสิทธิ์ที่ admin แก้ได้, หัวหน้าโซน, โหมดทดลอง/ใช้งานจริง
-- ทุกการเปลี่ยนยอดทำผ่านฟังก์ชันในไฟล์นี้เท่านั้น (ตารางให้สิทธิ์แค่อ่าน) เพื่อให้กฎ เช่น ห้ามเบิกของรอ MI3 ข้ามไม่ได้

-- ===================== บทบาท: เพิ่มวิศวกร =====================
alter table public.staff_profiles drop constraint staff_profiles_role_check;
alter table public.staff_profiles add constraint staff_profiles_role_check
  check (role in ('warehouse', 'mi3', 'production', 'planner', 'engineer', 'manager', 'admin'));
comment on column public.staff_profiles.role is
  'warehouse = คลัง, mi3 = MI3 คัดงาน, production = ผลิต, planner = วางแผน, engineer = วิศวกร, manager = ผู้จัดการ, admin = ผู้ดูแลระบบ';

-- ===================== ตารางสิทธิ์ (admin ติ๊กเปิด/ปิดได้เอง) =====================
create table public.role_permissions (
  role  text not null check (role in ('warehouse', 'mi3', 'production', 'planner', 'engineer', 'manager')),
  perm  text not null,
  primary key (role, perm)
);
comment on table public.role_permissions is 'มีแถว = บทบาทนั้นทำงานนั้นได้ · admin ทำได้ทุกอย่างเสมอ (ไม่อยู่ในตาราง กันล็อกตัวเองออก)';

insert into public.role_permissions (role, perm) values
  ('warehouse', 'receive.create'), ('warehouse', 'label.print'), ('warehouse', 'scan.put'), ('warehouse', 'scan.move'),
  ('warehouse', 'scan.issue'), ('warehouse', 'scan.adjust'), ('warehouse', 'scan.count'), ('warehouse', 'invoice.report'),
  ('mi3', 'scan.qi'), ('mi3', 'scan.move'), ('mi3', 'label.print'),
  ('engineer', 'scan.adjust.approve'), ('engineer', 'invoice.close'), ('engineer', 'invoice.report'),
  ('manager', 'scan.adjust.approve'), ('manager', 'invoice.close'), ('manager', 'invoice.report'), ('manager', 'accesslog.view'), ('manager', 'master.edit');

create or replace function public.has_perm(p_perm text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.staff_role() is null then false
    when public.staff_role() = 'admin' then true
    else exists (select 1 from public.role_permissions where role = public.staff_role() and perm = p_perm)
  end
$$;

-- สิทธิ์ทั้งหมดของผู้ใช้ปัจจุบัน (หน้าเว็บใช้ซ่อน/แสดงปุ่ม — ตัวจริงบังคับในแต่ละฟังก์ชัน)
create or replace function public.my_permissions()
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when public.staff_role() = 'admin' then array['*']
    else coalesce((select array_agg(perm order by perm) from public.role_permissions where role = public.staff_role()), '{}')
  end
$$;

-- ===================== ตั้งค่าระบบ =====================
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id)
);
insert into public.app_settings (key, value) values
  ('wms_mode', '"trial"'),               -- trial = โหมดทดลอง (ล้างได้), live = ใช้งานจริง
  ('qi_part_types', '["RIM", "HUB"]');   -- กลุ่ม part ที่ MI3 ต้องตรวจ (เฉพาะ Model ที่ requires_inspection)

create or replace function public.wms_trial()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select value #>> '{}' from public.app_settings where key = 'wms_mode'), 'trial') = 'trial'
$$;

-- ===================== หัวหน้าโซน =====================
create table public.zone_heads (
  zone_id     text primary key references public.zones (id) on delete cascade,
  staff_id    uuid not null references public.staff_profiles (id) on delete cascade,
  updated_at  timestamptz not null default now()
);

-- ชื่อหัวหน้าโซน (staff_profiles อ่านได้เฉพาะ admin/manager จึงเปิดเฉพาะชื่อผ่านฟังก์ชันนี้)
create or replace function public.zone_head_list()
returns table (zone_id text, staff_id uuid, employee_code text, full_name text)
language sql stable security definer set search_path = public
as $$
  select h.zone_id, h.staff_id, s.employee_code, s.full_name
  from public.zone_heads h join public.staff_profiles s on s.id = h.staff_id
  where public.is_staff()
$$;

-- รายชื่อพนักงานแบบย่อ (ให้หัวหน้าเลือกคน, แสดงชื่อผู้ทำรายการ)
create or replace function public.staff_directory()
returns table (id uuid, employee_code text, full_name text, role text)
language sql stable security definer set search_path = public
as $$
  select id, employee_code, full_name, role from public.staff_profiles where active and public.is_staff() order by employee_code
$$;

-- ===================== ช่องเก็บ =====================
alter table public.locations add column kind text not null default 'bin' check (kind in ('bin', 'floor', 'staging', 'hold', 'ng'));
alter table public.locations add column active boolean not null default true;

-- ===================== เลขเอกสาร (GRN-2610-0001, LPN-2610-000101 …) =====================
create table public.doc_counters (
  prefix  text    not null,
  yymm    text    not null,
  trial   boolean not null,
  last    integer not null default 0,
  primary key (prefix, yymm, trial)
);

create or replace function public.next_doc_no(p_prefix text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_yymm text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM');
  v_trial boolean := public.wms_trial();
  v_n integer;
begin
  insert into public.doc_counters as c (prefix, yymm, trial, last) values (p_prefix, v_yymm, v_trial, 1)
  on conflict (prefix, yymm, trial) do update set last = c.last + 1
  returning last into v_n;
  return p_prefix || '-' || v_yymm || '-' || lpad(v_n::text, case when p_prefix = 'LPN' then 6 else 4 end, '0');
end;
$$;

-- ===================== Invoice / Packing List / GRN =====================
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  trial          boolean not null default public.wms_trial(),
  invoice_no     text not null,
  customer_id    text references public.customers (id),
  po_no          text,
  doc_date       date,
  movement_type  text,
  image_paths    text[] not null default '{}',
  extraction     jsonb,
  status         text not null default 'open' check (status in ('open', 'complete', 'discrepancy_reported', 'closed')),
  status_note    text,
  status_by      uuid references auth.users (id),
  status_at      timestamptz,
  created_by     uuid references auth.users (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (invoice_no, trial)
);

create table public.invoice_lines (
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  line_no      integer not null,
  part_no      text not null,
  description  text,
  qty          numeric not null check (qty >= 0),
  primary key (invoice_id, line_no)
);

create table public.packing_lists (
  id           uuid primary key default gen_random_uuid(),
  trial        boolean not null default public.wms_trial(),
  ref_doc      text not null,
  so_no        text,
  packages     text,
  invoice_id   uuid references public.invoices (id),
  image_paths  text[] not null default '{}',
  extraction   jsonb,
  created_at   timestamptz not null default now()
);

create table public.grns (
  id               uuid primary key default gen_random_uuid(),
  trial            boolean not null default public.wms_trial(),
  grn_no           text not null,
  packing_list_id  uuid not null references public.packing_lists (id),
  invoice_id       uuid references public.invoices (id),
  customer_id      text references public.customers (id),
  model_code       text references public.product_models (code),
  received_at      timestamptz not null default now(),
  received_by      uuid references auth.users (id) default auth.uid(),
  receiver_code    text,
  note             text,
  unique (grn_no, trial)
);

create table public.grn_lines (
  id             uuid primary key default gen_random_uuid(),
  grn_id         uuid not null references public.grns (id) on delete cascade,
  line_no        integer not null,
  part_no        text not null,
  description    text,
  part_type      text,
  pl_qty         numeric not null default 0 check (pl_qty >= 0),
  counted_qty    numeric not null check (counted_qty >= 0),
  invoice_qty    numeric,
  needs_qi       boolean not null default false,
  home_location  text,
  unique (grn_id, line_no)
);

-- ===================== ป้าย (LPN) =====================
create table public.lpns (
  id             uuid primary key default gen_random_uuid(),
  trial          boolean not null default public.wms_trial(),
  lpn_no         text not null,
  grn_id         uuid references public.grns (id),
  location_code  text not null,
  hold           boolean not null default false,  -- รอ MI3: ห้ามเบิก
  status         text not null default 'active' check (status in ('active', 'empty', 'merged')),
  merged_into    uuid references public.lpns (id),
  created_by     uuid references auth.users (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (lpn_no, trial)
);

create table public.lpn_items (
  id           uuid primary key default gen_random_uuid(),
  lpn_id       uuid not null references public.lpns (id) on delete cascade,
  grn_line_id  uuid not null references public.grn_lines (id),
  part_no      text not null,
  qty          numeric not null check (qty >= 0)
);
create index lpn_items_lpn_idx on public.lpn_items (lpn_id);

-- ===================== ความเคลื่อนไหวจากการสแกน =====================
create table public.wms_tx (
  id            uuid primary key default gen_random_uuid(),
  trial         boolean not null default public.wms_trial(),
  kind          text not null check (kind in ('RECEIVE', 'PUT', 'MOVE', 'ISSUE', 'ADJ', 'COUNT', 'QI', 'MERGE')),
  doc_no        text,
  lpn_id        uuid references public.lpns (id),
  lpn_item_id   uuid references public.lpn_items (id),
  part_no       text,
  qty           numeric,
  new_qty       numeric,
  pass_qty      numeric,
  ng_qty        numeric,
  from_loc      text,
  to_loc        text,
  ref           text,
  reason        text,
  status        text not null default 'done' check (status in ('done', 'pending', 'approved', 'rejected')),
  created_by    uuid references auth.users (id) default auth.uid(),
  created_code  text,
  created_at    timestamptz not null default now(),
  decided_by    uuid references auth.users (id),
  decided_code  text,
  decided_at    timestamptz
);
create index wms_tx_lpn_idx on public.wms_tx (lpn_id, created_at desc);
create index wms_tx_created_idx on public.wms_tx (trial, created_at desc);

-- ===================== สิทธิ์ตาราง: อ่านได้ทุกพนักงาน, เขียนผ่านฟังก์ชันเท่านั้น =====================
do $$
declare
  t text;
begin
  foreach t in array array['role_permissions', 'app_settings', 'zone_heads', 'invoices', 'invoice_lines', 'packing_lists',
                           'grns', 'grn_lines', 'lpns', 'lpn_items', 'wms_tx', 'doc_counters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s read by staff" on public.%I for select to authenticated using (public.is_staff())', t, t);
  end loop;
end;
$$;

-- ===================== ฟังก์ชันช่วย =====================
create or replace function public.require_perm(p_perm text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_perm(p_perm) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้ (%)', p_perm using errcode = '42501';
  end if;
end;
$$;

create or replace function public.my_code()
returns text
language sql stable security definer set search_path = public
as $$
  select employee_code from public.staff_profiles where id = auth.uid()
$$;
