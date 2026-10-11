'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Member = { id: string; game_id: string; handicap_snapshot: number | null; finished_at: string | null; finish_reason: string | null; finish_note: string | null };
type Game = { id: string; name: string; play_date: string; holes_count: number; scoring: string; tee_id: string; course_id: string };
type Hole = { hole_number: number; par: number; stroke_index: number };
type Score = { hole_number: number; strokes: number | null; picked_up: boolean };
type Entry = { game: Game; courseName: string; strokes: number; points: number | null; pickedUp: number; finishedAt: string | null; finishReason: string | null; finishNote: string | null; playedHoles: number };

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
          .select('id,game_id,handicap_snapshot,finished_at,finish_reason,finish_note')
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
          const playedHoles = visible.filter(h => byHole.has(h.hole_number)).length;
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
          return { game, courseName: courseResult.data?.name || 'Hřiště neuvedeno', strokes, points, pickedUp, finishedAt: member.finished_at, finishReason: member.finish_reason, finishNote: member.finish_note, playedHoles } as Entry;
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
        <p className="muted">Tvé dokončené i předčasně ukončené golfové hry a dosažené výsledky.</p>
        {loading && <p>Načítám historii…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {!loading && !error && entries.length === 0 && <p>Zatím nemáš žádnou ukončenou hru.</p>}
        {!loading && !error && <div style={{ display: 'grid', gap: 12 }}>
          {entries.map(({ game, courseName, strokes, points, pickedUp, finishReason, finishNote, playedHoles, finishedAt }) => (
            <Link key={game.id} href={'/games/' + game.id} style={{ display: 'block', padding: 16, borderRadius: 14, background: '#eef3e5', color: '#173b29', textDecoration: 'none' }}>
              <strong style={{ fontSize: '1.12rem' }}>{game.name}</strong>
              <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ display: 'inline-block', padding: '5px 10px', borderRadius: 999, background: finishReason ? '#f8e6d8' : '#dcebdc', color: finishReason ? '#884421' : '#1d6039', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {finishReason ? 'Předčasně ukončeno' : 'Dokončeno'}
                </span>
                {finishedAt && <span style={{ fontSize: 12, opacity: 0.75 }}>Ukončeno {new Date(finishedAt).toLocaleDateString('cs-CZ')}</span>}
              </div>
              {finishReason && <div style={{ marginTop: 8, fontSize: 14 }}><strong>Důvod:</strong> {finishReason}</div>}
              {finishReason && finishNote && <div style={{ marginTop: 4, fontSize: 13, overflowWrap: 'anywhere' }}><strong>Poznámka:</strong> {finishNote}</div>}
              <div style={{ marginTop: 5, opacity: 0.85 }}>{game.play_date} · {courseName} · {game.holes_count} jamek</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
                <span><strong>{playedHoles}/{game.holes_count}</strong> jamek</span>
                <span><strong>{strokes}</strong> ran{pickedUp > 0 ? ` · ${pickedUp}× X` : ''}</span>
                {game.scoring === 'stableford' && <span><strong>{points ?? '–'}</strong> Stableford bodů</span>}
              </div>
              {finishReason && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>Nedokončený výsledek se nezapočítává do soutěžního pořadí.</div>}
              <div style={{ marginTop: 10, fontSize: '0.85rem', textDecoration: 'underline' }}>Otevřít scorekartu →</div>
            </Link>
          ))}
        </div>}
        <div style={{ marginTop: 22, marginBottom: 12 }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}>
        <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span>
        <span>Zpět na přehled</span>
      </Link>
    </div>
      </div>
    </main>
  );
}
