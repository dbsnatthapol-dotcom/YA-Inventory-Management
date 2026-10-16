-- นำเข้ายอดตรวจนับจาก Excel (Part + ช่องเก็บ/โซน) → ผู้มีสิทธิ์อนุมัติ → ปรับยอดลงบัญชีคุมเป็นรายการ "ปรับยอด"
-- ส่งผล: บันทึกยอดในระบบ ณ ตอนส่ง (system_qty) · อนุมัติ: ปรับตามส่วนต่าง (นับได้ − ยอดในระบบตอนส่ง)
--   ขาด  ⇒ ลดจากกล่องที่เข้าก่อนในช่อง/โซนนั้น
--   เกิน ⇒ เพิ่มเข้ากล่องล่าสุดของ part นั้นในช่อง/โซน · ไม่มีกล่อง ⇒ สร้างกล่องใหม่ (ป้ายพิมพ์ได้ที่หน้าป้าย QR ตามเลข CNT)
-- ทุกการปรับเป็น wms_tx ADJ (approved) อ้างเลขเอกสาร CNT-YYMM-#### ตรวจย้อนหลังได้

create table if not exists public.stock_counts (
  id             uuid primary key default gen_random_uuid(),
  env            text not null default public.wms_env(),
  count_no       text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note           text,
  grn_id         uuid references public.grns (id),
  created_by     uuid references auth.users (id) default auth.uid(),
  created_code   text,
  created_at     timestamptz not null default now(),
  decided_by     uuid references auth.users (id),
  decided_code   text,
  decided_at     timestamptz,
  decision_note  text,
  unique (env, count_no)
);
comment on table public.stock_counts is 'ใบตรวจนับจากไฟล์ Excel · grn_id = เอกสารของกล่องใหม่ที่สร้างตอนอนุมัติ (ถ้ามี)';

create table if not exists public.stock_count_lines (
  count_id     uuid not null references public.stock_counts (id),
  line_no      integer not null,
  loc          text not null,
  zone_id      text,
  part_no      text not null,
  system_qty   numeric not null,
  counted_qty  numeric not null check (counted_qty >= 0),
  applied_qty  numeric,
  primary key (count_id, line_no)
);
comment on column public.stock_count_lines.loc is 'รหัสช่องเก็บ (F1-RK-B-01-1) หรือรหัสโซน (F1-RK-B) ตามที่กรอกในไฟล์';
comment on column public.stock_count_lines.system_qty is 'ยอดในระบบตอนส่งใบตรวจนับ';
comment on column public.stock_count_lines.applied_qty is 'ส่วนต่างที่ปรับจริงตอนอนุมัติ (+ เพิ่ม / − ลด)';

alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;
drop policy if exists "stock_counts read by staff" on public.stock_counts;
create policy "stock_counts read by staff" on public.stock_counts for select to authenticated using (public.is_staff() and env = public.wms_env());
drop policy if exists "stock_count_lines read by staff" on public.stock_count_lines;
create policy "stock_count_lines read by staff" on public.stock_count_lines for select to authenticated
  using (exists (select 1 from public.stock_counts c where c.id = count_id and public.is_staff() and c.env = public.wms_env()));

-- ช่องเก็บที่อยู่ใต้รหัสที่กรอก: ช่องเดียว หรือทุกช่องของโซน
create or replace function public.count_locations(p_loc text)
returns text[]
language sql stable security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.locations where code = upper(trim(p_loc))) then array[upper(trim(p_loc))]
    else (select array_remove(array_agg(l.code), null) || z.code from public.zones z left join public.locations l on l.zone_id = z.id
          where z.code = upper(trim(p_loc)) group by z.code)
  end
$$;

-- ยอดในระบบของ part ในช่อง/โซน (กล่องที่ใช้งาน รวมกล่องรอ MI3 เพราะของอยู่จริง)
create or replace function public.count_system_qty(p_locs text[], p_part text)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(i.qty), 0)
  from public.lpns l join public.lpn_items i on i.lpn_id = l.id
  where l.env = public.wms_env() and l.status = 'active' and l.location_code = any (p_locs) and i.part_no = p_part
$$;

