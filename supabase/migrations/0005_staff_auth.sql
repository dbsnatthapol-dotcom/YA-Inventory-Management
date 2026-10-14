-- Step 0.3: พนักงาน + บทบาท + ประวัติการเข้าใช้ และบังคับ login ทุกหน้า
-- พนักงาน login ด้วยรหัสพนักงาน: บัญชีใน auth.users ใช้อีเมลภายใน <รหัส>@staff.uam.local (ไม่มีการส่งอีเมลจริง)

create table public.staff_profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  employee_code         text not null unique,
  full_name             text not null,
  role                  text not null check (role in ('warehouse', 'mi3', 'production', 'planner', 'manager', 'admin')),
  active                boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column public.staff_profiles.role is
  'warehouse = คลัง, mi3 = MI3 คัดงาน, production = ผลิต, planner = วางแผน, manager = ผู้จัดการ, admin = ผู้ดูแลระบบ';

create table public.access_log (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  employee_code  text not null,
  event          text not null check (event in ('login', 'logout', 'password_changed')),
  user_agent     text,
  at             timestamptz not null default now()
);
create index access_log_at_idx on public.access_log (at desc);

-- บทบาทของผู้ใช้ปัจจุบัน (null = ไม่ใช่พนักงาน หรือถูกปิดบัญชี)
create or replace function public.staff_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.staff_profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.staff_role() is not null
$$;

-- บันทึกประวัติการเข้าใช้ของตัวเอง (รหัสพนักงานดึงจากโปรไฟล์ ปลอมไม่ได้)
create or replace function public.log_access(p_event text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  select employee_code into v_code from public.staff_profiles where id = auth.uid() and active;
  if v_code is null then
    raise exception 'not a staff member';
  end if;
  insert into public.access_log (user_id, employee_code, event, user_agent)
  values (auth.uid(), v_code, p_event, left(p_user_agent, 300));
  if p_event = 'password_changed' then
    update public.staff_profiles set must_change_password = false, updated_at = now() where id = auth.uid();
  end if;
end;
$$;

revoke all on function public.log_access(text, text) from public, anon;
grant execute on function public.log_access(text, text) to authenticated;
revoke all on function public.staff_role() from public, anon;
grant execute on function public.staff_role() to authenticated;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

alter table public.staff_profiles enable row level security;
alter table public.access_log enable row level security;

-- อ่านโปรไฟล์ตัวเองได้เสมอ, ผู้ดูแล/ผู้จัดการเห็นทุกคน · การสร้าง/แก้ทำผ่าน Edge Function admin-users เท่านั้น
create policy "staff read own profile" on public.staff_profiles
  for select to authenticated using (id = auth.uid() or public.staff_role() in ('admin', 'manager'));
create policy "admin read access log" on public.access_log
  for select to authenticated using (public.staff_role() in ('admin', 'manager'));

-- ===================== สิทธิ์ข้อมูลเดิม: ต้องเป็นพนักงานที่ active =====================
-- เดิม: ผังอ่านได้โดยไม่ login และทุกบัญชีที่ login เขียนได้ ⇒ เปลี่ยนเป็นตามบทบาท
do $$
declare
  t text;
begin
  foreach t in array array['floors', 'nav_nodes', 'nav_edges', 'zones', 'sites', 'site_landmarks',
                           'locations', 'parts', 'stock', 'suppliers', 'inbound_receipts',
                           'inbound_receipt_lines', 'stock_movements', 'part_demand', 'pick_trips',
                           'customers', 'product_models', 'part_models', 'zone_rules'] loop
    execute format('drop policy if exists "%s readable by everyone" on public.%I', t, t);
    execute format('drop policy if exists "%s writable by staff" on public.%I', t, t);
    execute format('drop policy if exists "%s staff access" on public.%I', t, t);
    execute format('create policy "%s read by staff" on public.%I for select to authenticated using (public.is_staff())', t, t);
  end loop;

  -- ผังโรงงาน: แก้ได้เฉพาะผู้ดูแลระบบ
  foreach t in array array['floors', 'nav_nodes', 'nav_edges', 'zones', 'sites', 'site_landmarks'] loop
    execute format('create policy "%s write by admin" on public.%I for all to authenticated using (public.staff_role() = ''admin'') with check (public.staff_role() = ''admin'')', t, t);
  end loop;

  -- ข้อมูลหลัก (part, Model, กฎโซน): ผู้ดูแลระบบและผู้จัดการ
  foreach t in array array['locations', 'parts', 'suppliers', 'customers', 'product_models', 'part_models', 'zone_rules'] loop
    execute format('create policy "%s write by admin or manager" on public.%I for all to authenticated using (public.staff_role() in (''admin'', ''manager'')) with check (public.staff_role() in (''admin'', ''manager''))', t, t);
  end loop;

  -- รายการเคลื่อนไหว: พนักงานทุกบทบาทบันทึกได้ (สิทธิ์รายขั้นตอนบังคับใน Step 0.4)
  foreach t in array array['stock', 'inbound_receipts', 'inbound_receipt_lines', 'stock_movements', 'part_demand', 'pick_trips'] loop
    execute format('create policy "%s write by staff" on public.%I for all to authenticated using (public.is_staff()) with check (public.is_staff())', t, t);
  end loop;
end;
$$;
