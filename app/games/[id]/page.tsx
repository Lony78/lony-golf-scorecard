'use client';

import type { TouchEvent } from 'react';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Game = { id: string; name: string; organizer_id: string; play_date: string; status: string; scoring: string; holes_count: number; tee_id: string; course_id: string };
type Hole = { hole_number: number; par: number; stroke_index: number; length_m: number | null };
type Score = { game_player_id: string; hole_number: number; strokes: number | null; picked_up: boolean };
type Member = { id: string; player_id: string; handicap_snapshot: number | null; flight_number: number; finished_at: string | null; finish_reason: string | null; finish_note: string | null; tee_id: string | null; nickname: string };
type Rating = { id: string; name: string; course_rating: number | null; slope_rating: number | null; par_total: number | null };

export default function GameDetail() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [game, setGame] = useState<Game | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [playerAvatars, setPlayerAvatars] = useState<Record<string, string>>({});
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({});
  const [scores, setScores] = useState<Record<string, Record<number, Score>>>({});
  const [userId, setUserId] = useState('');
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [teeHoles, setTeeHoles] = useState<Record<string, Hole[]>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  const refreshingRef = useRef(false);
  const [lastRefresh, setLastRefresh] = useState('');
  const [mobileHole, setMobileHole] = useState(1);
  const [selectedPlayerId, setSelectedPlayerId] = useState('');
  const swipeStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slide, setSlide] = useState<{ from: string; to: string; dir: number; progress: number; settling: boolean } | null>(null);
  const slideRef = useRef<typeof slide>(null);
  function updateSlide(value: typeof slide) { slideRef.current = value; setSlide(value); }
  useEffect(() => () => { if (animationTimer.current) clearTimeout(animationTimer.current); }, []);
  const [desktopPlayerId, setDesktopPlayerId] = useState('');
  const [mobileView, setMobileView] = useState<'hole' | 'card'>('hole');
  const [showEarlyFinish, setShowEarlyFinish] = useState(false);
  const [earlyReason, setEarlyReason] = useState('Zranění');
  const [earlyNote, setEarlyNote] = useState('');

  const load = useCallback(async () => {
    const client = supabase();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) { router.replace('/login'); return; }
    setUserId(user.id);
    const { data: g, error: ge } = await client.from('games')
      .select('id,name,organizer_id,play_date,status,scoring,holes_count,tee_id,course_id')
      .eq('id', id).single();
    if (ge) throw ge;
    setGame(g as Game);

    const [h, t, p] = await Promise.all([
      client.from('holes').select('hole_number,par,stroke_index,length_m').eq('tee_id', g.tee_id).order('hole_number'),
      client.from('course_tees').select('id,name,course_rating,slope_rating,par_total').eq('course_id', g.course_id),
      client.from('game_players').select('id,player_id,handicap_snapshot,flight_number,finished_at,finish_reason,finish_note,tee_id').eq('game_id', id).order('flight_number'),
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
    // Profilové fotografie jsou uložené v Supabase Storage (avatars/{userId}/avatar.ext).
    // Není nutná změna databázového schématu. Pokud výpis není povolen, použijeme iniciálu.
    const avatarEntries = await Promise.all(playerIds.map(async playerId => {
      if (playerId === user.id && user.user_metadata?.avatar_url) {
        return [playerId, String(user.user_metadata.avatar_url)] as const;
      }
      const { data: files, error: listError } = await client.storage.from('avatars').list(playerId, { limit: 20 });
      if (listError) return [playerId, ''] as const;
      const avatarFile = (files || []).find(file => /^avatar\.(jpg|jpeg|png|webp)$/i.test(file.name));
      if (!avatarFile) return [playerId, ''] as const;
      const { data: publicData } = client.storage.from('avatars').getPublicUrl(`${playerId}/${avatarFile.name}`);
      return [playerId, publicData.publicUrl] as const;
    }));
    setPlayerAvatars(Object.fromEntries(avatarEntries));
    const grouped: Record<string, Record<number, Score>> = {};
    for (const score of (scoreResult.data || []) as Score[]) {
      if (!grouped[score.game_player_id]) grouped[score.game_player_id] = {};
      grouped[score.game_player_id][score.hole_number] = score;
    }
    setScores(grouped);
    setLastRefresh(new Date().toLocaleTimeString('cs-CZ'));
    setHoles((h.data || []) as Hole[]);
    const teeIds = [...new Set([g.tee_id, ...participants.map(player => player.tee_id || g.tee_id)])];
    const { data: allHoleRows, error: allHolesError } = await client.from('holes')
      .select('tee_id,hole_number,par,stroke_index,length_m').in('tee_id', teeIds).order('hole_number');
    if (allHolesError) throw allHolesError;
    const byTee: Record<string, Hole[]> = {};
    for (const row of allHoleRows || []) {
      if (!byTee[row.tee_id]) byTee[row.tee_id] = [];
      byTee[row.tee_id].push({ hole_number: row.hole_number, par: row.par, stroke_index: row.stroke_index, length_m: row.length_m });
    }
    setTeeHoles(byTee);
    setRatings(Object.fromEntries(((t.data || []) as Rating[]).map(item => [item.id, item])));
  }, [id, router]);

  useEffect(() => { load().catch(e => setError(e instanceof Error ? e.message : String(e))); }, [load]);

  // Načítáme pouze průběžná skóre a stav dokončení; ostatní formulářová data se nemění.
  const refreshResults = useCallback(async () => {
    if (savingRef.current || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const client = supabase();
      const { data: participants, error: pe } = await client.from('game_players')
        .select('id,player_id,finished_at,finish_reason,finish_note').eq('game_id', id);
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
        return latest ? { ...member, finished_at: latest.finished_at, finish_reason: latest.finish_reason, finish_note: latest.finish_note } : member;
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
  function memberTeeId(member: Member): string { return member.tee_id || game?.tee_id || ''; }
  function memberHoles(member: Member): Hole[] { return teeHoles[memberTeeId(member)] || []; }
  function memberHole(member: Member, number: number): Hole | undefined {
    return memberHoles(member).find(h => h.hole_number === number);
  }
  function teeName(member: Member): string { return ratings[memberTeeId(member)]?.name || 'Odpaliště'; }
  const myMember = members.find(member => member.player_id === userId);
  const activeHole = visible.find(h => h.hole_number === mobileHole) || visible[0];
  const desktopMember = members.find(member => member.id === desktopPlayerId) || myMember;
  const selectedMember = members.find(member => member.id === selectedPlayerId) || myMember || members[0];
  // Stejne jemne barvy jako sloupce hracu ve spolecne scorekarte.
  const playerColors = [
    { light: '#e4f2e8', strong: '#cce5d3', text: '#174a32', border: '#9dc6aa' },
    { light: '#e7efff', strong: '#d0dffc', text: '#173d68', border: '#a7bee8' },
    { light: '#fff1dc', strong: '#f9dfb6', text: '#76440b', border: '#e5c48f' },
    { light: '#f1e8f8', strong: '#e4d5f1', text: '#503070', border: '#cbb3df' },
  ];
  const ownCompletedCount = myMember ? visible.filter(h => Boolean(scores[myMember.id]?.[h.hole_number])).length : 0;
  function animatePlayer(targetId: string, direction?: number) {
    if (busy || slideRef.current || !selectedMember || targetId === selectedMember.id) return;
    const fromIndex = members.findIndex(member => member.id === selectedMember.id);
    const toIndex = members.findIndex(member => member.id === targetId);
    if (toIndex < 0) return;
    const dir = direction ?? (toIndex > fromIndex ? 1 : -1);
    updateSlide({ from: selectedMember.id, to: targetId, dir, progress: 0, settling: false });
    requestAnimationFrame(() => requestAnimationFrame(() => finishSlide(true)));
  }

  function finishSlide(commit: boolean) {
    const current = slideRef.current;
    if (!current) return;
    updateSlide({ ...current, progress: commit ? 1 : 0, settling: true });
    if (animationTimer.current) clearTimeout(animationTimer.current);
    animationTimer.current = setTimeout(() => {
      if (commit) setSelectedPlayerId(current.to);
      updateSlide(null);
    }, 280);
  }

  function onScoreTouchStart(e: TouchEvent<HTMLElement>) {
    if (e.touches.length !== 1 || slideRef.current || busy) { swipeStart.current = null; return; }
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
  }

  function onScoreTouchMove(e: TouchEvent<HTMLElement>) {
    const start = swipeStart.current;
    if (!start || e.touches.length !== 1 || members.length < 2 || !selectedMember) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;
    if (Math.abs(dy) > Math.abs(dx) && !slideRef.current) return;
    if (Math.abs(dx) < 8 && !slideRef.current) return;
    const dir = dx < 0 ? 1 : -1;
    const index = members.findIndex(member => member.id === selectedMember.id);
    const next = members[(index + dir + members.length) % members.length];
    const width = Math.max(1, e.currentTarget.clientWidth);
    const progress = Math.min(1, Math.abs(dx) / width);
    const existing = slideRef.current;
    if (existing?.settling) return;
    updateSlide({ from: selectedMember.id, to: next.id, dir, progress, settling: false });
  }

  function onScoreTouchEnd(e: TouchEvent<HTMLElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    const current = slideRef.current;
    if (!start || !current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    const elapsed = Date.now() - start.time;
    finishSlide(Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 1.15 && elapsed < 2000);
  }

  function playingHandicap(member: Member): number | null {
    const rating = ratings[memberTeeId(member)];
    const ownHoles = memberHoles(member);
    if (member.handicap_snapshot === null || rating?.course_rating == null || rating?.slope_rating == null || ownHoles.length !== 18) return null;
    const par = ownHoles.reduce((sum, h) => sum + h.par, 0);
    return Math.round(Number(member.handicap_snapshot) * rating.slope_rating / 113 + rating.course_rating - par);
  }
  function points(member: Member, hole: Hole): number | null {
    const score = scores[member.id]?.[hole.hole_number];
    if (!score) return null;
    if (score.picked_up) return 0;
    const ch = playingHandicap(member);
    if (ch === null || expected !== 18 || score.strokes === null) return null;
    const ownHole = memberHole(member, hole.hole_number);
    if (!ownHole) return null;
    const extra = Math.floor(ch / 18) + (ownHole.stroke_index <= ((ch % 18) + 18) % 18 ? 1 : 0);
    return Math.max(0, 2 + ownHole.par + extra - score.strokes);
  }
  // Tradiční golfové značení ran vzhledem k PAR konkrétního hráče.
  function scoreMark(member: Member, hole: Hole) {
    const score = scores[member.id]?.[hole.hole_number];
    if (!score || score.picked_up || score.strokes == null) return null;
    const par = memberHole(member, hole.hole_number)?.par ?? hole.par;
    const difference = score.strokes - par;
    const label = difference <= -3 ? 'Albatros nebo lepší' :
      difference === -2 ? 'Eagle' :
      difference === -1 ? 'Birdie' :
      difference === 0 ? 'Par' :
      difference === 1 ? 'Bogey' :
      difference === 2 ? 'Double bogey' : 'Triple bogey nebo horší';
    const kind = difference <= -3 ? 'albatross' :
      difference === -2 ? 'eagle' :
      difference === -1 ? 'birdie' :
      difference === 0 ? 'par' :
      difference === 1 ? 'bogey' :
      difference === 2 ? 'double-bogey' : 'triple-bogey';
    return <span className={`golf-score-mark golf-score-${kind}`} title={`${label} (${difference > 0 ? '+' : ''}${difference} vůči PAR ${par})`} aria-label={`${score.strokes} ran, ${label}`}>
      {score.strokes}
    </span>;
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

  async function save(hole: number, value: string, target: Member | undefined = selectedMember) {
    if (!game || !myMember || myMember.finished_at || !target || target.finished_at || busy || visible.length !== expected) return;
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
        const { error: e } = await client.from('scores').delete().eq('game_player_id', target.id).eq('hole_number', hole);
        if (e) throw e;
        setScores(prev => { const next = { ...prev, [target.id]: { ...(prev[target.id] || {}) } }; delete next[target.id][hole]; return next; });
      } else {
        const { error: e } = await client.from('scores').upsert({ game_id: id, game_player_id: target.id, hole_number: hole, strokes, picked_up, updated_at: new Date().toISOString() }, { onConflict: 'game_player_id,hole_number' });
        if (e) throw e;
        setScores(prev => ({ ...prev, [target.id]: { ...(prev[target.id] || {}), [hole]: { game_player_id: target.id, hole_number: hole, strokes, picked_up } } }));
      }
      setNotice('Skóre uloženo.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  }

  const earlyReasons = ['Zranění', 'Diskvalifikace', 'Odstoupení ze hry', 'Nepříznivé počasí', 'Jiný důvod'];
  function finishLabel(member: Member) {
    return member.finish_reason ? `Předčasně ukončeno – ${member.finish_reason}` : 'Dokončeno';
  }
  function rankingMembers() {
    return members.filter(member => !member.finish_reason);
  }
  async function finishEarly() {
    if (!myMember || myMember.finished_at || busy || !earlyReason) return;
    if (earlyReason === 'Jiný důvod' && !earlyNote.trim()) {
      setError('U jiného důvodu prosím vyplň poznámku.');
      return;
    }
    if (!window.confirm('Opravdu předčasně ukončit svou účast? Skóre zůstane uložené, ale nebudeš v pořadí. Tento krok nelze vrátit.')) return;
    savingRef.current = true;
    setBusy(true);
    setError('');
    try {
      const finishedAt = new Date().toISOString();
      const { data, error: e } = await supabase().from('game_players')
        .update({ finished_at: finishedAt, finish_reason: earlyReason, finish_note: earlyNote.trim() || null })
        .eq('id', myMember.id).eq('player_id', userId).is('finished_at', null)
        .select('id,finished_at,finish_reason,finish_note');
      if (e) throw e;
      if (!data?.length) throw new Error('Účast již byla ukončena. Obnov stránku.');
      setMembers(prev => prev.map(member => member.id === myMember.id ? { ...member, finished_at: finishedAt, finish_reason: earlyReason, finish_note: earlyNote.trim() || null } : member));
      router.replace('/history');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }
  function earlyFinishControls() {
    if (!myMember || myMember.finished_at) return null;
    return <div style={{ marginTop: 16, borderTop: '1px solid #d8e3da', paddingTop: 14 }}>
      {!showEarlyFinish ? <button type="button" className="btn secondary" disabled={busy} onClick={() => setShowEarlyFinish(true)}>Předčasně ukončit hru</button> :
      <div style={{ display: 'grid', gap: 10 }}>
        <strong>Předčasné ukončení účasti</strong>
        <label style={{ display: 'grid', gap: 5 }}>Důvod
          <select value={earlyReason} onChange={e => setEarlyReason(e.target.value)} disabled={busy} style={{ width: '100%', padding: 10, borderRadius: 9, background: '#fff', color: '#123d2b' }}>
            {earlyReasons.map(reason => <option key={reason} value={reason}>{reason}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5 }}>Poznámka {earlyReason === 'Jiný důvod' ? '(povinná)' : '(nepovinná)'}
          <textarea value={earlyNote} onChange={e => setEarlyNote(e.target.value)} maxLength={500} rows={2} disabled={busy} style={{ width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 9, background: '#fff', color: '#123d2b' }} />
        </label>
        <p style={{ margin: 0, fontSize: 12 }}>Dosavadní skóre zůstane uložené. Ostatní hráči pokračují dál.</p>
        <button type="button" className="btn secondary" disabled={busy || (earlyReason === 'Jiný důvod' && !earlyNote.trim())} onClick={() => void finishEarly()}>Potvrdit předčasné ukončení</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => { setShowEarlyFinish(false); setError(''); }}>Zrušit</button>
      </div>}
    </div>;
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
       router.replace('/history');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { savingRef.current = false; setBusy(false); }
  }

  // Průběžné skóre vůči PAR: pouze jamky se známým počtem ran.
  // Zvednutý míč (X) znamená, že přesný celkový rozdíl nelze určit.
  function scoreToPar(member: Member): { value: number | null; hasPickedUp: boolean } {
    let strokes = 0;
    let par = 0;
    let recorded = 0;
    for (const hole of visible) {
      const score = scores[member.id]?.[hole.hole_number];
      if (!score) continue;
      if (score.picked_up) return { value: null, hasPickedUp: true };
      if (score.strokes == null) continue;
      const ownPar = memberHole(member, hole.hole_number)?.par ?? hole.par;
      strokes += score.strokes;
      par += ownPar;
      recorded++;
    }
    return { value: recorded > 0 ? strokes - par : null, hasPickedUp: false };
  }

  function renderPlayerCard(cardMember: Member, animatedStyle?: { transform: string; transition: string; position?: 'absolute' | 'relative' }) {
    const cardIndex = Math.max(0, members.findIndex(member => member.id === cardMember.id));
    const colors = playerColors[cardIndex % playerColors.length];
    const cardScore = activeHole ? scores[cardMember.id]?.[activeHole.hole_number] : undefined;
    const cardCompleted = visible.filter(h => Boolean(scores[cardMember.id]?.[h.hole_number])).length;
    const relativePar = scoreToPar(cardMember);
    const parLabel = relativePar.hasPickedUp ? "—" : relativePar.value === null ? "—" : relativePar.value === 0 ? "E" : relativePar.value > 0 ? `+${relativePar.value}` : String(relativePar.value);
    const parColor = relativePar.value === null ? "#64776e" : relativePar.value > 0 ? "#b91c1c" : relativePar.value < 0 ? "#167a4b" : "#123d2b";
    return <div key={cardMember.id} className="mobile-card swipe-player-area" style={{ background: colors.light, border: `2px solid ${colors.border}`, margin: 0, width: '100%', boxSizing: 'border-box', position: animatedStyle?.position || 'relative', inset: animatedStyle?.position === 'absolute' ? 0 : undefined, transform: animatedStyle?.transform, transition: animatedStyle?.transition, willChange: 'transform' }}>
          <div className="mobile-nav">
            <strong>Jamka {activeHole?.hole_number ?? '–'} / {expected}</strong>
            <span className="mobile-sub">{cardCompleted} z {expected} zapsáno</span>
          </div>
          {cardMember?.finished_at && <p className="mobile-sub" style={{ color: '#8a6034', fontWeight: 700 }}>Hráč již ukončil hru – skóre je pouze ke čtení.</p>}
          {activeHole && <>
            <p className="mobile-sub">{cardMember ? teeName(cardMember) : ''} · PAR {cardMember ? memberHole(cardMember, activeHole.hole_number)?.par ?? activeHole.par : activeHole.par} · SI {cardMember ? memberHole(cardMember, activeHole.hole_number)?.stroke_index ?? activeHole.stroke_index : activeHole.stroke_index}{(cardMember ? memberHole(cardMember, activeHole.hole_number)?.length_m : activeHole.length_m) != null ? ` · ${cardMember ? memberHole(cardMember, activeHole.hole_number)?.length_m : activeHole.length_m} m` : ''}</p>
            <div className="mobile-nav" style={{ marginTop: 7 }}>
              <div className="mobile-player-identity">
                {playerAvatars[cardMember.player_id] && !failedAvatars[cardMember.player_id] ?
                  <img className="mobile-player-avatar" src={playerAvatars[cardMember.player_id]} alt={`Avatar hráče ${cardMember.nickname}`} onError={() => setFailedAvatars(prev => ({ ...prev, [cardMember.player_id]: true }))} /> :
                  <span className="mobile-player-avatar mobile-player-avatar-fallback" aria-hidden="true">{cardMember.nickname.trim().charAt(0).toUpperCase() || '⛳'}</span>}
                <div className="mobile-player-details"><strong>{cardMember.nickname || 'Moje skóre'}</strong><div className="mobile-sub">Herní HCP {playingHandicap(cardMember) ?? '–'}</div></div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 112 }}>
                <div className="mobile-sub" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Skóre vůči PAR</div>
                <div style={{ color: parColor, fontSize: 30, lineHeight: 1.15, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }} aria-label={`Skóre vůči PAR ${parLabel}`}>{parLabel}</div>
                <div style={{ borderTop: '1px solid rgba(18,61,43,.14)', margin: '7px 0 5px' }} />
                <strong>{cardMember ? totalPoints(cardMember) ?? '–' : '–'}</strong>
                <div className="mobile-sub">Celkem bodů</div>
              </div>
            </div>
            <div className="mobile-stepper">
              <button type="button" aria-label="Odebrat ránu" disabled={!myMember || Boolean(myMember.finished_at) || !cardMember || Boolean(cardMember.finished_at) || busy || visible.length !== expected || !cardScore?.strokes || cardScore.strokes <= 1} onClick={() => void save(activeHole.hole_number, String((cardScore?.strokes || 1) - 1), cardMember)}>−</button>
              <div><div className="mobile-number">{cardScore?.picked_up ? 'X' : cardScore?.strokes ?? '–'}</div><div className="mobile-sub" style={{ textAlign: 'center' }}>RÁNY</div></div>
              <button type="button" aria-label="Přidat ránu" disabled={!myMember || Boolean(myMember.finished_at) || !cardMember || Boolean(cardMember.finished_at) || busy || visible.length !== expected || (cardScore?.strokes ?? 0) >= 30} onClick={() => void save(activeHole.hole_number, String(cardScore?.strokes ? cardScore.strokes + 1 : 1), cardMember)}>+</button>
            </div>
            {game?.scoring === 'stableford' && <div className="mobile-pill"><strong style={{ fontSize: 25 }}>{cardMember ? points(cardMember, activeHole) ?? '–' : '–'} {cardMember && points(cardMember, activeHole) === 1 ? 'bod' : 'body'}</strong><div className="mobile-sub">Stableford za jamku</div></div>}
            <div className="mobile-minor-actions">
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || !cardMember || Boolean(cardMember.finished_at) || busy || visible.length !== expected} onClick={() => void save(activeHole.hole_number, 'X', cardMember)}>Zvednutý míč (X)</button>
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || !cardMember || Boolean(cardMember.finished_at) || busy || visible.length !== expected || !cardScore} onClick={() => void save(activeHole.hole_number, '', cardMember)}>Smazat skóre</button>
            </div>
            <div className="mobile-nav" style={{ marginTop: 8 }}>
              <button type="button" disabled={activeHole.hole_number <= 1} onClick={() => setMobileHole(Math.max(1, activeHole.hole_number - 1))}>← Předchozí</button>
              <button type="button" className="mobile-nav-next" disabled={activeHole.hole_number >= expected} onClick={() => setMobileHole(Math.min(expected, activeHole.hole_number + 1))}>Další →</button>
            </div>
          </>}
    </div>;
  }

  return <main>
    <style>{`
      /* Golfové symboly: zelené kruhy pod PAR, červené čtverce nad PAR. */
      .golf-score-mark {
        display: inline-flex; align-items: center; justify-content: center;
        width: 25px; height: 25px; box-sizing: border-box;
        font-weight: 800; font-size: 13px; line-height: 1;
        color: #163c2b; vertical-align: middle; background: #fff;
      }
      .golf-score-birdie, .golf-score-eagle, .golf-score-albatross {
        border: 2px solid #16834b; border-radius: 50%;
        color: #11633a; background: #e9f7ee;
      }
      .golf-score-eagle {
        outline: 2px solid #16834b; outline-offset: 2px;
      }
      .golf-score-albatross {
        outline: 2px solid #16834b; outline-offset: 2px;
        box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 4px #16834b;
      }
      .golf-score-par { background: transparent; color: inherit; }
      .golf-score-bogey, .golf-score-double-bogey, .golf-score-triple-bogey {
        border: 2px solid #c43232; border-radius: 2px;
        color: #a92323; background: #fff0f0;
      }
      .golf-score-double-bogey {
        outline: 2px solid #c43232; outline-offset: 2px;
      }
      .golf-score-triple-bogey {
        outline: 2px solid #a92323; outline-offset: 2px;
        box-shadow: inset 0 0 0 2px #fff, inset 0 0 0 4px #a92323;
      }
      @media (max-width: 700px) {
        .mobile-score-table .golf-score-mark { width: 19px; height: 19px; font-size: 11px; border-width: 1.5px; }
        .mobile-score-table .golf-score-eagle,
        .mobile-score-table .golf-score-albatross,
        .mobile-score-table .golf-score-double-bogey,
        .mobile-score-table .golf-score-triple-bogey { outline-width: 1px; outline-offset: 1px; }
      }
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
        .golf-mobile .mobile-view-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
        .golf-mobile .mobile-view-switch button { padding: 10px 5px; border: 1px solid #c8d8ce; border-radius: 10px; background: #f1f6f2; color: #123d2b; font-weight: 700; font-size: 13px; }
        .golf-mobile .mobile-view-switch button.selected { background: #103e2c; color: #fff; }
        .golf-mobile .mobile-minor-actions { display: flex; justify-content: center; gap: 8px; margin-top: 8px; }
        .golf-mobile .mobile-minor-actions button { flex: 0 1 auto; min-height: 34px; padding: 6px 10px; font-size: 11px; font-weight: 500; background: #f5f8f5; color: #547163; border: 1px solid #d8e3da; border-radius: 8px; }
        .golf-mobile .mobile-minor-actions button:disabled { opacity: .4; }
        .golf-mobile .mobile-card { padding: 11px 12px; margin: 7px 0; }
        .golf-mobile .mobile-player-identity { display: flex; align-items: center; gap: 11px; min-width: 0; flex: 1; }
        .golf-mobile .mobile-player-avatar { width: 56px; height: 56px; flex: 0 0 56px; border-radius: 50%; object-fit: cover; border: 2px solid #b9cfbf; background: #e6f1df; }
        .golf-mobile .mobile-player-avatar-fallback { display: grid; place-items: center; box-sizing: border-box; font-size: 24px; font-weight: 800; color: #174a32; }
        .golf-mobile .mobile-player-details { min-width: 0; overflow-wrap: anywhere; }
        .golf-mobile .mobile-player-details strong { font-size: 17px; }
        .golf-mobile .mobile-stepper { padding: 14px 0 10px; gap: 22px; }
        .golf-mobile .mobile-stepper button { height: 64px; width: 64px; border-radius: 15px; font-size: 36px; box-shadow: 0 4px 10px rgba(16,62,44,.15); touch-action: manipulation; }
        .golf-mobile .mobile-number { font-size: 54px; line-height: 1.05; min-width: 70px; }
        .golf-mobile .mobile-stepper .mobile-sub { margin-top: 5px; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
        .golf-mobile .mobile-pill { padding: 13px 8px; background: #e0eee3; }
        .golf-mobile .mobile-pill strong { color: #174a32; }
        .golf-mobile .mobile-nav-next { background: #174a32 !important; color: #fff !important; border-color: #174a32 !important; }
        .golf-mobile .mobile-nav-next:disabled { opacity: .45; }
        /* Swipe is clipped strictly to the score-entry tile, never the whole page. */
        .golf-mobile .player-slide-viewport { position: relative; width: 100%; max-width: 100%; overflow: hidden; border-radius: 15px; touch-action: pan-y; overscroll-behavior-x: contain; isolation: isolate; }
        .golf-mobile .swipe-player-area { touch-action: pan-y; overscroll-behavior-x: contain; }
        .golf-mobile .flight-player-strip { display: flex; gap: 7px; overflow-x: auto; padding: 3px 0 10px; scrollbar-width: thin; }
        .golf-mobile .flight-player-strip button { flex: 1 0 0; min-width: 64px; border: 1px solid #d0dfd3; border-radius: 12px; background: #e9f1ea; color: #234b35; padding: 9px 4px; font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .golf-mobile .flight-player-strip button.selected { background: #174a32; color: white; border-color: #174a32; }
        .golf-mobile .flight-player-strip button.finished { opacity: .55; }
        .golf-mobile .flight-player-strip button:disabled { opacity: .55; }
        .golf-mobile .mobile-card:first-child > .mobile-nav:first-child strong { font-size: 20px; }
        .golf-mobile .mobile-pill { padding: 5px; }
        /* Kompaktni scorekarta: az ctyri hraci bez vodorovneho posouvani. */
        .golf-mobile .mobile-score-scroll { width: 100%; overflow-x: hidden; }
        .golf-mobile .mobile-score-table { border-collapse: collapse; table-layout: fixed; width: 100%; min-width: 0; font-size: clamp(8px, 2.4vw, 11px); font-variant-numeric: tabular-nums; }
        .golf-mobile .mobile-score-table th, .golf-mobile .mobile-score-table td { box-sizing: border-box; padding: 7px 1px; text-align: center; border-bottom: 1px solid #e1e9e3; white-space: nowrap; overflow: hidden; }
        .golf-mobile .mobile-score-table thead th { background: #edf4ee; font-weight: 700; }
        .golf-mobile .mobile-score-table .player-name { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: clamp(8px, 2.3vw, 11px); }
        .golf-mobile .mobile-score-table .my-score { background: #e5f0e8; }
        .golf-mobile .mobile-score-table select { display: block; width: 100%; min-width: 0; max-width: none; height: 28px; padding: 0; margin: 0; border: 1px solid #c8d8ce; border-radius: 4px; background: #fff; color: #123d2b; font-size: 12px; text-align: center; text-align-last: center; appearance: none; -webkit-appearance: none; }
        .golf-mobile .mobile-score-table tfoot th { font-weight: 800; border-top: 2px solid #c8d8ce; }
        .golf-mobile .mobile-score-table .base-col { width: 10%; }
        .golf-mobile .mobile-score-table .player-group-0 { background: #e4f2e8; }
        .golf-mobile .mobile-score-table .player-group-1 { background: #e7efff; }
        .golf-mobile .mobile-score-table .player-group-2 { background: #fff1dc; }
        .golf-mobile .mobile-score-table .player-group-3 { background: #f1e8f8; }
        .golf-mobile .mobile-score-table .player-start { border-left: 2px solid #91a99b; }
        .golf-mobile .mobile-score-table thead .player-group-0 { background: #cce5d3; }
        .golf-mobile .mobile-score-table thead .player-group-1 { background: #d0dffc; }
        .golf-mobile .mobile-score-table thead .player-group-2 { background: #f9dfb6; }
        .golf-mobile .mobile-score-table thead .player-group-3 { background: #e4d5f1; }
        .golf-mobile .mobile-score-table .my-score { font-weight: 700; box-shadow: inset 0 0 0 1px #81a995; }
        .golf-mobile .mobile-score-table .player-name { font-size: clamp(7px, 2.2vw, 11px); }
        .golf-mobile .mobile-score-table select { font-size: 11px; }
        .golf-mobile .mobile-score-table .player-col { width: auto; }

        /* Read-only scorecard: each player's strokes and points form one color family. */
        .score-table .stroke-value, .mobile-score-table .stroke-value { font-weight: 800 !important; box-shadow: none !important; border-radius: 0 !important; outline: none !important; }
        .score-table .point-value, .mobile-score-table .point-value { font-weight: 400 !important; box-shadow: none !important; }
        .score-table .player-group-0.stroke-value, .mobile-score-table .player-group-0.stroke-value { background: #d6eadc; color: #133e2b; }
        .score-table .player-group-0.point-value, .mobile-score-table .player-group-0.point-value { background: #e9f5ec; color: #326d50; }
        .score-table .player-group-1.stroke-value, .mobile-score-table .player-group-1.stroke-value { background: #d5e4fa; color: #173d68; }
        .score-table .player-group-1.point-value, .mobile-score-table .player-group-1.point-value { background: #edf4ff; color: #36618d; }
        .score-table .player-group-2.stroke-value, .mobile-score-table .player-group-2.stroke-value { background: #f9e2bb; color: #76440b; }
        .score-table .player-group-2.point-value, .mobile-score-table .player-group-2.point-value { background: #fff2dd; color: #936b2d; }
        .score-table .player-group-3.stroke-value, .mobile-score-table .player-group-3.stroke-value { background: #e4d4f5; color: #503070; }
        .score-table .player-group-3.point-value, .mobile-score-table .player-group-3.point-value { background: #f2eafb; color: #75568d; }
        .score-table .player-start, .mobile-score-table .player-start { border-left: 2px solid #91a99b; }
        .mobile-score-table td.stroke-value { border: 0; border-bottom: 1px solid #dce7df; }
        .mobile-score-table td.point-value { border-bottom: 1px solid #dce7df; }


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
          {member.nickname}{member.player_id === userId ? ' (já)' : ''} · {teeName(member)} · HCP {member.handicap_snapshot ?? '–'}
          {playingHandicap(member) !== null ? ` · Herní HCP ${playingHandicap(member)}` : ''}
          {member.finished_at ? ` · ${finishLabel(member)}` : ''}
        </div>)}
        <p className="muted">Výsledky se automaticky aktualizují každých 5 sekund, když je stránka otevřená. {lastRefresh && `Poslední aktualizace: ${lastRefresh}`}</p>
        <button type="button" className="btn secondary" onClick={() => void refreshResults()}>Aktualizovat výsledky</button>
      </div>
      <div className="panel golf-desktop">
        <h2>Společná scorekarta flightu</h2>
        <p className="muted">Všichni hráči na jedné scorekartě. Přehled výsledků všech hráčů bez možnosti úprav. Rány zapisuj pouze ve své scorekartě.</p>
        {visible.length !== expected && <p className="error">Hřiště nemá všech {expected} jamek. Zápis není dostupný.</p>}
        <div className="score-scroll" style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table className="score-table" style={{ minWidth: 290 + members.length * (game.scoring === 'stableford' ? 145 : 85) }}>
            <thead>
              <tr>
                <th rowSpan={2}>Jamka</th><th rowSpan={2}>PAR</th>
                {members.map((member, index) => <th key={member.id} className={`player-group-${index} player-start`} colSpan={game.scoring === 'stableford' ? 2 : 1} scope="colgroup" style={{ textAlign: 'center' }}>
                  {member.nickname}{member.player_id === userId ? ' (já)' : ''}
                  <div style={{ fontSize: '0.8em', fontWeight: 400 }}>HCP {member.handicap_snapshot ?? '–'}{playingHandicap(member) !== null ? ` · Herní ${playingHandicap(member)}` : ''}</div>
                </th>)}
              </tr>
              <tr>{members.map((member, index) => <Fragment key={member.id}><th className={`player-group-${index} player-start stroke-value`} title="Rány">R</th>{game.scoring === 'stableford' && <th className={`player-group-${index} point-value`} title="Body">B</th>}</Fragment>)}</tr>
            </thead>
            <tbody>
              {visible.map(hole => <tr key={hole.hole_number}>
                <th scope="row">{hole.hole_number}</th><td>{hole.par}</td>
                {members.map((member, index) => {
                  const score = scores[member.id]?.[hole.hole_number];
                  return <Fragment key={member.id}>
                    <td className={`player-group-${index} player-start stroke-value`}>
                      {scoreMark(member, hole) ?? (score?.picked_up ? 'X' : '–')}
                    </td>
                    {game.scoring === 'stableford' && <td className={`player-group-${index} point-value`}>{points(member, hole) ?? '–'}</td>}
                  </Fragment>;
                })}
              </tr>)}
            </tbody>
            <tfoot><tr>
              <th>Celkem</th><th>{visible.reduce((sum, hole) => sum + hole.par, 0)}</th>
              {members.map((member, index) => <Fragment key={member.id}><th className={`player-group-${index} player-start stroke-value`}>{totalStrokes(member)}</th>{game.scoring === 'stableford' && <th className={`player-group-${index} point-value`}>{totalPoints(member) ?? '–'}</th>}</Fragment>)}
            </tr></tfoot>
          </table>
        </div>
        {game.scoring === 'stableford' && expected !== 18 && <p className="muted">Stableford body jsou v této verzi dostupné pouze pro 18 jamek.</p>}
      </div>
      {myMember && <div className="panel golf-desktop">
        <h2>Zápis ran hráčů ve flightu</h2>
        <label>Hráč: <select value={desktopMember?.id || ''} onChange={e => setDesktopPlayerId(e.target.value)} style={{ padding: 8, marginBottom: 12, color: '#123d2b', background: '#fff' }}>
          {members.map(member => <option key={member.id} value={member.id}>{member.nickname}{member.finished_at ? ' (dokončeno)' : ''}</option>)}
        </select></label>
        <p className="muted">Rány může zapsat každý aktivní hráč flightu. Dokončení hry potvrzuje každý pouze za sebe.</p>
        <div className="score-scroll" style={{ overflowX: 'auto' }}><table className="score-table">
          <thead><tr><th>Jamka</th><th>PAR</th><th>Rány</th>{game.scoring === 'stableford' && <th>Body</th>}</tr></thead>
          <tbody>{visible.map(hole => {
            const score = scores[desktopMember?.id || myMember.id]?.[hole.hole_number];
            return <tr key={hole.hole_number}><th>{hole.hole_number}</th><td>{hole.par}</td><td>
              <select aria-label={`Moje rány, jamka ${hole.hole_number}`} disabled={busy || Boolean(myMember.finished_at) || Boolean(desktopMember?.finished_at) || visible.length !== expected} value={score?.picked_up ? 'X' : score?.strokes ?? ''} onChange={e => void save(hole.hole_number, e.target.value, desktopMember)}>
                <option value="">–</option>
                {Array.from({ length: 30 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                <option value="X">X</option>
              </select>
            </td>{game.scoring === 'stableford' && <td>{desktopMember ? (points(desktopMember, hole) ?? '–') : '–'}</td>}</tr>;
          })}</tbody>
        </table></div>
      </div>}
      {myMember && <div className="panel golf-desktop">
        <h2>Dokončení hry</h2>
        {myMember.finished_at ? <p className="success">{finishLabel(myMember)}{myMember.finish_note ? ` · ${myMember.finish_note}` : ''}</p> :
          <button className="btn secondary" disabled={busy || !complete(myMember)} onClick={finish}>Potvrdit dokončení hry</button>}
        {earlyFinishControls()}
      </div>}
      <div className="panel golf-desktop">
        <h2>Průběžné výsledky</h2>
        {members.some(m => m.finish_reason) && <p className="muted">Předčasně ukončení hráči nejsou v pořadí: {members.filter(m => m.finish_reason).map(m => `${m.nickname} (${m.finish_reason})`).join(', ')}</p>}
        <div className="score-scroll"><table className="score-table">
          <thead><tr><th>Hráč</th><th>HCP</th><th>Rány</th>{game.scoring === 'stableford' && <th>Body</th>}</tr></thead>
          <tbody>{rankingMembers().sort((a, b) => game.scoring === 'stableford' ? (totalPoints(b) ?? -1) - (totalPoints(a) ?? -1) : totalStrokes(a) - totalStrokes(b)).map(member =>
            <tr key={member.id}><td>{member.nickname}</td><td>{member.handicap_snapshot ?? '–'}</td><td>{totalStrokes(member)}</td>
              {game.scoring === 'stableford' && <td>{totalPoints(member) ?? '–'}</td>}</tr>)}</tbody>
        </table></div>
        <p className="muted">Pořadí je průběžné. Nula ran může znamenat, že hráč ještě nezapsal výsledek. Výsledky ostatních hráčů se načítají automaticky každých 5 sekund.</p>
      </div>
      <section className="golf-mobile" aria-label="Mobilní scorekarta">
        <div className="mobile-view-switch" role="group" aria-label="Zobrazení scorekarty">
          <button type="button" className={mobileView === 'hole' ? 'selected' : ''} aria-pressed={mobileView === 'hole'} onClick={() => setMobileView('hole')}>Aktuální jamka</button>
          <button type="button" className={mobileView === 'card' ? 'selected' : ''} aria-pressed={mobileView === 'card'} onClick={() => setMobileView('card')}>Celá scorekarta</button>
        </div>
        {mobileView === 'hole' ? <>
        <div className="flight-player-strip" role="group" aria-label="Vybrat hráče pro zápis skóre">
          {members.map((member, index) => <button key={member.id} type="button" className={`${selectedMember?.id === member.id ? 'selected' : ''} ${member.finished_at ? 'finished' : ''}`} style={{ background: selectedMember?.id === member.id ? playerColors[index % playerColors.length].strong : playerColors[index % playerColors.length].light, color: playerColors[index % playerColors.length].text, borderColor: selectedMember?.id === member.id ? playerColors[index % playerColors.length].text : playerColors[index % playerColors.length].border }} disabled={busy || Boolean(slide)} aria-pressed={selectedMember?.id === member.id} onClick={() => animatePlayer(member.id)} title={member.finished_at ? 'Hráč dokončil hru – skóre nelze měnit' : member.nickname}>
            {member.nickname}{member.player_id === userId ? ' (já)' : ''}{member.finished_at ? ' ✓' : ''}
          </button>)}
        </div>
        <div className="player-slide-viewport" onTouchStartCapture={onScoreTouchStart} onTouchMoveCapture={onScoreTouchMove} onTouchEndCapture={onScoreTouchEnd} onTouchCancel={() => { swipeStart.current = null; if (slideRef.current) finishSlide(false); }}>
          {slide ? <>
            {members.find(m => m.id === slide.from) && renderPlayerCard(members.find(m => m.id === slide.from)!, { transform: `translateX(${-slide.dir * slide.progress * 100}%)`, transition: slide.settling ? 'transform 270ms cubic-bezier(.2,.7,.2,1)' : 'none', position: 'relative' })}
            {members.find(m => m.id === slide.to) && renderPlayerCard(members.find(m => m.id === slide.to)!, { transform: `translateX(${slide.dir * (1 - slide.progress) * 100}%)`, transition: slide.settling ? 'transform 270ms cubic-bezier(.2,.7,.2,1)' : 'none', position: 'absolute' })}
          </> : selectedMember ? renderPlayerCard(selectedMember) : null}
        </div>
        <div className="mobile-card">
          <h3 style={{ marginTop: 0 }}>Přehled jamek</h3>
          <div className="mobile-holes">{visible.map(h => <button key={h.hole_number} type="button" className={`${mobileHole === h.hole_number ? 'active' : ''} ${selectedMember && scores[selectedMember.id]?.[h.hole_number] ? 'recorded' : ''}`} onClick={() => setMobileHole(h.hole_number)}>{h.hole_number}</button>)}</div>
        </div>
        </> : <div className="mobile-card">
          <h3 style={{ marginTop: 0 }}>Společná scorekarta flightu</h3>
          <p className="mobile-sub">Všech {expected} jamek a všichni hráči pohromadě. Tento přehled je pouze ke čtení. Své rány upravíš v záložce Aktuální jamka.</p>
          <div className="mobile-score-scroll">
            <table className="mobile-score-table">
              <colgroup>
                <col className="base-col" /><col className="base-col" />
                {members.map(member => <Fragment key={member.id}><col className="player-col" />{game.scoring === 'stableford' && <col className="player-col" />}</Fragment>)}
              </colgroup>
              <thead>
                <tr><th rowSpan={2} title="Jamka">J</th><th rowSpan={2}>PAR</th>{members.map((member, index) => <th key={member.id} className={`player-group-${index} player-start`} colSpan={game.scoring === 'stableford' ? 2 : 1} title={member.nickname}><span className="player-name">{member.nickname}{member.player_id === userId ? ' (já)' : ''}</span><span className="player-name" style={{ fontWeight: 400 }}>{teeName(member)}</span></th>)}</tr>
                <tr>{members.map((member, index) => <Fragment key={member.id}><th className={`player-group-${index} player-start stroke-value`} title="Rány">R</th>{game.scoring === 'stableford' && <th className={`player-group-${index} point-value`} title="Body">B</th>}</Fragment>)}</tr>
              </thead>
              <tbody>{visible.map(hole => <tr key={hole.hole_number}>
                <th>{hole.hole_number}</th><td>{hole.par}</td>
                {members.map((member, index) => {
                  const score = scores[member.id]?.[hole.hole_number];
                  return <Fragment key={member.id}>
                    <td className={`player-group-${index} player-start stroke-value`}>
                      {scoreMark(member, hole) ?? (score?.picked_up ? 'X' : '–')}
                    </td>
                    {game.scoring === 'stableford' && <td className={`player-group-${index} point-value`}>{points(member, hole) ?? '–'}</td>}
                  </Fragment>;
                })}
              </tr>)}</tbody>
              <tfoot><tr><th title="Celkem">Σ</th><th>{visible.reduce((sum, hole) => sum + hole.par, 0)}</th>{members.map((member, index) => <Fragment key={member.id}><th className={`player-group-${index} player-start stroke-value`}>{totalStrokes(member)}</th>{game.scoring === 'stableford' && <th className={`player-group-${index} point-value`}>{totalPoints(member) ?? '–'}</th>}</Fragment>)}</tr></tfoot>
            </table>
          </div>
        </div>}
        <div className="mobile-card">
          <h3 style={{ marginTop: 0 }}>Průběžné výsledky</h3>
          {members.some(m => m.finish_reason) && <p className="mobile-sub">Mimo pořadí: {members.filter(m => m.finish_reason).map(m => `${m.nickname} (${m.finish_reason})`).join(', ')}</p>}
          <table className="mobile-rows"><tbody>{rankingMembers().sort((a,b) => game.scoring === 'stableford' ? (totalPoints(b) ?? -1) - (totalPoints(a) ?? -1) : totalStrokes(a) - totalStrokes(b)).map((member,i) => <tr key={member.id}><td>{i+1}. {member.nickname}{member.player_id === userId ? ' (já)' : ''}</td><td>{game.scoring === 'stableford' ? `${totalPoints(member) ?? '–'} b` : `${totalStrokes(member)} ran`}</td></tr>)}</tbody></table>
          <p className="mobile-sub">Aktualizace každých 5 sekund. {lastRefresh && `Naposledy ${lastRefresh}`}</p>
          <button type="button" className="mobile-action" onClick={() => void refreshResults()}>Aktualizovat výsledky</button>
        </div>
        {myMember && <div className="mobile-card"><h3 style={{ marginTop: 0 }}>Dokončení hry</h3>{myMember.finished_at ? <p>{finishLabel(myMember)}{myMember.finish_note ? ` · ${myMember.finish_note}` : ''}</p> : <><p className="mobile-sub">Zapsáno {ownCompletedCount} z {expected} jamek. Hru lze dokončit až po vyplnění všech.</p><button type="button" className="mobile-action" disabled={busy || !complete(myMember)} onClick={() => void finish()}>Potvrdit dokončení hry</button>{earlyFinishControls()}</>}</div>}
      </section>
      {notice && <p className="success" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>}
    <div style={{ marginTop: 22, marginBottom: 12 }}>
      <Link href="/games" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}>
        <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span>
        <span>Zpět na moje hry</span>
      </Link>
    </div>
  </main>;
}
