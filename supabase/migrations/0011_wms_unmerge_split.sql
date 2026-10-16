-- ยกเลิกการรวมกล่อง / แยกกล่อง
-- * ยกเลิกการรวม: คืนป้ายเดิม (เลข LPN เดิม ป้ายที่แปะไว้ใช้ต่อได้) ทำได้เฉพาะเมื่อกล่องรวมยังไม่มีการเคลื่อนไหวหลังรวม
-- * แยกกล่อง: เลือก part/จำนวนออกไปกล่องใหม่ พร้อมเลข LPN ใหม่ ทำได้ทุกเมื่อ
-- ทั้งสองใช้สิทธิ์ label.print (สิทธิ์เดียวกับการรวมกล่อง)

alter table public.lpns drop constraint lpns_status_check;
alter table public.lpns add constraint lpns_status_check check (status in ('active', 'empty', 'merged', 'void'));

alter table public.wms_tx drop constraint wms_tx_kind_check;
alter table public.wms_tx add constraint wms_tx_kind_check
  check (kind in ('RECEIVE', 'PUT', 'MOVE', 'ISSUE', 'ADJ', 'COUNT', 'QI', 'MERGE', 'UNMERGE', 'SPLIT'));

-- รายการนี้มาจากป้ายไหนก่อนถูกรวม (ใช้ตอนยกเลิกการรวม)
alter table public.lpn_items add column if not exists prev_lpn_id uuid references public.lpns (id);

-- กล่องที่รวมไว้ก่อนมีคอลัมน์นี้: จับคู่รายการกับป้ายเดิมจากบันทึกรับเข้า (part + จำนวนเดียวกัน)
with orig as (
  select l.id as lpn_id, l.merged_into, t.part_no, t.qty,
         row_number() over (partition by l.merged_into, t.part_no, t.qty order by l.lpn_no) as rn
  from public.lpns l
  join public.wms_tx t on t.lpn_id = l.id and t.kind = 'RECEIVE'
  where l.status = 'merged'
), it as (
  select i.id, i.lpn_id, i.part_no, i.qty,
         row_number() over (partition by i.lpn_id, i.part_no, i.qty order by i.id) as rn
  from public.lpn_items i
  where i.prev_lpn_id is null and exists (select 1 from public.lpns o where o.merged_into = i.lpn_id)
)
update public.lpn_items li
set prev_lpn_id = orig.lpn_id
from it
join orig on orig.merged_into = it.lpn_id and orig.part_no = it.part_no and orig.qty = it.qty and orig.rn = it.rn
where li.id = it.id;

create or replace function public.merge_lpns(p_lpn_ids uuid[], p_location text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  v_new uuid;
  v_no text;
  v_first public.lpns;
begin
  perform public.require_perm('label.print');
  if coalesce(array_length(p_lpn_ids, 1), 0) < 2 then raise exception 'เลือกอย่างน้อย 2 ป้ายเพื่อรวม'; end if;
  select * into v_first from public.lpns where id = p_lpn_ids[1] and status = 'active' and env = v_env;
  if v_first.id is null then raise exception 'ไม่พบป้ายที่เลือก'; end if;
  if (select count(*) from public.lpns where id = any (p_lpn_ids) and status = 'active' and env = v_env) <> array_length(p_lpn_ids, 1) then
    raise exception 'มีป้ายที่ถูกรวมหรือใช้หมดไปแล้ว';
  end if;
  v_no := public.next_doc_no('LPN');
  insert into public.lpns (lpn_no, grn_id, location_code, hold)
  values (v_no, v_first.grn_id, coalesce(p_location, v_first.location_code), (select bool_or(hold) from public.lpns where id = any (p_lpn_ids)))
  returning id into v_new;
  update public.lpn_items set prev_lpn_id = lpn_id, lpn_id = v_new where lpn_id = any (p_lpn_ids);
  update public.lpns set status = 'merged', merged_into = v_new where id = any (p_lpn_ids);
  insert into public.wms_tx (kind, doc_no, lpn_id, to_loc, ref, created_code)
  values ('MERGE', v_no, v_new, coalesce(p_location, v_first.location_code),
          (select string_agg(lpn_no, ', ' order by lpn_no) from public.lpns where id = any (p_lpn_ids)), public.my_code());
  return jsonb_build_object('lpnId', v_new, 'lpnNo', v_no);
end;
$$;

create or replace function public.unmerge_lpn(p_lpn uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v public.lpns;
  v_list text;
begin
  perform public.require_perm('label.print');
  select * into v from public.lpns where id = p_lpn and env = public.wms_env() for update;
  if v.id is null then raise exception 'ไม่พบป้าย'; end if;
  if v.status <> 'active' then raise exception 'ป้ายนี้ใช้งานไม่ได้แล้ว (อาจถูกรวมต่อ ใช้หมด หรือยกเลิกไปแล้ว)'; end if;
  if not exists (select 1 from public.lpns where merged_into = p_lpn and status = 'merged') then
    raise exception 'กล่องนี้ไม่ได้เกิดจากการรวม · ถ้าจะแบ่งของใช้ "แยกกล่อง"';
  end if;
  if exists (
    select 1 from public.wms_tx
    where kind <> 'MERGE'
      and (lpn_id = p_lpn or lpn_item_id in (select id from public.lpn_items where lpn_id = p_lpn))
  ) then
    raise exception 'กล่องนี้มีการเคลื่อนไหวหลังรวมแล้ว (ย้าย/เบิก/แก้ยอด/ตรวจ/แยก) ยกเลิกการรวมไม่ได้ · ใช้ "แยกกล่อง" แทน';
  end if;
  if exists (
    select 1 from public.lpn_items i
    where i.lpn_id = p_lpn
      and not exists (select 1 from public.lpns o where o.id = i.prev_lpn_id and o.merged_into = p_lpn)
  ) then
    raise exception 'ไม่พบข้อมูลป้ายเดิมของบางรายการ · ใช้ "แยกกล่อง" แทน';
  end if;

  update public.lpn_items set lpn_id = prev_lpn_id, prev_lpn_id = null where lpn_id = p_lpn;
  select string_agg(lpn_no, ', ' order by lpn_no) into v_list from public.lpns where merged_into = p_lpn;
  update public.lpns set status = 'active', merged_into = null where merged_into = p_lpn;
  update public.lpns set status = 'void' where id = p_lpn;
  insert into public.wms_tx (kind, doc_no, lpn_id, from_loc, ref, created_code)
  values ('UNMERGE', v.lpn_no, p_lpn, v.location_code, v_list, public.my_code());
  return jsonb_build_object('lpnNos', v_list);
end;
$$;

-- p_items = [{"itemId": uuid, "qty": number}, ...]  (qty = จำนวนที่ย้ายออกไปกล่องใหม่)
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
  insert into public.lpns (lpn_no, grn_id, location_code, hold)
  values (v_no, v.grn_id, v.location_code, v.hold)
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

revoke all on function public.unmerge_lpn(uuid) from public, anon;
revoke all on function public.split_lpn(uuid, jsonb) from public, anon;
grant execute on function public.unmerge_lpn(uuid) to authenticated;
grant execute on function public.split_lpn(uuid, jsonb) to authenticated;
