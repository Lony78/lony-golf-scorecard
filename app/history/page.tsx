'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Member = { id: string; game_id: string; handicap_snapshot: number | null; finished_at: string | null };
type Game = { id: string; name: string; play_date: string; holes_count: number; scoring: string; tee_id: string; course_id: string };
type Hole = { hole_number: number; par: number; stroke_index: number };
type Score = { hole_number: number; strokes: number | null; picked_up: boolean };
type Entry = { game: Game; courseName: string; strokes: number; points: number | null; pickedUp: number; finishedAt: string | null };

export default function HistoryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = supabase();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }

        // A completed game is defined by the logged-in player's finished_at.
        const { data: members, error: membersError } = await client.from('game_players')
          .select('id,game_id,handicap_snapshot,finished_at')
          .eq('player_id', user.id).not('finished_at', 'is', null);
        if (membersError) throw membersError;
        const completed = (members || []) as Member[];
        if (!completed.length) { if (active) setEntries([]); return; }

        const ids = [...new Set(completed.map(m => m.game_id))];
        const { data: games, error: gamesError } = await client.from('games')
          .select('id,name,play_date,holes_count,scoring,tee_id,course_id')
          .in('id', ids).order('play_date', { ascending: false });
        if (gamesError) throw gamesError;

        const results = await Promise.all(((games || []) as Game[]).map(async game => {
          const member = completed.find(m => m.game_id === game.id);
          if (!member) return null;
          const [scoreResult, holeResult, teeResult, courseResult] = await Promise.all([
            client.from('scores').select('hole_number,strokes,picked_up').eq('game_player_id', member.id),
            client.from('holes').select('hole_number,par,stroke_index').eq('tee_id', game.tee_id).order('hole_number'),
            client.from('course_tees').select('course_rating,slope_rating').eq('id', game.tee_id).maybeSingle(),
            client.from('courses').select('name').eq('id', game.course_id).maybeSingle(),
          ]);
          for (const result of [scoreResult, holeResult, teeResult, courseResult]) {
            if (result.error) throw result.error;
          }
          const scores = (scoreResult.data || []) as Score[];
          const holes = (holeResult.data || []) as Hole[];
          const visible = holes.filter(h => h.hole_number <= game.holes_count);
          const byHole = new Map(scores.map(s => [s.hole_number, s]));
          const strokes = scores.reduce((sum, s) => sum + (s.strokes ?? 0), 0);
          const pickedUp = scores.filter(s => s.picked_up).length;
          let points: number | null = null;
          const tee = teeResult.data;
          if (game.scoring === 'stableford' && game.holes_count === 18 && holes.length === 18 &&
              member.handicap_snapshot !== null && tee?.course_rating != null && tee?.slope_rating != null) {
            const par = holes.reduce((sum, h) => sum + h.par, 0);
            const playingHcp = Math.round(Number(member.handicap_snapshot) * tee.slope_rating / 113 + tee.course_rating - par);
            points = visible.reduce((sum, hole) => {
              const score = byHole.get(hole.hole_number);
              if (!score || score.picked_up || score.strokes === null) return sum;
              const extra = Math.floor(playingHcp / 18) + (hole.stroke_index <= ((playingHcp % 18) + 18) % 18 ? 1 : 0);
              return sum + Math.max(0, 2 + hole.par + extra - score.strokes);
            }, 0);
          }
          return { game, courseName: courseResult.data?.name || 'Hřiště neuvedeno', strokes, points, pickedUp, finishedAt: member.finished_at } as Entry;
        }));
        if (active) setEntries(results.filter((entry): entry is Entry => entry !== null));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Historii her se nepodařilo načíst.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  return (
    <main>
      <p className="brand">LONY GOLF SCORECARD</p>
      <div className="panel">
        <h1>Historie her</h1>
        <p className="muted">Tvé dokončené golfové hry a dosažené výsledky.</p>
        {loading && <p>Načítám historii…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!loading && !error && entries.length === 0 && <p>Zatím nemáš žádnou dokončenou hru.</p>}
        {!loading && !error && <div style={{ display: 'grid', gap: 12 }}>
          {entries.map(({ game, courseName, strokes, points, pickedUp }) => (
            <Link key={game.id} href={'/games/' + game.id} style={{ display: 'block', padding: 16, borderRadius: 14, background: '#eef3e5', color: '#173b29', textDecoration: 'none' }}>
              <strong style={{ fontSize: '1.12rem' }}>{game.name}</strong>
              <div style={{ marginTop: 5, opacity: 0.85 }}>{game.play_date} · {courseName} · {game.holes_count} jamek</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                <span><strong>{strokes}</strong> ran{pickedUp > 0 ? ` · ${pickedUp}× X` : ''}</span>
                {game.scoring === 'stableford' && <span><strong>{points ?? '–'}</strong> Stableford bodů</span>}
              </div>
              <div style={{ marginTop: 10, fontSize: '0.85rem', textDecoration: 'underline' }}>Otevřít scorekartu →</div>
            </Link>
          ))}
        </div>}
        <p><Link href="/dashboard">← Zpět na hlavní stránku</Link></p>
      </div>
    </main>
  );
}