-- ส่งใบตรวจนับ: p = { note, lines: [{ loc, partNo, counted }] }
create or replace function public.stock_count_submit(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_no text;
  l jsonb;
  v_n integer := 0;
  v_locs text[];
  v_part text;
  v_qty numeric;
  v_zone text;
begin
  perform public.require_perm('scan.count');
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการตรวจนับ'; end if;
  v_no := public.next_doc_no('CNT');
  insert into public.stock_counts (count_no, note, created_code) values (v_no, nullif(trim(coalesce(p ->> 'note', '')), ''), public.my_code())
  returning id into v_id;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_n := v_n + 1;
    v_locs := public.count_locations(l ->> 'loc');
    if v_locs is null then raise exception 'แถว %: ไม่พบช่องเก็บหรือโซน "%"', v_n, l ->> 'loc'; end if;
    v_part := public.part_canon(l ->> 'partNo');
    if not exists (select 1 from public.parts where part_no = v_part) then raise exception 'แถว %: ไม่พบ part "%" ใน Master', v_n, l ->> 'partNo'; end if;
    v_qty := (l ->> 'counted')::numeric;
    if v_qty is null or v_qty < 0 then raise exception 'แถว %: จำนวนนับต้องเป็น 0 ขึ้นไป', v_n; end if;
    if exists (select 1 from public.stock_count_lines where count_id = v_id and loc = upper(trim(l ->> 'loc')) and part_no = v_part) then
      raise exception 'แถว %: % ที่ % ซ้ำในไฟล์', v_n, v_part, l ->> 'loc';
    end if;
    select zone_id into v_zone from public.locations where code = v_locs[1];
    insert into public.stock_count_lines (count_id, line_no, loc, zone_id, part_no, system_qty, counted_qty)
    values (v_id, v_n, upper(trim(l ->> 'loc')), v_zone, v_part, public.count_system_qty(v_locs, v_part), v_qty);
  end loop;
  return jsonb_build_object('id', v_id, 'countNo', v_no);
end;
$$;

-- อนุมัติ / ไม่อนุมัติ (คนส่งอนุมัติเองไม่ได้ เหมือนคำขอแก้ไขยอด)
create or replace function public.stock_count_decide(p_id uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.stock_counts;
  r public.stock_count_lines;
  b record;
  v_env text := public.wms_env();
  v_locs text[];
  v_diff numeric;
  v_left numeric;
  v_take numeric;
  v_box uuid;
  v_item uuid;
  v_old numeric;
  v_reason text;
  v_pl uuid;
  v_grn uuid;
  v_line uuid;
  v_ln integer := 0;
  v_home text;
  v_lpn_no text;
  v_new_boxes integer := 0;
  v_changed integer := 0;
begin
  perform public.require_perm('scan.adjust.approve');
  select * into v from public.stock_counts where id = p_id and env = v_env for update;
  if v.id is null or v.status <> 'pending' then raise exception 'ใบตรวจนับนี้ถูกพิจารณาไปแล้ว'; end if;
  if v.created_by = auth.uid() then raise exception 'อนุมัติใบตรวจนับของตัวเองไม่ได้'; end if;
  if not p_approve then
    if coalesce(trim(p_note), '') = '' then raise exception 'ระบุเหตุผลที่ไม่อนุมัติ'; end if;
    update public.stock_counts set status = 'rejected', decided_by = auth.uid(), decided_code = public.my_code(), decided_at = now(), decision_note = trim(p_note)
    where id = p_id;
    return jsonb_build_object('changed', 0, 'newBoxes', 0);
  end if;

  v_reason := 'ตรวจนับ ' || v.count_no;
  for r in select * from public.stock_count_lines where count_id = p_id order by line_no loop
    v_diff := r.counted_qty - r.system_qty;
    v_locs := public.count_locations(r.loc);
    if v_diff < 0 then
      -- ขาด: ลดจากกล่องที่เข้าก่อน
      v_left := -v_diff;
      for b in
        select i.id item_id, i.qty, l.id lpn_id from public.lpns l join public.lpn_items i on i.lpn_id = l.id
        where l.env = v_env and l.status = 'active' and l.location_code = any (v_locs) and i.part_no = r.part_no and i.qty > 0
        order by l.created_at, l.lpn_no for update of i
      loop
        exit when v_left <= 0;
        v_take := least(v_left, b.qty);
        update public.lpn_items set qty = qty - v_take where id = b.item_id;
        update public.lpns x set status = 'empty' where x.id = b.lpn_id and not exists (select 1 from public.lpn_items where lpn_id = x.id and qty > 0);
        insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, new_qty, reason, status, created_code, decided_by, decided_code, decided_at)
        values ('ADJ', v.count_no, b.lpn_id, b.item_id, r.part_no, b.qty, b.qty - v_take, v_reason, 'approved', v.created_code, auth.uid(), public.my_code(), now());
        v_left := v_left - v_take;
      end loop;
      if v_left > 0 then
        raise exception '% ที่ % ยอดในระบบตอนนี้ไม่พอลด % (มีการเบิก/ย้ายหลังตรวจนับ) · ไม่อนุมัติแล้วนับใหม่', r.part_no, r.loc, -v_diff;
      end if;
      v_changed := v_changed + 1;
    elsif v_diff > 0 then
      -- เกิน: เพิ่มเข้ากล่องล่าสุด · ไม่มีกล่อง ⇒ กล่องใหม่
      select i.id, i.qty, l.id into v_item, v_old, v_box
      from public.lpns l join public.lpn_items i on i.lpn_id = l.id
      where l.env = v_env and l.status = 'active' and l.location_code = any (v_locs) and i.part_no = r.part_no
      order by l.created_at desc, l.lpn_no desc limit 1;
      if v_item is not null then
        update public.lpn_items set qty = qty + v_diff where id = v_item;
        insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, new_qty, reason, status, created_code, decided_by, decided_code, decided_at)
        values ('ADJ', v.count_no, v_box, v_item, r.part_no, v_old, v_old + v_diff, v_reason, 'approved', v.created_code, auth.uid(), public.my_code(), now());
      else
        if v_grn is null then
          insert into public.packing_lists (ref_doc) values (v.count_no) returning id into v_pl;
          insert into public.grns (grn_no, packing_list_id, receiver_code, note)
          values (v.count_no, v_pl, public.my_code(), 'กล่องใหม่จากการตรวจนับ (ยอดนับเกินระบบ)')
          returning id into v_grn;
        end if;
        v_ln := v_ln + 1;
        -- นับรายโซน: ช่องแรกที่ว่างในโซน (ไม่มีช่องว่าง ⇒ ช่องแรก)
        v_home := case when array_length(v_locs, 1) = 1 then v_locs[1]
                       else coalesce(
                         (select min(c) from unnest(v_locs) c
                           where c <> r.loc and not exists (select 1 from public.lpns x where x.location_code = c and x.status = 'active' and x.env = v_env)),
                         (select min(c) from unnest(v_locs) c where c <> r.loc)) end;
        insert into public.grn_lines (grn_id, line_no, part_no, description, part_type, pl_qty, counted_qty, home_location)
        select v_grn, v_ln, r.part_no, p.name, p.part_type, 0, v_diff, v_home from public.parts p where p.part_no = r.part_no
        returning id into v_line;
        v_lpn_no := public.next_doc_no('LPN');
        insert into public.lpns (lpn_no, grn_id, location_code) values (v_lpn_no, v_grn, coalesce(v_home, r.loc)) returning id into v_box;
        insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_box, v_line, r.part_no, v_diff) returning id into v_item;
        insert into public.wms_tx (kind, doc_no, lpn_id, lpn_item_id, part_no, qty, new_qty, to_loc, reason, status, created_code, decided_by, decided_code, decided_at)
        values ('ADJ', v.count_no, v_box, v_item, r.part_no, 0, v_diff, coalesce(v_home, r.loc), v_reason, 'approved', v.created_code, auth.uid(), public.my_code(), now());
        v_new_boxes := v_new_boxes + 1;
      end if;
      v_changed := v_changed + 1;
    end if;
    update public.stock_count_lines set applied_qty = v_diff where count_id = p_id and line_no = r.line_no;
  end loop;

  update public.stock_counts set status = 'approved', grn_id = v_grn, decided_by = auth.uid(), decided_code = public.my_code(), decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_id;
  return jsonb_build_object('changed', v_changed, 'newBoxes', v_new_boxes, 'grnId', v_grn);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['count_locations(text)', 'count_system_qty(text[], text)', 'stock_count_submit(jsonb)', 'stock_count_decide(uuid, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;
