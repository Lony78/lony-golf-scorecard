-- LONY phase 2: run ONCE after schema.sql. RLS for a player's own games/scores.
-- Do not run schema.sql again if already installed.
create policy "player add self to organized game" on public.game_players
for insert to authenticated with check (player_id=auth.uid() and exists
 (select 1 from public.games g where g.id=game_id and g.organizer_id=auth.uid()));
create policy "player confirm own completion" on public.game_players
for update to authenticated using(player_id=auth.uid()) with check(player_id=auth.uid());
create policy "player remove own score" on public.scores
for delete to authenticated using(player_id=auth.uid());
create policy "organizer delete own planned game" on public.games
for delete to authenticated using(organizer_id=auth.uid() and status='planned');
-- Restrict score editing after the player confirms completion.
create or replace function public.reject_finished_score_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if exists (select 1 from public.game_players gp where gp.game_id=coalesce(new.game_id,old.game_id)
 and gp.player_id=coalesce(new.player_id,old.player_id) and gp.finished_at is not null)
 then raise exception 'Hráč již potvrdil dokončení hry'; end if;
 return coalesce(new,old);
end $$;
drop trigger if exists scores_reject_finished on public.scores;
create trigger scores_reject_finished before insert or update or delete on public.scores
for each row execute function public.reject_finished_score_changes();
