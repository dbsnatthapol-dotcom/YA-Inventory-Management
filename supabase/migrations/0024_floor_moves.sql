-- 0024: ชุดหน้าคลัง จากการตรวจระบบ (docs/known-issues.md A2 B6 B7 B8) · แก้เฉพาะฟังก์ชัน ไม่เปลี่ยนตาราง ไม่ลบข้อมูล
--   A2 กล่องในพื้นที่กัก NG ย้ายไปช่องของดีไม่ได้ (หลุดเข้าไลน์) ยกเว้นผู้มีสิทธิ์ตรวจ MI3 (ตรวจซ้ำแล้วผ่าน) · ย้ายเข้าพื้นที่ NG ได้ปกติ
--      ส่งคืนผู้ขาย / ตัดทิ้ง ใช้ใบเบิก NG เหมือนเดิม
--   B7 สแกนจัดเก็บ / ย้าย: ช่องปลายทางต้องมีในระบบและเปิดใช้ (เหมือนย้ายจากรายการ)
--   B8 ย้ายออกจากจุดตรวจ MI3 (จัดเก็บหลังตรวจผ่าน) ใช้สิทธิ์ "จัดเก็บ" หรือ "ย้ายที่" ก็ได้ (MI3 มีสิทธิ์ย้ายที่)
--   B6 Invoice ที่มี part เดียวกันหลายบรรทัด: ยอด Invoice ของบรรทัดรับ (grn_lines) = ผลรวมทุกบรรทัดของ part

-- ช่องปลายทางย้ายได้ไหม (ใช้ร่วมกันทั้งสแกนและย้ายจากรายการ) · คืนแถวช่องปลายทาง
create or replace function public.move_target_check(p_box public.lpns, p_to text)
returns public.locations
language plpgsql stable security definer set search_path = public
as $$
declare
  v_loc public.locations;
begin
  select * into v_loc from public.locations where code = p_to;
  if v_loc.code is null or not v_loc.active or v_loc.blocked then
    raise exception 'ไม่พบช่อง % หรือช่องนี้ปิดใช้อยู่', p_to;
  end if;
  if v_loc.kind <> 'ng' and not public.has_perm('scan.qi')
     and exists (select 1 from public.locations where code = p_box.location_code and kind = 'ng') then
    raise exception 'กล่อง % อยู่พื้นที่กัก NG · ย้ายออกไปช่องของดีได้เฉพาะ MI3 (ตรวจซ้ำแล้วผ่าน) · ส่งคืน/ตัดทิ้งใช้ใบเบิก NG', p_box.lpn_no;
  end if;
  return v_loc;
end;
$$;

-- หน้าสแกน: เหมือน 0020 + ตรวจช่องปลายทาง (B7) + กล่อง NG (A2)
create or replace function public.scan_move(p_lpn uuid, p_to text, p_kind text default 'MOVE')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.lpns;
  v_to text := upper(trim(coalesce(p_to, '')));
begin
  if p_kind not in ('PUT', 'MOVE') then raise exception 'ประเภทไม่ถูกต้อง'; end if;
  perform public.require_perm(case when p_kind = 'PUT' then 'scan.put' else 'scan.move' end);
  select * into v from public.lpns where id = p_lpn and status = 'active' and env = public.wms_env() for update;
  if v.id is null then raise exception 'ไม่พบป้าย หรือป้ายนี้ใช้หมดแล้ว'; end if;
  if v_to = '' then raise exception 'เลือกช่องปลายทาง'; end if;
  if v_to = v.location_code then raise exception 'กล่องอยู่ที่ช่องนี้แล้ว'; end if;
  perform public.move_target_check(v, v_to);
  update public.lpns set location_code = v_to where id = p_lpn;
  insert into public.wms_tx (kind, lpn_id, from_loc, to_loc, created_code, via) values (p_kind, p_lpn, v.location_code, v_to, public.my_code(), 'scan');
end;
$$;

