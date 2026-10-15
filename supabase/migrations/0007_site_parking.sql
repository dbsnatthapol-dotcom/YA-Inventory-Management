-- ลานรถส่งของ (parking) และที่จอดรถมีหลังคา (carport)
alter table public.site_landmarks drop constraint if exists site_landmarks_kind_check;
alter table public.site_landmarks add constraint site_landmarks_kind_check
  check (kind in ('office', 'building', 'road', 'area', 'canteen', 'gate', 'parking', 'carport'));
