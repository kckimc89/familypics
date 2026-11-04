-- 우리 가족 사진관 MASTER V1 / 새 Supabase 프로젝트의 SQL Editor에서 1회 실행
-- 기존 데이터베이스에 같은 테이블이 있다면 먼저 백업하세요.
create extension if not exists pgcrypto;
create table if not exists public.families (
 id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 100), created_at timestamptz not null default now()
);
create table if not exists public.memberships (
 family_id uuid not null references public.families(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','member')) default 'member',
 joined_at timestamptz not null default now(), primary key(family_id,user_id)
);
create table if not exists public.albums (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 100), kind text not null default 'topic' check(kind in ('topic','person')),
 created_at timestamptz not null default now(), unique(id,family_id)
);
create table if not exists public.photos (
 id uuid primary key default gen_random_uuid(), family_id uuid not null references public.families(id) on delete cascade,
 owner_id uuid not null references auth.users(id), title text not null default '', caption text not null default '',
 people text[] not null default '{}', taken_on date, original_path text not null, display_path text not null, thumb_path text not null,
 mime_type text, original_name text, favorite_users uuid[] not null default '{}',
 deleted_at timestamptz, created_at timestamptz not null default now(), unique(id,family_id)
);
create table if not exists public.photo_albums (
 photo_id uuid not null, album_id uuid not null, family_id uuid not null,
 primary key(photo_id,album_id),
 foreign key(photo_id,family_id) references public.photos(id,family_id) on delete cascade,
 foreign key(album_id,family_id) references public.albums(id,family_id) on delete cascade
);
create table if not exists public.invites (
 code text primary key, family_id uuid not null references public.families(id) on delete cascade,
 created_by uuid not null references auth.users(id), expires_at timestamptz not null,
 used_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists idx_photos_family_date on public.photos(family_id,taken_on desc,created_at desc);
create index if not exists idx_albums_family on public.albums(family_id);

create or replace function public.is_family_member(fid uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.memberships m where m.family_id = fid and m.user_id = (select auth.uid()));
$$;
create or replace function public.is_family_admin(fid uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.memberships m where m.family_id=fid and m.user_id=(select auth.uid()) and m.role='admin');
$$;
revoke all on function public.is_family_member(uuid), public.is_family_admin(uuid) from public;
grant execute on function public.is_family_member(uuid), public.is_family_admin(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.memberships enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;
alter table public.photo_albums enable row level security;
alter table public.invites enable row level security;

create policy "families view" on public.families for select to authenticated using(public.is_family_member(id));
create policy "members view" on public.memberships for select to authenticated using(public.is_family_member(family_id));
create policy "albums view" on public.albums for select to authenticated using(public.is_family_member(family_id));
create policy "albums admin insert" on public.albums for insert to authenticated with check(public.is_family_admin(family_id));
create policy "albums admin update" on public.albums for update to authenticated using(public.is_family_admin(family_id)) with check(public.is_family_admin(family_id));
create policy "albums admin delete" on public.albums for delete to authenticated using(public.is_family_admin(family_id));
create policy "photos view" on public.photos for select to authenticated using(public.is_family_member(family_id));
create policy "photos member insert" on public.photos for insert to authenticated with check(public.is_family_member(family_id) and owner_id=(select auth.uid()) and deleted_at is null and original_path like family_id::text || '/originals/%' and display_path like family_id::text || '/display/%' and thumb_path like family_id::text || '/thumbs/%');
create policy "photos owner edit" on public.photos for update to authenticated using(public.is_family_member(family_id) and (owner_id=(select auth.uid()) or public.is_family_admin(family_id))) with check(public.is_family_member(family_id) and (owner_id=(select auth.uid()) or public.is_family_admin(family_id)));
create policy "photos admin delete" on public.photos for delete to authenticated using(public.is_family_admin(family_id));
create policy "links view" on public.photo_albums for select to authenticated using(public.is_family_member(family_id));
create policy "links insert" on public.photo_albums for insert to authenticated with check(public.is_family_member(family_id) and exists(select 1 from public.photos p where p.id=photo_id and (p.owner_id=(select auth.uid()) or public.is_family_admin(family_id))));
create policy "links delete" on public.photo_albums for delete to authenticated using(public.is_family_member(family_id) and exists(select 1 from public.photos p where p.id=photo_id and (p.owner_id=(select auth.uid()) or public.is_family_admin(family_id))));

-- Security definer RPC: authenticated user can create own family / join by one-use invite.
create or replace function public.create_family(family_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare fid uuid;
begin
 if (select auth.uid()) is null then raise exception 'Login required'; end if;
 if length(trim(coalesce(family_name,''))) not between 1 and 100 then raise exception 'Invalid family name'; end if;
 insert into public.families(name) values(trim(family_name)) returning id into fid;
 insert into public.memberships(family_id,user_id,role) values(fid,(select auth.uid()),'admin');
 return fid;
end;$$;
create or replace function public.create_invite(fid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare c text;
begin
 if not public.is_family_admin(fid) then raise exception 'Admin only'; end if;
 c := upper(encode(public.gen_random_bytes(12),'hex'));
 insert into public.invites(code,family_id,created_by,expires_at) values(c,fid,(select auth.uid()),now()+interval '7 days');
 return c;
end;$$;
create or replace function public.join_family(invite_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare fid uuid; normalized text;
begin
 if (select auth.uid()) is null then raise exception 'Login required'; end if;
 normalized := upper(trim(coalesce(invite_code,'')));
 update public.invites set used_by=(select auth.uid()) where code=normalized and used_by is null and expires_at>now() returning family_id into fid;
 if fid is null then raise exception 'Invalid, used or expired invite'; end if;
 insert into public.memberships(family_id,user_id,role) values(fid,(select auth.uid()),'member') on conflict do nothing;
 return fid;
end;$$;
create or replace function public.set_family_role(fid uuid, target_user uuid, new_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_family_admin(fid) then raise exception 'Admin only'; end if;
 if new_role not in ('admin','member') then raise exception 'Invalid role'; end if;
 if target_user=(select auth.uid()) and new_role='member' and (select count(*) from public.memberships where family_id=fid and role='admin')<=1 then raise exception 'Last admin cannot be demoted'; end if;
 update public.memberships set role=new_role where family_id=fid and user_id=target_user;
end;$$;
revoke all on function public.create_family(text),public.create_invite(uuid),public.join_family(text),public.set_family_role(uuid,uuid,text) from public;
grant execute on function public.create_family(text),public.create_invite(uuid),public.join_family(text),public.set_family_role(uuid,uuid,text) to authenticated;

-- Restrict storage object access by private family folder. Never use a public bucket.
insert into storage.buckets(id,name,public,file_size_limit) values('family-photos','family-photos',false,52428800) on conflict(id) do update set public=false;
create policy "family storage read" on storage.objects for select to authenticated using(bucket_id='family-photos' and public.is_family_member((split_part(name,'/',1))::uuid));
create policy "family storage upload" on storage.objects for insert to authenticated with check(bucket_id='family-photos' and public.is_family_member((split_part(name,'/',1))::uuid) and (split_part(name,'/',2) in ('originals','display','thumbs')));
create policy "family storage delete admin" on storage.objects for delete to authenticated using(bucket_id='family-photos' and public.is_family_admin((split_part(name,'/',1))::uuid));

-- 즐겨찾기는 개인별로 별도 저장(다른 가족의 사진에도 표시 가능).
create table if not exists public.favorites (
 family_id uuid not null, photo_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
 primary key(photo_id,user_id), foreign key(photo_id,family_id) references public.photos(id,family_id) on delete cascade
);
alter table public.favorites enable row level security;
create policy "favorites view" on public.favorites for select to authenticated using(user_id=(select auth.uid()) and public.is_family_member(family_id));
create policy "favorites insert" on public.favorites for insert to authenticated with check(user_id=(select auth.uid()) and public.is_family_member(family_id));
create policy "favorites remove" on public.favorites for delete to authenticated using(user_id=(select auth.uid()) and public.is_family_member(family_id));

-- 업로드된 파일 경로/소유자/가족 식별값은 수정할 수 없고, 휴지통은 관리자만.
create or replace function public.protect_photo_fields() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
 if new.id is distinct from old.id or new.family_id is distinct from old.family_id or new.owner_id is distinct from old.owner_id or
 new.original_path is distinct from old.original_path or new.display_path is distinct from old.display_path or new.thumb_path is distinct from old.thumb_path then
 raise exception 'Photo identity and storage paths cannot change'; end if;
 if new.deleted_at is distinct from old.deleted_at and not public.is_family_admin(old.family_id) then raise exception 'Only admin can change trash'; end if;
 return new;
end;$$;
create trigger protect_photo_fields_before_update before update on public.photos for each row execute function public.protect_photo_fields();
-- 가입 후 다른 가족의 멤버십을 읽는 통로는 열지 않습니다.
