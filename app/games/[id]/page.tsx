'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Game = { id: string; name: string; organizer_id: string; play_date: string; status: string; scoring: string; holes_count: number; tee_id: string };
type Hole = { hole_number: number; par: number; stroke_index: number; length_m: number | null };
type Score = { game_player_id: string; hole_number: number; strokes: number | null; picked_up: boolean };
type Member = { id: string; player_id: string; handicap_snapshot: number | null; flight_number: number; finished_at: string | null; nickname: string };
type Rating = { course_rating: number | null; slope_rating: number | null };

export default function GameDetail() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [game, setGame] = useState<Game | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [scores, setScores] = useState<Record<string, Record<number, Score>>>({});
  const [userId, setUserId] = useState('');
  const [rating, setRating] = useState<Rating | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const refreshingRef = useRef(false);
  const [lastRefresh, setLastRefresh] = useState('');
  const [mobileHole, setMobileHole] = useState(1);

  const load = useCallback(async () => {
    const client = supabase();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) { router.replace('/login'); return; }
    setUserId(user.id);
    const { data: g, error: ge } = await client.from('games')
      .select('id,name,organizer_id,play_date,status,scoring,holes_count,tee_id')
      .eq('id', id).single();
    if (ge) throw ge;
    setGame(g as Game);

    const [h, t, p] = await Promise.all([
      client.from('holes').select('hole_number,par,stroke_index,length_m').eq('tee_id', g.tee_id).order('hole_number'),
      client.from('course_tees').select('course_rating,slope_rating').eq('id', g.tee_id).single(),
      client.from('game_players').select('id,player_id,handicap_snapshot,flight_number,finished_at').eq('game_id', id).order('flight_number'),
    ]);
    if (h.error) throw h.error;
    if (t.error) throw t.error;
    if (p.error) throw p.error;
    const participants = (p.data || []) as Omit<Member, 'nickname'>[];
    if (!participants.some(player => player.player_id === user.id)) {
      throw new Error('Nejsi účastníkem této hry.');
    }
    const playerIds = participants.map(player => player.player_id);
    const [profiles, scoreResult] = await Promise.all([
      client.from('profiles').select('id,nickname').in('id', playerIds),
      client.from('scores').select('game_player_id,hole_number,strokes,picked_up').in('game_player_id', participants.map(player => player.id)),
    ]);
    if (profiles.error) throw profiles.error;
    if (scoreResult.error) throw scoreResult.error;
    const names = new Map((profiles.data || []).map(profile => [profile.id, profile.nickname]));
    const playerList = participants.map(player => ({ ...player, nickname: names.get(player.player_id) || 'Hráč' }));
    setMembers(playerList);
    const grouped: Record<string, Record<number, Score>> = {};
    for (const score of (scoreResult.data || []) as Score[]) {
      if (!grouped[score.game_player_id]) grouped[score.game_player_id] = {};
      grouped[score.game_player_id][score.hole_number] = score;
    }
    setScores(grouped);
    setLastRefresh(new Date().toLocaleTimeString('cs-CZ'));
    setHoles((h.data || []) as Hole[]);
    setRating(t.data as Rating);
  }, [id, router]);

  useEffect(() => { load().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [load]);

  // Načítáme pouze průběžná skóre a stav dokončení; ostatní formulářová data se nemění.
  const refreshResults = useCallback(async () => {
    if (savingRef.current || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const client = supabase();
      const { data: participants, error: pe } = await client.from('game_players')
        .select('id,player_id,finished_at').eq('game_id', id);
      if (pe) throw pe;
      const ids = (participants || []).map(player => player.id);
      if (ids.length === 0) return;
      const { data, error: se } = await client.from('scores')
        .select('game_player_id,hole_number,strokes,picked_up').in('game_player_id', ids);
      if (se) throw se;
      if (savingRef.current) return; // Starší odpověď nesmí přepsat právě ukládané rány.
      const grouped: Record<string, Record<number, Score>> = {};
      for (const score of (data || []) as Score[]) {
        if (!grouped[score.game_player_id]) grouped[score.game_player_id] = {};
        grouped[score.game_player_id][score.hole_number] = score;
      }
      setScores(grouped);
      setMembers(prev => prev.map(member => {
        const latest = (participants || []).find(player => player.id === member.id);
        return latest ? { ...member, finished_at: latest.finished_at } : member;
      }));
      setLastRefresh(new Date().toLocaleTimeString('cs-CZ'));
    } catch (e) {
      // Při dočasném výpadku zachováme poslední zobrazené výsledky.
      console.error('Automatická aktualizace výsledků:', e);
    } finally {
      refreshingRef.current = false;
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshResults();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [refreshResults]);

  const expected = game?.holes_count || 18;
  const visible = holes.filter(h => h.hole_number <= expected);
  const coursePar = holes.reduce((sum, h) => sum + h.par, 0);
  const myMember = members.find(member => member.player_id === userId);
  const activeHole = visible.find(h => h.hole_number === mobileHole) || visible[0];
  const activeScore = myMember && activeHole ? scores[myMember.id]?.[activeHole.hole_number] : undefined;
  const completedCount = myMember ? visible.filter(h => Boolean(scores[myMember.id]?.[h.hole_number])).length : 0;

  function playingHandicap(member: Member): number | null {
    if (member.handicap_snapshot === null || rating?.course_rating == null || rating?.slope_rating == null || holes.length !== 18) return null;
    return Math.round(Number(member.handicap_snapshot) * rating.slope_rating / 113 + rating.course_rating - coursePar);
  }
  function points(member: Member, hole: Hole): number | null {
    const score = scores[member.id]?.[hole.hole_number];
    if (!score) return null;
    if (score.picked_up) return 0;
    const ch = playingHandicap(member);
    if (ch === null || expected !== 18 || score.strokes === null) return null;
    const extra = Math.floor(ch / 18) + (hole.stroke_index <= ((ch % 18) + 18) % 18 ? 1 : 0);
    return Math.max(0, 2 + hole.par + extra - score.strokes);
  }
  function totalStrokes(member: Member): number {
    return visible.reduce((sum, h) => sum + (scores[member.id]?.[h.hole_number]?.strokes || 0), 0);
  }
  function totalPoints(member: Member): number | null {
    if (playingHandicap(member) === null || expected !== 18) return null;
    return visible.reduce((sum, h) => sum + (points(member, h) || 0), 0);
  }
  function complete(member: Member): boolean {
    return visible.length === expected && visible.every(h => Boolean(scores[member.id]?.[h.hole_number]));
  }

  async function save(hole: number, value: string) {
    if (!game || !myMember || myMember.finished_at || busy || visible.length !== expected) return;
    const picked_up = value === 'X';
    const strokes = picked_up || value === '' ? null : Number(value);
    if (!picked_up && strokes !== null && (!Number.isInteger(strokes) || strokes < 1 || strokes > 30)) {
      setError('Zadej 1 až 30 ran.'); return;
    }
    savingRef.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const client = supabase();
      if (value === '') {
        const { error: e } = await client.from('scores').delete().eq('game_player_id', myMember.id).eq('hole_number', hole);
        if (e) throw e;
        setScores(prev => { const next = { ...prev, [myMember.id]: { ...(prev[myMember.id] || {}) } }; delete next[myMember.id][hole]; return next; });
      } else {
        const { error: e } = await client.from('scores').upsert({ game_id: id, game_player_id: myMember.id, hole_number: hole, strokes, picked_up, updated_at: new Date().toISOString() }, { onConflict: 'game_player_id,hole_number' });
        if (e) throw e;
        setScores(prev => ({ ...prev, [myMember.id]: { ...(prev[myMember.id] || {}), [hole]: { game_player_id: myMember.id, hole_number: hole, strokes, picked_up } } }));
      }
      setNotice('Skóre uloženo.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  }

  async function finish() {
    if (!myMember || myMember.finished_at || !complete(myMember) || busy) return;
    if (!window.confirm('Opravdu potvrdit dokončení své hry? Další úpravy skóre budou zablokované.')) return;
    savingRef.current = true;
    setBusy(true); setError('');
    try {
      const { error: e } = await supabase().from('game_players').update({ finished_at: new Date().toISOString() }).eq('id', myMember.id).eq('player_id', userId);
      if (e) throw e;
      setMembers(prev => prev.map(member => member.id === myMember.id ? { ...member, finished_at: new Date().toISOString() } : member));
      setNotice('Tvoje hra je dokončena.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  }

  return <main>
    <style>{`
      .golf-mobile { display: none; }
      @media (max-width: 700px) {
        main:has(.golf-mobile) { padding: 10px 12px 45px !important; width: 100% !important; max-width: 100% !important; }
        main:has(.golf-mobile) > h1 { font-size: 22px; margin: 6px 0 4px; }
        main:has(.golf-mobile) > .brand { margin: 0 0 4px; font-size: 10px; }
        main:has(.golf-mobile) > h1 + p { margin: 3px 0 8px; font-size: 12px; }
        .golf-desktop { display: none !important; }
        .golf-mobile { display: block; }
        .golf-mobile .mobile-card { background: #fff; color: #123d2b; border-radius: 15px; padding: 12px 14px; margin: 9px 0; }
        .golf-mobile .mobile-nav { display: flex; gap: 10px; justify-content: space-between; align-items: center; }
        .golf-mobile .mobile-nav button { flex: 1; min-width: 0; padding: 9px 5px; border: 1px solid #c8d8ce; background: #f1f6f2; color: #123d2b; border-radius: 10px; font-size: 13px; font-weight: 700; }
        .golf-mobile button:disabled { opacity: .45; }
        .golf-mobile .mobile-stepper { display: flex; align-items: center; justify-content: center; gap: 18px; padding: 8px 0; }
        .golf-mobile .mobile-stepper button { height: 52px; width: 52px; border-radius: 12px; border: 0; background: #103e2c; color: white; font-size: 30px; font-weight: 700; }
        .golf-mobile .mobile-number { font-size: 38px; font-weight: 800; min-width: 55px; text-align: center; }
        .golf-mobile .mobile-sub { color: #547163; font-size: 13px; }
        .golf-mobile .mobile-rows { width: 100%; border-collapse: collapse; }
        .golf-mobile .mobile-rows td { padding: 11px 2px; border-bottom: 1px solid #e1e9e3; }
        .golf-mobile .mobile-rows td:last-child { text-align: right; font-weight: 700; }
        .golf-mobile .mobile-pill { padding: 7px; background: #e9f2eb; border-radius: 12px; text-align: center; }
        .golf-mobile .mobile-action { width: 100%; padding: 9px; border: 1px solid #c8d8ce; border-radius: 12px; background: #f1f6f2; color: #123d2b; font-weight: 700; margin-top: 8px; }
        .golf-mobile .mobile-holes { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
        .golf-mobile .mobile-holes button { padding: 8px 0; border: 1px solid #c8d8ce; border-radius: 9px; background: #f5f8f5; color: #123d2b; }
        .golf-mobile .mobile-card:first-child > .mobile-nav:first-child strong { font-size: 19px; }
        .golf-mobile .mobile-card:first-child > .mobile-sub { margin: 5px 0; }
        .golf-mobile .mobile-card:first-child .mobile-nav { gap: 8px; }
        .golf-mobile .mobile-card:first-child .mobile-nav button { min-height: 42px; }
        .golf-mobile .mobile-holes button.active { background: #103e2c; color: #fff; }
        .golf-mobile .mobile-holes button.recorded:not(.active) { background: #dcefe0; }
      }
    `}</style>
    <p className="brand">LONY GOLF SCORECARD</p>
    {!game ? <p>{error || 'Načítám hru…'}</p> : <>
      <h1>{game.name}</h1>
      <p>{game.play_date} · {expected} jamek · {game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</p>
      <div className="panel golf-desktop">
        <h2>Společná hra – flight</h2>
        <p className="muted">Hráči ve flightu. Každý zapisuje pouze své vlastní výsledky ve společné scorekartě.</p>
        {members.map(member => <div key={member.id} className="btn secondary"
          style={{ display: 'block', width: '100%', marginBottom: 8, textAlign: 'left', cursor: 'default' }}>
          {member.nickname}{member.player_id === userId ? ' (já)' : ''} · HCP {member.handicap_snapshot ?? '–'}
          {playingHandicap(member) !== null ? ` · Herní HCP ${playingHandicap(member)}` : ''}
          {member.finished_at ? ' · Dokončeno' : ''}
        </div>)}
        <p className="muted">Výsledky se automaticky aktualizují každých 5 sekund, když je stránka otevřená. {lastRefresh && `Poslední aktualizace: ${lastRefresh}`}</p>
        <button type="button" className="btn secondary" onClick={() => void refreshResults()}>Aktualizovat výsledky</button>
      </div>
      <div className="panel golf-desktop">
        <h2>Společná scorekarta flightu</h2>
        <p className="muted">Všichni hráči na jedné scorekartě. Své rány můžeš zapisovat přímo zde; ostatní hráče můžeš pouze sledovat. Na mobilu posuň tabulku do strany.</p>
        {visible.length !== expected && <p className="error">Hřiště nemá všech {expected} jamek. Zápis není dostupný.</p>}
        <div className="score-scroll" style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table className="score-table" style={{ minWidth: 380 + members.length * (game.scoring === 'stableford' ? 145 : 85) }}>
            <thead>
              <tr>
                <th rowSpan={2}>Jamka</th><th rowSpan={2}>PAR</th><th rowSpan={2}>SI</th>
                {members.map(member => <th key={member.id} colSpan={game.scoring === 'stableford' ? 2 : 1} scope="colgroup" style={{ textAlign: 'center', background: member.player_id === userId ? 'rgba(45,130,85,0.15)' : undefined }}>
                  {member.nickname}{member.player_id === userId ? ' (já)' : ''}
                  <div style={{ fontSize: '0.8em', fontWeight: 400 }}>HCP {member.handicap_snapshot ?? '–'}{playingHandicap(member) !== null ? ` · Herní ${playingHandicap(member)}` : ''}</div>
                </th>)}
              </tr>
              <tr>{members.map(member => <Fragment key={member.id}><th>Rány</th>{game.scoring === 'stableford' && <th>Body</th>}</Fragment>)}</tr>
            </thead>
            <tbody>
              {visible.map(hole => <tr key={hole.hole_number}>
                <th scope="row">{hole.hole_number}</th><td>{hole.par}</td><td>{hole.stroke_index}</td>
                {members.map(member => {
                  const score = scores[member.id]?.[hole.hole_number];
                  const editable = member.player_id === userId && !member.finished_at && visible.length === expected;
                  return <Fragment key={member.id}>
                    <td style={{ background: member.player_id === userId ? 'rgba(45,130,85,0.08)' : undefined }}>
                      {editable ? <select
                        aria-label={`Rány ${member.nickname}, jamka ${hole.hole_number} – společná scorekarta`}
                        disabled={busy}
                        value={score?.picked_up ? 'X' : score?.strokes ?? ''}
                        onChange={e => void save(hole.hole_number, e.target.value)}
                      >
                        <option value="">–</option>
                        {Array.from({ length: 30 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                        <option value="X">X</option>
                      </select> : score?.picked_up ? 'X' : score?.strokes ?? '–'}
                    </td>
                    {game.scoring === 'stableford' && <td>{points(member, hole) ?? '–'}</td>}
                  </Fragment>;
                })}
              </tr>)}
            </tbody>
            <tfoot><tr>
              <th>Celkem</th><th>{visible.reduce((sum, hole) => sum + hole.par, 0)}</th><th>–</th>
              {members.map(member => <Fragment key={member.id}><th>{totalStrokes(member)}</th>{game.scoring === 'stableford' && <th>{totalPoints(member) ?? '–'}</th>}</Fragment>)}
            </tr></tfoot>
          </table>
        </div>
        {game.scoring === 'stableford' && expected !== 18 && <p className="muted">Stableford body jsou v této verzi dostupné pouze pro 18 jamek.</p>}
      </div>
      {myMember && <div className="panel golf-desktop">
        <h2>Dokončení hry</h2>
        {myMember.finished_at ? <p className="success">Hru jsi dokončil.</p> :
          <button className="btn secondary" disabled={busy || !complete(myMember)} onClick={finish}>Potvrdit dokončení hry</button>}
      </div>}
      <div className="panel golf-desktop">
        <h2>Průběžné výsledky</h2>
        <div className="score-scroll"><table className="score-table">
          <thead><tr><th>Hráč</th><th>HCP</th><th>Rány</th>{game.scoring === 'stableford' && <th>Body</th>}</tr></thead>
          <tbody>{[...members].sort((a, b) => game.scoring === 'stableford' ? (totalPoints(b) ?? -1) - (totalPoints(a) ?? -1) : totalStrokes(a) - totalStrokes(b)).map(member =>
            <tr key={member.id}><td>{member.nickname}</td><td>{member.handicap_snapshot ?? '–'}</td><td>{totalStrokes(member)}</td>
              {game.scoring === 'stableford' && <td>{totalPoints(member) ?? '–'}</td>}</tr>)}</tbody>
        </table></div>
        <p className="muted">Pořadí je průběžné. Nula ran může znamenat, že hráč ještě nezapsal výsledek. Výsledky ostatních hráčů se načítají automaticky každých 5 sekund.</p>
      </div>
      <section className="golf-mobile" aria-label="Mobilní scorekarta">
        <div className="mobile-card">
          <div className="mobile-nav">
            <strong>Jamka {activeHole?.hole_number ?? '–'} / {expected}</strong>
            <span className="mobile-sub">{completedCount} z {expected} zapsáno</span>
          </div>
          {activeHole && <>
            <p className="mobile-sub">PAR {activeHole.par} · SI {activeHole.stroke_index}{activeHole.length_m != null ? ` · ${activeHole.length_m} m` : ''}</p>
            <div className="mobile-nav" style={{ marginTop: 7 }}>
              <div><strong>{myMember?.nickname || 'Moje skóre'}</strong><div className="mobile-sub">Herní HCP {myMember ? playingHandicap(myMember) ?? '–' : '–'}</div></div>
              <div style={{ textAlign: 'right' }}><strong>{myMember ? totalPoints(myMember) ?? '–' : '–'}</strong><div className="mobile-sub">Celkem bodů</div></div>
            </div>
            <div className="mobile-stepper">
              <button type="button" aria-label="Odebrat ránu" disabled={!myMember || Boolean(myMember.finished_at) || busy || visible.length !== expected || !activeScore?.strokes || activeScore.strokes <= 1} onClick={() => void save(activeHole.hole_number, String((activeScore?.strokes || 1) - 1))}>−</button>
              <div><div className="mobile-number">{activeScore?.picked_up ? 'X' : activeScore?.strokes ?? '–'}</div><div className="mobile-sub" style={{ textAlign: 'center' }}>ran</div></div>
              <button type="button" aria-label="Přidat ránu" disabled={!myMember || Boolean(myMember.finished_at) || busy || visible.length !== expected || (activeScore?.strokes ?? 0) >= 30} onClick={() => void save(activeHole.hole_number, String(activeScore?.strokes ? activeScore.strokes + 1 : 1))}>+</button>
            </div>
            {game.scoring === 'stableford' && <div className="mobile-pill"><strong style={{ fontSize: 21 }}>{myMember ? points(myMember, activeHole) ?? '–' : '–'}</strong><div className="mobile-sub">Stableford bodů za jamku</div></div>}
            <div className="mobile-nav" style={{ marginTop: 8 }}>
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || busy || visible.length !== expected} onClick={() => void save(activeHole.hole_number, 'X')}>Zvednutý míč (X)</button>
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || busy || visible.length !== expected || !activeScore} onClick={() => void save(activeHole.hole_number, '')}>Smazat skóre</button>
            </div>
            <div className="mobile-nav" style={{ marginTop: 8 }}>
              <button type="button" disabled={activeHole.hole_number <= 1} onClick={() => setMobileHole(Math.max(1, activeHole.hole_number - 1))}>← Předchozí</button>
              <button type="button" disabled={activeHole.hole_number >= expected} onClick={() => setMobileHole(Math.min(expected, activeHole.hole_number + 1))}>Další →</button>
            </div>
          </>}
        </div>
        <div className="mobile-card">
          <h3 style={{ marginTop: 0 }}>Přehled jamek</h3>
          <div className="mobile-holes">{visible.map(h => <button key={h.hole_number} type="button" className={`${mobileHole === h.hole_number ? 'active' : ''} ${myMember && scores[myMember.id]?.[h.hole_number] ? 'recorded' : ''}`} onClick={() => setMobileHole(h.hole_number)}>{h.hole_number}</button>)}</div>
        </div>
        <div className="mobile-card">
          <h3 style={{ marginTop: 0 }}>Průběžné výsledky</h3>
          <table className="mobile-rows"><tbody>{[...members].sort((a,b) => game.scoring === 'stableford' ? (totalPoints(b) ?? -1) - (totalPoints(a) ?? -1) : totalStrokes(a) - totalStrokes(b)).map((member,i) => <tr key={member.id}><td>{i+1}. {member.nickname}{member.player_id === userId ? ' (já)' : ''}</td><td>{game.scoring === 'stableford' ? `${totalPoints(member) ?? '–'} b` : `${totalStrokes(member)} ran`}</td></tr>)}</tbody></table>
          <p className="mobile-sub">Aktualizace každých 5 sekund. {lastRefresh && `Naposledy ${lastRefresh}`}</p>
          <button type="button" className="mobile-action" onClick={() => void refreshResults()}>Aktualizovat výsledky</button>
        </div>
        {myMember && <div className="mobile-card"><h3 style={{ marginTop: 0 }}>Dokončení hry</h3>{myMember.finished_at ? <p>Hra dokončena.</p> : <><p className="mobile-sub">Zapsáno {completedCount} z {expected} jamek. Hru lze dokončit až po vyplnění všech.</p><button type="button" className="mobile-action" disabled={busy || !complete(myMember)} onClick={() => void finish()}>Potvrdit dokončení hry</button></>}</div>}
      </section>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>}
    <p><Link href="/games">← Moje hry</Link></p>
  </main>;
}
