'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Member = { id: string; game_id: string; handicap_snapshot: number | null; finished_at: string | null; finish_reason: string | null; finish_note: string | null; flight_number: number | null; tee_id: string | null };
type Game = { id: string; name: string; play_date: string; holes_count: number; scoring: string; tee_id: string; course_id: string };
type Hole = { hole_number: number; par: number; stroke_index: number };
type Score = { game_player_id: string; hole_number: number; strokes: number | null; picked_up: boolean };
type Entry = { game: Game; courseName: string; strokes: number; points: number | null; pickedUp: number; finishReason: string | null; finishNote: string | null; playedHoles: number; place: number | null; flightNumber: number | null; teeName: string };

function Trophy({ place }: { place: number }) {
  const colors = place === 1 ? ['#FFE88B', '#DFA51E', '#9B6605'] : place === 2 ? ['#F0F4F7', '#A8B3C1', '#6C798A'] : ['#F0BE88', '#BC7744', '#854B29'];
  const gradientId = `history-cup-${place}`;
  return <svg width="42" height="42" viewBox="0 0 64 64" role="img" aria-label={`${place}. místo`}>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={colors[0]}/><stop offset="55%" stopColor={colors[1]}/><stop offset="100%" stopColor={colors[2]}/></linearGradient></defs>
    <path d="M15 11H49V27C49 39 42 44 32 44S15 39 15 27Z" fill={`url(#${gradientId})`} stroke={colors[2]} strokeWidth="1.4"/>
    <path d="M15 16H7V24C7 32 12 35 20 35M49 16H57V24C57 32 52 35 44 35" fill="none" stroke={colors[1]} strokeWidth="5" strokeLinecap="round"/>
    <path d="M32 44V52M22 57H42M27 52H37" stroke={colors[1]} strokeWidth="6" strokeLinecap="round"/>
    <path d="M22 16H42" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".55"/>
    <text x="32" y="32" fontSize="17" textAnchor="middle" fontWeight="800" fill={place === 2 ? '#4B5563' : '#fff'}>{place}</text>
  </svg>;
}

function calculatePoints(member: Member, scores: Score[], holes: Hole[], rating: number | null, slope: number | null, holesCount: number) {
  if (holesCount !== 18 || holes.length !== 18 || member.handicap_snapshot === null || rating === null || slope === null) return null;
  const par = holes.reduce((sum, h) => sum + h.par, 0);
  const hcp = Math.round(Number(member.handicap_snapshot) * slope / 113 + rating - par);
  const byHole = new Map(scores.map(s => [s.hole_number, s]));
  return holes.filter(h => h.hole_number <= holesCount).reduce((sum, hole) => {
    const score = byHole.get(hole.hole_number);
    if (!score || score.picked_up || score.strokes === null) return sum;
    const extra = Math.floor(hcp / 18) + (hole.stroke_index <= ((hcp % 18) + 18) % 18 ? 1 : 0);
    return sum + Math.max(0, 2 + hole.par + extra - score.strokes);
  }, 0);
}

