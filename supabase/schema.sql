-- Initial schema. Run in Supabase SQL editor.
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 nickname text not null default 'Hráč',
 handicap_index numeric(4,1) not null default 54 check(handicap_index between -10 and 54),
 language text not null default 'cs' check(language in ('cs','en','de')),
 allow_messages boolean not null default true,
 is_suspended boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.admin_memberships (
 user_id uuid primary key references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table if not exists public.courses (
 id uuid primary key default gen_random_uuid(), name text not null, country text not null default 'CZ', source text, verified_at timestamptz
);
create table if not exists public.course_tees (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.courses(id) on delete cascade,
 name text not null, gender text, course_rating numeric(4,1), slope_rating integer check(slope_rating between 55 and 155)
);
create table if not exists public.holes (
 tee_id uuid not null references public.course_tees(id) on delete cascade,
 hole_number integer not null check(hole_number between 1 and 18),
 par integer not null check(par between 3 and 6), stroke_index integer not null check(stroke_index between 1 and 18),
 length_m integer, primary key(tee_id,hole_number)
);
create table if not exists public.games (
 id uuid primary key default gen_random_uuid(), organizer_id uuid not null references auth.users(id),
 name text not null, course_id uuid references public.courses(id), tee_id uuid references public.course_tees(id),
 play_date date not null, holes_count integer not null default 18 check(holes_count in (9,18)),
 scoring text not null default 'stableford' check(scoring in ('stableford','stroke')),
 status text not null default 'planned' check(status in ('planned','active','finished')),
 created_at timestamptz not null default now()
);
create table if not exists public.game_players (
 game_id uuid not null references public.games(id) on delete cascade,
 player_id uuid not null references auth.users(id), flight_number integer not null default 1,
 handicap_snapshot numeric(4,1), finished_at timestamptz,
 primary key(game_id,player_id)
);
create table if not exists public.scores (
 game_id uuid not null, player_id uuid not null, hole_number integer not null check(hole_number between 1 and 18),
 strokes integer check(strokes between 1 and 30), picked_up boolean not null default false,
 updated_at timestamptz not null default now(),
 primary key(game_id,player_id,hole_number),
 foreign key(game_id,player_id) references public.game_players(game_id,player_id) on delete cascade,
 check(not (picked_up and strokes is not null))
);
create table if not exists public.handicap_history (
 id bigint generated always as identity primary key, player_id uuid not null references auth.users(id) on delete cascade,
 old_value numeric(4,1), new_value numeric(4,1) not null, changed_at timestamptz not null default now()
);
create or replace function public.new_user_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 insert into public.profiles(id,nickname,handicap_index,language,allow_messages)
 values(new.id, coalesce(nullif(left(new.raw_user_meta_data->>'nickname',40),''),'Hráč'),
 case when (new.raw_user_meta_data->>'handicap_index') ~ '^(-?[0-9]+)(\.[0-9]+)?$' then greatest(-10,least(54,(new.raw_user_meta_data->>'handicap_index')::numeric)) else 54 end,
 case when new.raw_user_meta_data->>'language' in ('cs','en','de') then new.raw_user_meta_data->>'language' else 'cs' end,
 coalesce((new.raw_user_meta_data->>'allow_messages')::boolean,true));
 return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_profile();
alter table public.profiles enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.courses enable row level security;
alter table public.course_tees enable row level security;
alter table public.holes enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.scores enable row level security;
alter table public.handicap_history enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (id=auth.uid());
create policy "update own profile" on public.profiles for update to authenticated using (id=auth.uid()) with check(id=auth.uid());
create policy "read own admin membership" on public.admin_memberships for select to authenticated using(user_id=auth.uid());
create policy "read courses" on public.courses for select to authenticated using(true);
create policy "read tees" on public.course_tees for select to authenticated using(true);
create policy "read holes" on public.holes for select to authenticated using(true);
create policy "read games participating" on public.games for select to authenticated using(organizer_id=auth.uid() or exists(select 1 from public.game_players gp where gp.game_id=id and gp.player_id=auth.uid()));
create policy "organizer create games" on public.games for insert to authenticated with check(organizer_id=auth.uid());
create policy "organizer update games" on public.games for update to authenticated using(organizer_id=auth.uid()) with check(organizer_id=auth.uid());
create policy "read own game memberships" on public.game_players for select to authenticated using(player_id=auth.uid());
create policy "read own scores" on public.scores for select to authenticated using(player_id=auth.uid());
create policy "write own scores" on public.scores for insert to authenticated with check(player_id=auth.uid());
create policy "update own scores" on public.scores for update to authenticated using(player_id=auth.uid()) with check(player_id=auth.uid());
create policy "read own handicap history" on public.handicap_history for select to authenticated using(player_id=auth.uid());
-- Future phase: server-side game authorization, cross-flight score entry, messages, admin functions, audit, handicap history trigger.
