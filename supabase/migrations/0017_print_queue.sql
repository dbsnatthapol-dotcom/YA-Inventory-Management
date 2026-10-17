-- คิวพิมพ์ป้าย: หน้างานกด "ส่งไปพิมพ์ที่คอม" จากมือถือ → คอมที่ต่อเครื่องพิมพ์ฉลาก/A4 เห็นคิวแล้วกดพิมพ์
-- งานในคิวอ้าง GRN + กล่อง (LPN) ที่เลือก · พิมพ์แล้ว/ยกเลิก เก็บประวัติว่าใครส่ง ใครพิมพ์

create table if not exists public.print_jobs (
  id              uuid primary key default gen_random_uuid(),
  env             text not null default public.wms_env(),
  format          text not null check (format in ('label', 'sheet', 'a4')),
  grn_id          uuid not null references public.grns (id),
  lpn_ids         uuid[] not null default '{}',
  copies          integer not null default 1 check (copies between 1 and 10),
  title           text,
  status          text not null default 'queued' check (status in ('queued', 'printed', 'cancelled')),
  requested_by    uuid references auth.users (id) default auth.uid(),
  requested_code  text,
  requested_at    timestamptz not null default now(),
  done_by         uuid references auth.users (id),
  done_code       text,
  done_at         timestamptz
);
comment on table public.print_jobs is 'คิวพิมพ์ป้าย/ใบ GRN ที่ส่งจากมือถือให้คอมจุดพิมพ์ · format: label = ฉลาก 100×150, sheet = A4 4 ป้าย, a4 = ใบ GRN';
create index if not exists print_jobs_queue_idx on public.print_jobs (env, status, requested_at);

alter table public.print_jobs enable row level security;
drop policy if exists "print_jobs read by staff" on public.print_jobs;
create policy "print_jobs read by staff" on public.print_jobs for select to authenticated using (public.is_staff() and env = public.wms_env());

-- ส่งเข้าคิว: p = { format, grnId, lpnIds: [uuid], copies, title }
create or replace function public.print_job_create(p jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_grn uuid := (p ->> 'grnId')::uuid;
  v_lpns uuid[] := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p -> 'lpnIds', '[]')) x);
  v_format text := coalesce(p ->> 'format', 'label');
begin
  perform public.require_perm('label.print');
  if not exists (select 1 from public.grns where id = v_grn and env = public.wms_env()) then raise exception 'ไม่พบใบรับสินค้า'; end if;
  if v_format <> 'a4' and coalesce(array_length(v_lpns, 1), 0) = 0 then raise exception 'ยังไม่ได้เลือกป้าย'; end if;
  if exists (select 1 from unnest(v_lpns) x where not exists (select 1 from public.lpns l where l.id = x and l.grn_id = v_grn and l.env = public.wms_env())) then
    raise exception 'ป้ายที่เลือกไม่อยู่ในใบรับสินค้านี้';
  end if;
  insert into public.print_jobs (format, grn_id, lpn_ids, copies, title, requested_code)
  values (v_format, v_grn, v_lpns, greatest(1, least(10, coalesce((p ->> 'copies')::integer, 1))), nullif(trim(coalesce(p ->> 'title', '')), ''), public.my_code())
  returning id into v_id;
  return v_id;
end;
$$;

-- ปิดงานในคิว: printed (พิมพ์แล้ว) หรือ cancelled (ยกเลิก)
create or replace function public.print_job_finish(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('label.print');
  if p_status not in ('printed', 'cancelled') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update public.print_jobs set status = p_status, done_by = auth.uid(), done_code = public.my_code(), done_at = now()
  where id = p_id and env = public.wms_env() and status = 'queued';
  if not found then raise exception 'งานพิมพ์นี้ถูกพิมพ์หรือยกเลิกไปแล้ว'; end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['print_job_create(jsonb)', 'print_job_finish(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