-- ย้ายจากรายการ: เหมือน 0020 + กล่อง NG (A2) + ออกจากจุดตรวจ MI3 ใช้สิทธิ์จัดเก็บหรือย้ายที่ (B8)
create or replace function public.move_lpns(p_ids uuid[], p_to text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_to text := upper(trim(coalesce(p_to, '')));
  v_loc public.locations;
  v public.lpns;
  v_from_kind text;
  v_kind text;
  v_total integer := (select count(distinct x) from unnest(p_ids) x);
  v_seen integer := 0;
  n integer := 0;
begin
  if v_total = 0 then raise exception 'เลือกกล่องที่จะย้าย'; end if;
  if v_total > 200 then raise exception 'ย้ายได้ครั้งละไม่เกิน 200 กล่อง'; end if;
  select * into v_loc from public.locations where code = v_to;
  if v_loc.code is null or not v_loc.active or v_loc.blocked then raise exception 'ไม่พบช่อง % หรือช่องนี้ปิดใช้อยู่', v_to; end if;
  for v in select * from public.lpns where id = any (p_ids) and env = public.wms_env() order by lpn_no for update loop
    v_seen := v_seen + 1;
    if v.status <> 'active' then raise exception 'ป้าย % ใช้งานไม่ได้แล้ว · โหลดรายการใหม่', v.lpn_no; end if;
    continue when v.location_code = v_to;
    select kind into v_from_kind from public.locations where code = v.location_code;
    v_kind := case when v_from_kind in ('staging', 'hold') then 'PUT' else 'MOVE' end;
    -- จัดเก็บหลังตรวจ MI3: คนจัดเก็บ หรือ MI3 (สิทธิ์ย้ายที่) ทำได้
    if not (v_from_kind = 'hold' and public.has_perm('scan.move')) then
      perform public.require_perm(case when v_kind = 'PUT' then 'scan.put' else 'scan.move' end);
    end if;
    perform public.move_target_check(v, v_to);
    update public.lpns set location_code = v_to where id = v.id;
    insert into public.wms_tx (kind, lpn_id, from_loc, to_loc, created_code, via) values (v_kind, v.id, v.location_code, v_to, public.my_code(), 'list');
    n := n + 1;
  end loop;
  if v_seen < v_total then raise exception 'ไม่พบบางกล่อง · โหลดรายการใหม่'; end if;
  return jsonb_build_object('moved', n, 'same', v_seen - n);
end;
$$;

-- รับของตรง / ออก GRN จากใบตรวจรับ: เหมือน 0022 + ยอด Invoice ของบรรทัดรับ = ผลรวมทุกบรรทัดของ part (B6 · เดิมเอาบรรทัดแรก)
create or replace function public.create_grn(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_env text := public.wms_env();
  v_inv jsonb := p -> 'invoice';
  v_pl jsonb := p -> 'packingList';
  v_model text := nullif(p ->> 'modelCode', '');
  v_customer text;
  v_requires boolean;
  v_qi_types text[];
  v_invoice_id uuid;
  v_pl_id uuid;
  v_grn_id uuid;
  v_grn_no text;
  v_line jsonb;
  v_no integer := 0;
  v_type text;
  v_needs boolean;
  v_zone text;
  v_home text;
  v_loc text;
  v_line_id uuid;
  v_lpn_id uuid;
  v_lpn_no text;
  v_inv_qty numeric;
  v_case text;
  v_case_lpn uuid;
  v_counted numeric;
  v_damaged numeric;
  v_good numeric;
  v_ng_loc text;
begin
  perform public.require_perm('receive.create');
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then raise exception 'ไม่มีรายการรับเข้า'; end if;
  if coalesce(v_pl ->> 'refDoc', '') = '' then raise exception 'ต้องมีเลขอ้างอิงของ Packing List'; end if;

  select customer_id, requires_inspection into v_customer, v_requires from public.product_models where code = v_model;
  v_customer := coalesce(v_customer, nullif(v_inv ->> 'customerId', ''));
  select array(select jsonb_array_elements_text(value)) into v_qi_types from public.app_settings where key = 'qi_part_types';
  -- พื้นที่กัก NG: ของเสียหายจากการตรวจรับแยกเป็นกล่องของตัวเองที่นี่ (ไม่มีพื้นที่ NG ⇒ อยู่กล่องเดียวกับของดีเหมือนเดิม)
  select code into v_ng_loc from public.locations where kind = 'ng' and active and not blocked order by code limit 1;

  -- Invoice: เลขเดิม = ผูกกับใบเดิม ไม่สร้างซ้ำ
  if coalesce(v_inv ->> 'invoiceNo', '') <> '' then
    select id into v_invoice_id from public.invoices where invoice_no = v_inv ->> 'invoiceNo' and env = v_env;
    if v_invoice_id is null then
      insert into public.invoices (invoice_no, customer_id, po_no, doc_date, movement_type, extraction)
      values (v_inv ->> 'invoiceNo', v_customer, nullif(v_inv ->> 'poNo', ''), nullif(v_inv ->> 'docDate', '')::date,
              nullif(v_inv ->> 'movementType', ''), v_inv -> 'extraction')
      returning id into v_invoice_id;
      insert into public.invoice_lines (invoice_id, line_no, part_no, description, qty)
      select v_invoice_id, (l ->> 'lineNo')::integer, l ->> 'partNo', l ->> 'description', (l ->> 'qty')::numeric
      -- บรรทัดซ้ำ / เลขบรรทัดชนกัน จัดให้เรียบร้อยก่อน (ไม่งั้นรับของล้มด้วย invoice_lines_pkey)
      from jsonb_array_elements(public.check_inv_lines(v_inv -> 'lines')) l;
    end if;
  end if;

  insert into public.packing_lists (ref_doc, so_no, packages, invoice_id, extraction)
  values (v_pl ->> 'refDoc', nullif(v_pl ->> 'soNo', ''), nullif(v_pl ->> 'packages', ''), v_invoice_id, v_pl -> 'extraction')
  returning id into v_pl_id;

  v_grn_no := public.next_doc_no('GRN');
  insert into public.grns (grn_no, packing_list_id, invoice_id, customer_id, model_code, receiver_code, note, replacement, check_id)
  values (v_grn_no, v_pl_id, v_invoice_id, v_customer, v_model, public.my_code(), nullif(p ->> 'note', ''),
          coalesce((p ->> 'replacement')::boolean, false), nullif(p ->> 'checkId', '')::uuid)
  returning id into v_grn_id;

  for v_line in select * from jsonb_array_elements(p -> 'lines') loop
    v_no := v_no + 1;
    v_counted := coalesce((v_line ->> 'countedQty')::numeric, 0);
    v_damaged := coalesce(nullif(v_line ->> 'damagedQty', '')::numeric, 0);
    if v_damaged < 0 or v_damaged <> trunc(v_damaged) or v_damaged > v_counted then
      raise exception 'จำนวนเสียหายของรายการที่ % ต้องเป็นจำนวนเต็ม 0 ถึง %', v_no, v_counted;
    end if;
    v_good := case when v_ng_loc is null then v_counted else v_counted - v_damaged end;
    select part_type into v_type from public.parts where part_no = v_line ->> 'partNo';
    v_needs := coalesce(coalesce(v_requires, true) and v_type = any (v_qi_types), false);
    v_zone := nullif(v_line ->> 'zoneId', '');
    v_case := nullif(upper(trim(coalesce(v_line ->> 'caseNo', ''))), '');
    if v_zone is not null and not exists (select 1 from public.zones where id = v_zone) then
      raise exception 'ไม่พบโซน % (รายการที่ %)', v_zone, v_no;
    end if;
    if v_zone is not null then
      -- โซนที่ผู้รับเลือก: ช่องแรกที่ว่าง ถ้าเต็ม/ไม่มีช่องย่อย ใช้รหัสโซน
      select coalesce(
        (select l.code from public.locations l
           where l.zone_id = v_zone and l.active and l.kind in ('bin', 'floor')
             and not exists (select 1 from public.lpns x where x.location_code = l.code and x.status = 'active' and x.env = v_env)
             and not exists (select 1 from public.grn_lines g where g.grn_id = v_grn_id and g.home_location = l.code)
           order by l.code limit 1),
        (select code from public.zones where id = v_zone))
      into v_home;
    else
      -- ช่องแนะนำ: ช่องแรกที่ว่างในโซนตามกฎ (ลูกค้า + กลุ่ม part) ถ้าไม่มีช่องย่อย ใช้รหัสโซน
      select coalesce(
        (select l.code from public.zone_rules r join public.locations l on l.zone_id = r.zone_id and l.active and l.kind in ('bin', 'floor')
           where r.customer_id = v_customer and (r.part_type = v_type or r.part_type is null)
             and not exists (select 1 from public.lpns x where x.location_code = l.code and x.status = 'active' and x.env = v_env)
             and not exists (select 1 from public.grn_lines g where g.grn_id = v_grn_id and g.home_location = l.code)
           order by (r.part_type is null), l.code limit 1),
        (select z.code from public.zone_rules r join public.zones z on z.id = r.zone_id
           where r.customer_id = v_customer and (r.part_type = v_type or r.part_type is null) order by (r.part_type is null) limit 1),
        'RCV-01')
      into v_home;
    end if;
    v_loc := case when v_needs then 'MI3-QC' else 'RCV-01' end;
    select sum(qty) into v_inv_qty from public.invoice_lines where invoice_id = v_invoice_id and part_no = v_line ->> 'partNo';

    insert into public.grn_lines (grn_id, line_no, part_no, description, part_type, pl_qty, counted_qty, invoice_qty, needs_qi, home_location, case_no, damaged_qty)
    values (v_grn_id, v_no, v_line ->> 'partNo', v_line ->> 'description', v_type,
            coalesce((v_line ->> 'plQty')::numeric, 0), (v_line ->> 'countedQty')::numeric, v_inv_qty, v_needs, v_home, v_case, v_damaged)
    returning id into v_line_id;

    if v_good > 0 then
      v_case_lpn := null;
      if v_case is not null and not v_needs then
        -- กล่องของเคสนี้ที่จุดรับของ (ไม่ใช่กล่อง NG ของเคสเดียวกัน)
        select id, lpn_no into v_case_lpn, v_lpn_no from public.lpns
        where grn_id = v_grn_id and case_no = v_case and not hold and status = 'active' and location_code = v_loc limit 1;
      end if;
      if v_case_lpn is null then
        v_lpn_no := public.next_doc_no('LPN');
        insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no) values (v_lpn_no, v_grn_id, v_loc, v_needs, v_case) returning id into v_lpn_id;
      else
        v_lpn_id := v_case_lpn;
      end if;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', v_good);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', v_good, v_loc, v_pl ->> 'refDoc', public.my_code());
    end if;
    -- ของเสียหาย: กล่อง NG แยก 1 กล่องต่อรายการ (เข้าคิว "NG รอส่งคืน" · ตัดยอดด้วยการเบิก NG ตอนส่งคืน)
    if v_ng_loc is not null and v_damaged > 0 then
      v_lpn_no := public.next_doc_no('LPN');
      insert into public.lpns (lpn_no, grn_id, location_code, hold, case_no) values (v_lpn_no, v_grn_id, v_ng_loc, false, v_case) returning id into v_lpn_id;
      insert into public.lpn_items (lpn_id, grn_line_id, part_no, qty) values (v_lpn_id, v_line_id, v_line ->> 'partNo', v_damaged);
      insert into public.wms_tx (kind, doc_no, lpn_id, part_no, qty, to_loc, ref, reason, created_code)
      values ('RECEIVE', v_grn_no, v_lpn_id, v_line ->> 'partNo', v_damaged, v_ng_loc, v_pl ->> 'refDoc', 'เสียหายจากการตรวจรับ → NG', public.my_code());
    end if;
  end loop;

  return jsonb_build_object('grnId', v_grn_id, 'grnNo', v_grn_no, 'invoiceId', v_invoice_id);
end;
$$;

revoke all on function public.move_target_check(public.lpns, text) from public, anon, authenticated;