export default function HistoryPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [opened, setOpened] = useState<string | null>(null);
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
        const { data: own, error: membersError } = await client.from('game_players')
          .select('id,game_id,handicap_snapshot,finished_at,finish_reason,finish_note,flight_number,tee_id')
          .eq('player_id', user.id).not('finished_at', 'is', null);
        if (membersError) throw membersError;
        const completed = (own || []) as Member[];
        if (!completed.length) { if (active) setEntries([]); return; }
        const ids = [...new Set(completed.map(m => m.game_id))];
        const { data: games, error: gamesError } = await client.from('games')
          .select('id,name,play_date,holes_count,scoring,tee_id,course_id')
          .in('id', ids).order('play_date', { ascending: false });
        if (gamesError) throw gamesError;
        const results = await Promise.all(((games || []) as Game[]).map(async game => {
          const member = completed.find(m => m.game_id === game.id);
          if (!member) return null;
          const [scoreResult, courseResult, flightResult] = await Promise.all([
            client.from('scores').select('game_player_id,hole_number,strokes,picked_up').eq('game_player_id', member.id),
            client.from('courses').select('name').eq('id', game.course_id).maybeSingle(),
            client.from('game_players').select('id,game_id,handicap_snapshot,finished_at,finish_reason,finish_note,flight_number,tee_id').eq('game_id', game.id),
          ]);
          if (scoreResult.error) throw scoreResult.error;
          if (courseResult.error) throw courseResult.error;
          if (flightResult.error) throw flightResult.error;

          const flightMembers = (flightResult.data || []) as Member[];
          const teeIds = [...new Set([member, ...flightMembers].map(p => p.tee_id || game.tee_id))];
          const [holeResult, teeResult] = await Promise.all([
            client.from('holes').select('tee_id,hole_number,par,stroke_index').in('tee_id', teeIds).order('hole_number'),
            client.from('course_tees').select('id,name,course_rating,slope_rating').in('id', teeIds),
          ]);
          if (holeResult.error) throw holeResult.error;
          if (teeResult.error) throw teeResult.error;

          type TeeData = { id: string; name: string; course_rating: number | null; slope_rating: number | null };
          type TeeHole = Hole & { tee_id: string };
          const teeMap = new Map(((teeResult.data || []) as TeeData[]).map(t => [t.id, t]));
          const holesByTee = new Map<string, Hole[]>();
          for (const hole of (holeResult.data || []) as TeeHole[]) {
            const existing = holesByTee.get(hole.tee_id) || [];
            existing.push(hole);
            holesByTee.set(hole.tee_id, existing);
          }
          const teeFor = (player: Member) => player.tee_id || game.tee_id;
          const holesFor = (player: Member) => holesByTee.get(teeFor(player)) || [];
          const pointsFor = (player: Member, playerScores: Score[]) => {
            const tee = teeMap.get(teeFor(player));
            return calculatePoints(
              player, playerScores, holesFor(player),
              tee?.course_rating == null ? null : Number(tee.course_rating),
              tee?.slope_rating == null ? null : Number(tee.slope_rating),
              game.holes_count
            );
          };

          const scores = (scoreResult.data || []) as Score[];
          const visible = holesFor(member).filter(h => h.hole_number <= game.holes_count);
          const byHole = new Map(scores.map(s => [s.hole_number, s]));
          const strokes = scores.reduce((sum, s) => sum + (s.strokes ?? 0), 0);
          const pickedUp = scores.filter(s => s.picked_up).length;
          const playedHoles = visible.filter(h => byHole.has(h.hole_number)).length;
          const points = game.scoring === 'stableford' ? pointsFor(member, scores) : null;
          const teeName = teeMap.get(teeFor(member))?.name || 'Neuvedeno';
          let place: number | null = null;
          // Pořadí až po dokončení celého flightu, bez předčasně ukončených hráčů.
          if (!member.finish_reason && member.flight_number !== null) {
            const flight = flightMembers.filter(p => p.flight_number === member.flight_number);
            if (flight.length > 0 && flight.every(p => p.finished_at !== null)) {
              const { data: allScores, error: allScoresError } = await client.from('scores')
                .select('game_player_id,hole_number,strokes,picked_up').in('game_player_id', flight.map(p => p.id));
              if (!allScoresError) {
                const all = (allScores || []) as Score[];
                const ranked = flight.filter(p => !p.finish_reason).map(p => {
                  const ps = all.filter(s => s.game_player_id === p.id);
                  const playerHoles = holesFor(p).filter(h => h.hole_number <= game.holes_count);
                  const valid = playerHoles.length === game.holes_count && playerHoles.every(h => ps.some(s => s.hole_number === h.hole_number));
                  const value = game.scoring === 'stableford'
                    ? pointsFor(p, ps)
                    : ps.reduce((sum, s) => sum + (s.strokes ?? 0), 0);
                  return { id: p.id, value, valid: valid && value !== null && (game.scoring === 'stableford' || ps.every(s => !s.picked_up && s.strokes !== null)) };
                });
                if (ranked.every(p => p.valid)) {
                  ranked.sort((a, b) => game.scoring === 'stableford' ? Number(b.value) - Number(a.value) : Number(a.value) - Number(b.value));
                  const ownIndex = ranked.findIndex(p => p.id === member.id);
                  if (ownIndex >= 0) place = ranked.findIndex(p => p.value === ranked[ownIndex].value) + 1;
                }
              }
            }
          }
          return { game, courseName: courseResult.data?.name || 'Hřiště neuvedeno', strokes, points, pickedUp, finishReason: member.finish_reason, finishNote: member.finish_note, playedHoles, place, flightNumber: member.flight_number, teeName } as Entry;
        }));
        if (active) setEntries(results.filter((entry): entry is Entry => entry !== null));
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Historii her se nepodařilo načíst.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  return <main>
    <p className="brand">LONY GOLF SCORECARD</p>
    <div className="panel">
      <h1>Historie her</h1>
      <p className="muted">Přehled tvých odehraných golfových her.</p>
      {loading && <p>Načítám historii…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && <p>Zatím nemáš žádnou ukončenou hru.</p>}
      {!loading && !error && <div style={{ display: 'grid', gap: 12 }}>
        {entries.map(entry => {
          const { game, courseName, strokes, points, pickedUp, finishReason, finishNote, playedHoles, place, flightNumber, teeName } = entry;
          const isOpen = opened === game.id;
          return <div key={game.id} style={{ borderRadius: 14, background: '#eef3e5', color: '#173b29', overflow: 'hidden' }}>
            <button type="button" onClick={() => setOpened(isOpen ? null : game.id)} aria-expanded={isOpen}
              style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 9, textAlign: 'left', padding: 13, background: 'transparent', border: 0, color: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ flex: '1 1 0', minWidth: 0, display: 'grid', gap: 4 }}>
                <strong style={{ fontSize: 14, overflowWrap: 'break-word' }}>{game.name}</strong>
                <span style={{ fontSize: 12, opacity: .85, overflowWrap: 'break-word' }}>{courseName}</span>
                <span style={{ fontSize: 12, opacity: .8, whiteSpace: 'nowrap' }}>{new Date(game.play_date + 'T12:00:00').toLocaleDateString('cs-CZ')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 650, color: finishReason ? '#A05B2D' : '#287343', whiteSpace: 'nowrap' }}>
                  <span aria-hidden="true">{finishReason ? '⚠' : '✓'}</span>{finishReason ? 'Předčasně ukončeno' : 'Ukončeno'}
                </span>
              </div>
              <div style={{ width: 53, flexShrink: 0, textAlign: 'center', display: 'grid', justifyItems: 'center', gap: 2 }}>
                {place !== null && place <= 3 ? <Trophy place={place}/> : <span style={{ height: 42, display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 750, color: '#77847A' }}>{place === null ? '–' : place}</span>}
                <span style={{ fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{place === null ? 'Bez pořadí' : `${place}. místo`}</span>
              </div>
              <div style={{ flexShrink: 0, display: 'grid', gap: 8, minWidth: 65 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, whiteSpace: 'nowrap' }}><span style={{ fontSize: 11, opacity: .75 }}>STB</span><strong style={{ fontSize: 16 }}>{points ?? '–'}</strong></div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, whiteSpace: 'nowrap' }}><span style={{ fontSize: 11, opacity: .75 }}>Rány</span><strong style={{ fontSize: 16 }}>{strokes}</strong></div>
              </div>
              <span aria-hidden="true" style={{ fontSize: 16, opacity: .65, flexShrink: 0 }}>{isOpen ? '⌃' : '⌄'}</span>
            </button>
            {isOpen && <div style={{ borderTop: '1px solid #d4e2d1', padding: '13px 15px 16px', display: 'grid', gap: 11, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Stav hry</span><strong style={{ textAlign: 'right' }}>{finishReason ? 'Předčasně ukončeno' : 'Ukončeno'}</strong></div>
              {finishReason && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Důvod</span><strong style={{ textAlign: 'right' }}>{finishReason}</strong></div>}
              {finishNote && <div><span>Poznámka:</span><div style={{ marginTop: 3, overflowWrap: 'anywhere' }}>{finishNote}</div></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Odehráno jamek</span><strong>{playedHoles} z {game.holes_count}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Odpaliště</span><strong>{teeName}</strong></div>
              {pickedUp > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Zvednutý míč</span><strong>{pickedUp}× X</strong></div>}
              {flightNumber !== null && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>Flight</span><strong>{flightNumber}</strong></div>}
              {finishReason && <span style={{ fontSize: 11, opacity: .8 }}>Předčasně ukončený hráč se nezapočítává do pořadí.</span>}
              <Link href={'/games/' + game.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 13px', borderRadius: 10, background: '#dae8d7', color: '#173b29', textDecoration: 'none', fontWeight: 700 }}>Otevřít scorekartu <span aria-hidden="true">↗</span></Link>
            </div>}
          </div>;
        })}
      </div>}
      <div style={{ marginTop: 22, marginBottom: 12 }}>
        <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}><span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span><span>Zpět na přehled</span></Link>
      </div>
    </div>
  </main>;
}
