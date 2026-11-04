-- MASTER V1.1: run after schema.sql (or on an existing V1 database).
-- A photo can be shown in both main sections without duplicating its file.
alter table public.photos add column if not exists galleries text[] not null default array['family']::text[];
alter table public.photos drop constraint if exists photos_galleries_valid;
alter table public.photos add constraint photos_galleries_valid check (
  array_length(galleries,1) between 1 and 2
  and galleries <@ array['child','family']::text[]
);
