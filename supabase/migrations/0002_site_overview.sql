-- ภาพรวมพื้นที่โรงงาน: อาคารวางเอียงได้, ขอบที่ดิน, สิ่งประกอบฉาก และประเภทของที่เก็บในแต่ละโซน

-- ชั้นของอาคารหมุนรอบจุดเริ่มต้น (องศา, ตามเข็มนาฬิกาเมื่อมองจากด้านบน)
alter table public.floors add column rotation numeric not null default 0;

-- ประเภทของที่เก็บ เช่น {FG,Component}
alter table public.zones add column stores text[];

create table public.sites (
  id        text primary key,
  name      text  not null,
  boundary  jsonb not null  -- [[x, z], ...] หน่วยเมตร
);

create table public.site_landmarks (
  id        text primary key,
  site_id   text    not null references public.sites (id) on delete cascade,
  name      text    not null,
  kind      text    not null check (kind in ('office', 'building', 'road', 'area')),
  x         numeric not null,
  z         numeric not null,
  width     numeric not null,
  depth     numeric not null,
  rotation  numeric not null default 0,
  height    numeric not null default 0
);

do $$
declare
  t text;
begin
  foreach t in array array['sites', 'site_landmarks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "%s readable by everyone" on public.%I for select to anon, authenticated using (true)', t, t);
    execute format('create policy "%s writable by staff" on public.%I for all to authenticated using (true) with check (true)', t, t);
  end loop;
end;
$$;
