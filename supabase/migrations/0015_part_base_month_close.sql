-- 1) รหัส part ยึดเลขฐาน: /A /B ท้ายรหัสเป็นแค่ revision · หน้างานมักไม่เขียนมา
--    RAT00586/B → RAT00586 (เก็บ B ไว้ที่ parts.revision) · แก้รหัสผิด RAT1088/A → RAT01088
--    ถ้าเลขฐานเดียวกันมีหลาย part (เช่น RAT00322/A กับ /D เป็นของคนละชนิด) ⇒ ไม่รวมให้ ปล่อยรหัสเต็มไว้ให้ตัดสินใจเอง
--    ข้อมูลที่บันทึกเข้ามาหลังจากนี้ แปลงเป็นรหัสหลักอัตโนมัติ ไม่ว่าจะพิมพ์ /A มาหรือไม่
-- 2) ปิดยอดบัญชีคุม FM-P-537 รายเดือนต่อ Model + Planning / บัญชี กดรับทราบในระบบ
--    เดือนที่ปิดแล้ว: บันทึก/ยกเลิก/กระทบยอดใบเบิกของ Model นั้นไม่ได้ จนกว่าจะเปิดเดือนใหม่

-- ===================== 1) รหัส part =====================
alter table public.parts add column if not exists revision text;
comment on column public.parts.revision is 'revision ล่าสุดที่เห็น (ตัวหลัง / ในรหัสลูกค้า) — ข้อมูลประกอบเท่านั้น ระบบอ้างอิงด้วย part_no ที่เป็นเลขฐาน';

-- ' rat00586/b' → 'RAT00586'
create or replace function public.part_base(p text)
returns text
language sql immutable
as $$
  select upper(split_part(trim(coalesce(p, '')), '/', 1))
$$;

-- รหัสที่ใช้ในระบบสำหรับรหัสที่พิมพ์/อ่านมา: ตรงตัว → เลขฐาน → part เดียวที่เลขฐานตรงกัน → เลขฐาน (part ใหม่)
create or replace function public.part_canon(p text)
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select part_no from public.parts where part_no = upper(trim(p))),
    (select part_no from public.parts where part_no = public.part_base(p)),
    (select min(part_no) from public.parts where public.part_base(part_no) = public.part_base(p) having count(*) = 1),
    public.part_base(p)
  )
$$;

-- แปลงรหัสเดิมในระบบ (master + ข้อมูลคลัง) · ข้อมูลระบบตรวจรับเดิม (receipt_lines, count_events, part_notes) ไม่แตะ
do $$
declare
  r record;
  v_new text;
begin
  for r in select id, part_no from public.parts where part_no like '%/%' order by part_no loop
    v_new := case when r.part_no = 'RAT1088/A' then 'RAT01088' else public.part_base(r.part_no) end;
    if (select count(*) from public.parts q where public.part_base(q.part_no) = public.part_base(r.part_no)) > 1 then
      raise notice 'ข้าม %: เลขฐานซ้ำกับ part อื่น', r.part_no;
      continue;
    end if;
    if exists (select 1 from public.parts q where q.part_no = v_new) then
      raise notice 'ข้าม %: มีรหัส % อยู่แล้ว', r.part_no, v_new;
      continue;
    end if;
    update public.parts set part_no = v_new, revision = coalesce(revision, nullif(split_part(r.part_no, '/', 2), '')) where id = r.id;
    update public.invoice_lines set part_no = v_new where part_no = r.part_no;
    update public.grn_lines set part_no = v_new where part_no = r.part_no;
    update public.lpn_items set part_no = v_new where part_no = r.part_no;
    update public.wms_tx set part_no = v_new where part_no = r.part_no;
    update public.fg_bom set part_no = v_new where part_no = r.part_no;
    update public.requisition_lines set part_no = v_new where part_no = r.part_no;
  end loop;
end;
$$;

-- รหัสที่รับเข้ามาแต่ไม่มีใน Master (เช่น H6906002/B) ⇒ เลขฐานเหมือนกัน (ยกเว้นเลขฐานที่ยังแยก revision ใน Master)
do $$
declare
  t text;
