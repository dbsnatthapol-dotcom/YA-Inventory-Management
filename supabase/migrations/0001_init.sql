-- YA Inventory Management — โครงสร้างฐานข้อมูลเริ่มต้น (ร่าง)
-- กลุ่มตาราง: 1) ผังโรงงาน  2) สินค้า/สต็อก  3) รับเข้า  4) วิเคราะห์ระยะเดิน

-- ===================== 1) ผังโรงงาน =====================
create table public.floors (
  id         text primary key,
  name       text    not null,
  level      int     not null,
  elevation  numeric not null default 0,            -- เมตรจากพื้นดิน
  area       text    not null check (area in ('building', 'yard')),
  x          numeric not null default 0,
  z          numeric not null default 0,
  width      numeric not null,
  depth      numeric not null
);

create table public.nav_nodes (
  id        text primary key,
  floor_id  text    not null references public.floors (id) on delete cascade,
  x         numeric not null,
  z         numeric not null
);

create table public.nav_edges (
  id            bigint generated always as identity primary key,
  from_node_id  text not null references public.nav_nodes (id) on delete cascade,
  to_node_id    text not null references public.nav_nodes (id) on delete cascade,
  mode          text not null check (mode in ('walk', 'stairs', 'lift')),
  unique (from_node_id, to_node_id)
);

create table public.zones (
  id              text primary key,
  code            text    not null unique,
  name            text    not null,
  floor_id        text    not null references public.floors (id) on delete cascade,
  kind            text    not null check (kind in ('storage', 'receiving', 'assembly', 'tent', 'stairs', 'lift')),
  x               numeric not null,
  z               numeric not null,
  width           numeric not null,
  depth           numeric not null,
  access_node_id  text    not null references public.nav_nodes (id)
);

-- ช่องเก็บย่อยภายในโซน (เช่น Rack A ชั้น 2 ช่อง 05 = A-02-05)
create table public.locations (
  id        uuid primary key default gen_random_uuid(),
  zone_id   text not null references public.zones (id) on delete cascade,
  code      text not null unique,
  shelf     smallint,
  capacity  numeric
);

-- ===================== 2) สินค้า / สต็อก =====================
create table public.parts (
  id          uuid primary key default gen_random_uuid(),
  part_no     text not null unique,
  name        text not null,
  uom         text not null default 'pcs',
  min_qty     numeric,
  max_qty     numeric,
  created_at  timestamptz not null default now()
);

create table public.stock (
  part_id      uuid    not null references public.parts (id),
  location_id  uuid    not null references public.locations (id),
  qty          numeric not null default 0 check (qty >= 0),
  updated_at   timestamptz not null default now(),
  primary key (part_id, location_id)
);

-- ===================== 3) รับเข้า =====================
create table public.suppliers (
  id    uuid primary key default gen_random_uuid(),
  name  text not null unique
);

create table public.inbound_receipts (
  id           uuid primary key default gen_random_uuid(),
  receipt_no   text not null unique,
  supplier_id  uuid references public.suppliers (id),
  status       text not null default 'draft' check (status in ('draft', 'received', 'cancelled')),
  received_at  timestamptz,
  received_by  uuid references auth.users (id),
  note         text,
  created_at   timestamptz not null default now()
);

create table public.inbound_receipt_lines (
  id                   uuid primary key default gen_random_uuid(),
  receipt_id           uuid    not null references public.inbound_receipts (id) on delete cascade,
  part_id              uuid    not null references public.parts (id),
  qty                  numeric not null check (qty > 0),
  lot_no               text,
  putaway_location_id  uuid references public.locations (id)
);

-- สมุดบัญชีการเคลื่อนไหวสต็อก (ทุกการเปลี่ยนแปลงต้องมีบันทึก)
create table public.stock_movements (
  id                   bigint generated always as identity primary key,
  part_id              uuid    not null references public.parts (id),
  from_location_id     uuid references public.locations (id),
  to_location_id       uuid references public.locations (id),
  qty                  numeric not null check (qty > 0),
  kind                 text    not null check (kind in ('receive', 'issue', 'transfer', 'adjust')),
  ref_receipt_line_id  uuid references public.inbound_receipt_lines (id),
  created_by           uuid references auth.users (id) default auth.uid(),
  created_at           timestamptz not null default now()
);

-- ยืนยันใบรับเข้า: เพิ่มสต็อก + บันทึก movement ใน transaction เดียว
create or replace function public.post_receipt(p_receipt_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  l record;
begin
  update inbound_receipts
     set status = 'received', received_at = now(), received_by = auth.uid()
   where id = p_receipt_id and status = 'draft';
  if not found then
    raise exception 'Receipt % is not in draft status', p_receipt_id;
  end if;

  for l in select * from inbound_receipt_lines where receipt_id = p_receipt_id loop
    if l.putaway_location_id is null then
      raise exception 'Receipt line % has no put-away location', l.id;
    end if;
    insert into stock (part_id, location_id, qty)
    values (l.part_id, l.putaway_location_id, l.qty)
    on conflict (part_id, location_id)
      do update set qty = stock.qty + excluded.qty, updated_at = now();
    insert into stock_movements (part_id, to_location_id, qty, kind, ref_receipt_line_id)
    values (l.part_id, l.putaway_location_id, l.qty, 'receive', l.id);
  end loop;
end;
$$;

-- ===================== 4) วิเคราะห์ระยะเดิน =====================
-- ความต้องการ part ของแต่ละไลน์ประกอบ (ใช้คำนวณระยะเดินรวมต่อวัน)
create table public.part_demand (
  part_id           uuid    not null references public.parts (id),
  assembly_zone_id  text    not null references public.zones (id),
  trips_per_day     numeric not null default 0,
  qty_per_trip      numeric,
  primary key (part_id, assembly_zone_id)
);

-- บันทึกการเดินเบิก part จริง (เทียบกับค่าที่คำนวณได้)
create table public.pick_trips (
  id               bigint generated always as identity primary key,
  part_id          uuid references public.parts (id),
  from_zone_id     text not null references public.zones (id),
  to_zone_id       text not null references public.zones (id),
  walk_distance_m  numeric,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  picker_id        uuid references auth.users (id) default auth.uid()
);

-- ===================== Row Level Security =====================
-- สมมติฐานชั่วคราว: ผังโรงงานอ่านได้โดยไม่ต้องล็อกอิน (เพื่อให้หน้า 3D ใช้งานได้ระหว่างพัฒนา)
-- ข้อมูลสต็อก/รับเข้า ต้องล็อกอินเท่านั้น — ต้องทบทวนสิทธิ์ตามบทบาทใน docs/requirements.md
do $$
declare
  t text;
begin
  foreach t in array array['floors', 'nav_nodes', 'nav_edges', 'zones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s readable by everyone" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy "%s writable by staff" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;

  foreach t in array array['locations', 'parts', 'stock', 'suppliers', 'inbound_receipts',
                           'inbound_receipt_lines', 'stock_movements', 'part_demand', 'pick_trips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s staff access" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end;
$$;
