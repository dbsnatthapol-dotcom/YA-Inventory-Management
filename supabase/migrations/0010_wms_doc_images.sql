-- Step 0.4 (ต่อ): เก็บภาพ Packing List / Invoice ที่ถ่ายตอนรับของเป็นหลักฐาน (Supabase Storage, ไม่เปิดสาธารณะ)

insert into storage.buckets (id, name, public) values ('wms-docs', 'wms-docs', false) on conflict (id) do nothing;

create policy "wms-docs read by staff" on storage.objects
  for select to authenticated using (bucket_id = 'wms-docs' and public.is_staff());
create policy "wms-docs upload by receivers" on storage.objects
  for insert to authenticated with check (bucket_id = 'wms-docs' and public.has_perm('receive.create'));

-- ผูกภาพกับ GRN ที่เพิ่งสร้าง: ภาพ PL เก็บที่ใบ PL, ภาพ Invoice ต่อท้ายใบ Invoice (invoice เดิมถ่ายซ้ำได้ ไม่ทับของเก่า)
create or replace function public.attach_receiving_images(p_grn uuid, p_pl_paths text[], p_invoice_paths text[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.grns;
begin
  perform public.require_perm('receive.create');
  select * into v from public.grns where id = p_grn and env = public.wms_env();
  if v.id is null then raise exception 'ไม่พบ GRN'; end if;
  if coalesce(array_length(p_pl_paths, 1), 0) > 0 then
    update public.packing_lists set image_paths = image_paths || p_pl_paths where id = v.packing_list_id;
  end if;
  if v.invoice_id is not null and coalesce(array_length(p_invoice_paths, 1), 0) > 0 then
    update public.invoices set image_paths = image_paths || p_invoice_paths where id = v.invoice_id;
  end if;
end;
$$;

revoke all on function public.attach_receiving_images(uuid, text[], text[]) from public, anon;
grant execute on function public.attach_receiving_images(uuid, text[], text[]) to authenticated;