begin
  foreach t in array array['invoice_lines', 'grn_lines', 'lpn_items', 'wms_tx', 'fg_bom', 'requisition_lines'] loop
    execute format($f$
      update public.%I x set part_no = public.part_base(x.part_no)
      where x.part_no like '%%/%%'
        and not exists (select 1 from public.parts p where p.part_no = x.part_no)
        and not exists (select 1 from public.parts p where p.part_no like '%%/%%' and public.part_base(p.part_no) = public.part_base(x.part_no))
    $f$, t);
  end loop;
end;
$$;

-- บันทึก part (เหมือน 0014) + รหัสหลักตาม part_canon · revision ที่พิมพ์มาเก็บไว้ที่ parts.revision
create or replace function public.master_save_part(p jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_raw text := upper(trim(coalesce(p ->> 'partNo', '')));
  v_no text;
  v_rev text;
  v_uam text := nullif(trim(coalesce(p ->> 'uamCode', '')), '');
begin
  perform public.require_perm('master.edit');
  if v_raw = '' or coalesce(trim(p ->> 'name'), '') = '' then raise exception 'ต้องมี Part No. และชื่อ'; end if;
  v_no := public.part_canon(v_raw);
  v_rev := case when v_no not like '%/%' then nullif(split_part(v_raw, '/', 2), '') end;
  if v_uam is not null and exists (select 1 from public.parts where uam_code = v_uam and part_no <> v_no) then
    raise exception 'รหัส UAM % ใช้กับ part อื่นแล้ว', v_uam;
  end if;
  insert into public.parts (part_no, name, part_type, customer_id, uam_code, revision)
  values (v_no, trim(p ->> 'name'), nullif(upper(trim(coalesce(p ->> 'type', ''))), ''), nullif(p ->> 'customerId', ''), v_uam, v_rev)
  on conflict (part_no) do update set name = excluded.name, part_type = excluded.part_type, customer_id = excluded.customer_id,
    uam_code = excluded.uam_code, revision = coalesce(excluded.revision, parts.revision)
  returning id into v_id;
  insert into public.part_models (part_id, model_code)
  select v_id, m from jsonb_array_elements_text(coalesce(p -> 'models', '[]')) m
  on conflict do nothing;
end;
$$;

-- ข้อมูลคลังใหม่: ใช้รหัสหลักเสมอ (ใบ Invoice / PL ที่ AI อ่านมามี /A ก็ตาม)
create or replace function public.trg_part_canon()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.part_no is not null then
    new.part_no := public.part_canon(new.part_no);
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['invoice_lines', 'grn_lines', 'lpn_items', 'wms_tx', 'fg_bom', 'requisition_lines'] loop
    execute format('drop trigger if exists part_canon on public.%I', t);
    execute format('create trigger part_canon before insert on public.%I for each row execute function public.trg_part_canon()', t);
  end loop;
end;
$$;

-- ===================== 2) ปิดยอดสิ้นเดือน =====================
insert into public.role_permissions (role, perm) values
  ('manager', 'ledger.close'), ('planner', 'ledger.ack.planning'), ('manager', 'ledger.ack.account')
on conflict (role, perm) do nothing;

create table if not exists public.stock_closings (
  id            uuid primary key default gen_random_uuid(),
  env           text not null default public.wms_env(),
  model_code    text not null references public.product_models (code),
  month         text not null check (month ~ '^\d{4}-\d{2}$'),
  status        text not null default 'closed' check (status in ('closed', 'reopened')),
  totals        jsonb not null default '[]',
  closed_by     text,
  closed_at     timestamptz,
  planning_by   text,
  planning_at   timestamptz,
  account_by    text,
  account_at    timestamptz,
  note          text,
  unique (env, model_code, month)
);
comment on table public.stock_closings is 'ปิดยอดบัญชีคุม FM-P-537 รายเดือนต่อ Model · totals = [{partNo, opening, in, out, closing}] ณ ตอนปิด';
comment on column public.stock_closings.totals is 'ยอดต่อ part ตอนปิด ใช้เทียบกับบัญชีปัจจุบัน (ถ้าต่างกัน = มีรายการย้อนหลังหลังปิด)';
alter table public.stock_closings enable row level security;
drop policy if exists "stock_closings read by staff" on public.stock_closings;
create policy "stock_closings read by staff" on public.stock_closings for select to authenticated using (public.is_staff() and env = public.wms_env());

-- ชื่อ (รหัส) ผู้ทำรายการ
create or replace function public.my_label()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce((select full_name || ' (' || employee_code || ')' from public.staff_profiles where id = auth.uid()), public.my_code())
$$;

create or replace function public.month_closed(p_model text, p_day date)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.stock_closings
    where env = public.wms_env() and model_code = p_model and month = to_char(p_day, 'YYYY-MM') and status = 'closed')
$$;

-- ใบเบิกของเดือนที่ปิดแล้ว: เพิ่ม/ยกเลิก/กระทบยอดไม่ได้
create or replace function public.trg_requisition_month_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.model_code is not null and public.month_closed(new.model_code, new.doc_date) then
    raise exception 'บัญชีคุม % เดือน % ปิดยอดแล้ว · ให้ผู้มีสิทธิ์เปิดเดือนก่อน', new.model_code, to_char(new.doc_date, 'YYYY-MM');
  end if;
  return new;
end;
$$;
drop trigger if exists requisition_month_lock on public.requisitions;
create trigger requisition_month_lock before insert or update on public.requisitions for each row execute function public.trg_requisition_month_lock();

-- ยอดต่อ part ของ Model ในเดือน (เวลาไทย) · ตรงกับ buildLedger ฝั่งเว็บ
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
    select x.* from rng, public.stock_ledger_rows((select coalesce(array_agg(part_no), '{}') from mp), rng.t1) x
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

-- ปิดยอด (เดือนต้องจบแล้ว) · ปิดซ้ำหลังเปิดเดือน = คำนวณใหม่ + ล้างการรับทราบ
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
  insert into public.stock_closings (model_code, month, status, totals, closed_by, closed_at, note)
  values (p_model, p_month, 'closed', public.ledger_month_totals(p_model, p_month), public.my_label(), now(), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (env, model_code, month) do update set
    status = 'closed', totals = excluded.totals, closed_by = excluded.closed_by, closed_at = excluded.closed_at, note = excluded.note,
    planning_by = null, planning_at = null, account_by = null, account_at = null
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end;
$$;

-- เปิดเดือนเพื่อแก้ไข (ต้องระบุเหตุผล)
create or replace function public.stock_reopen(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_perm('ledger.close');
  if coalesce(trim(p_reason), '') = '' then raise exception 'ระบุเหตุผลที่เปิดเดือน'; end if;
  update public.stock_closings
  set status = 'reopened', note = concat_ws(' · ', note, 'เปิดเดือน: ' || trim(p_reason) || ' โดย ' || public.my_label())
  where id = p_id and env = public.wms_env() and status = 'closed';
  if not found then raise exception 'ไม่พบรายการปิดยอด'; end if;
end;
$$;

-- รับทราบยอด: side = planning | account
create or replace function public.stock_close_ack(p_id uuid, p_side text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_side = 'planning' then
    perform public.require_perm('ledger.ack.planning');
    update public.stock_closings set planning_by = public.my_label(), planning_at = now()
    where id = p_id and env = public.wms_env() and status = 'closed' and planning_at is null;
  elsif p_side = 'account' then
    perform public.require_perm('ledger.ack.account');
    update public.stock_closings set account_by = public.my_label(), account_at = now()
    where id = p_id and env = public.wms_env() and status = 'closed' and account_at is null;
  else
    raise exception 'side ต้องเป็น planning หรือ account';
  end if;
  if not found then raise exception 'ไม่พบรายการ หรือรับทราบไปแล้ว'; end if;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['part_canon(text)', 'my_label()', 'month_closed(text, date)', 'ledger_month_totals(text, text)',
    'stock_close(text, text, text)', 'stock_reopen(uuid, text)', 'stock_close_ack(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['trg_part_canon()', 'trg_requisition_month_lock()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end;
$$;
