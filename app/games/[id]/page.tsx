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
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
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
  const activeScore = selectedMember && activeHole ? scores[selectedMember.id]?.[activeHole.hole_number] : undefined;
  const completedCount = selectedMember ? visible.filter(h => Boolean(scores[selectedMember.id]?.[h.hole_number])).length : 0;
  const ownCompletedCount = myMember ? visible.filter(h => Boolean(scores[myMember.id]?.[h.hole_number])).length : 0;
  function switchPlayer(direction: number) {
    if (busy || members.length < 2 || !selectedMember) return;
    const index = members.findIndex(member => member.id === selectedMember.id);
    setSelectedPlayerId(members[(index + direction + members.length) % members.length].id);
  }
  function onScoreTouchStart(e: TouchEvent<HTMLDivElement>) {
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onScoreTouchEnd(e: TouchEvent<HTMLDivElement>) {
    if (!swipeStart.current) return;
    const dx = e.changedTouches[0].clientX - swipeStart.current.x;
    const dy = e.changedTouches[0].clientY - swipeStart.current.y;
    swipeStart.current = null;
    if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.4) switchPlayer(dx < 0 ? 1 : -1);
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
        .golf-mobile .mobile-view-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 8px 0; }
        .golf-mobile .mobile-view-switch button { padding: 10px 5px; border: 1px solid #c8d8ce; border-radius: 10px; background: #f1f6f2; color: #123d2b; font-weight: 700; font-size: 13px; }
        .golf-mobile .mobile-view-switch button.selected { background: #103e2c; color: #fff; }
        .golf-mobile .mobile-minor-actions { display: flex; justify-content: center; gap: 8px; margin-top: 8px; }
        .golf-mobile .mobile-minor-actions button { flex: 0 1 auto; min-height: 34px; padding: 6px 10px; font-size: 11px; font-weight: 500; background: #f5f8f5; color: #547163; border: 1px solid #d8e3da; border-radius: 8px; }
        .golf-mobile .mobile-minor-actions button:disabled { opacity: .4; }
        .golf-mobile .mobile-card { padding: 11px 12px; margin: 7px 0; }
        .golf-mobile .mobile-stepper { padding: 14px 0 10px; gap: 22px; }
        .golf-mobile .mobile-stepper button { height: 64px; width: 64px; border-radius: 15px; font-size: 36px; box-shadow: 0 4px 10px rgba(16,62,44,.15); touch-action: manipulation; }
        .golf-mobile .mobile-number { font-size: 54px; line-height: 1.05; min-width: 70px; }
        .golf-mobile .mobile-stepper .mobile-sub { margin-top: 5px; font-size: 12px; font-weight: 700; letter-spacing: .08em; }
        .golf-mobile .mobile-pill { padding: 13px 8px; background: #e0eee3; }
        .golf-mobile .mobile-pill strong { color: #174a32; }
        .golf-mobile .mobile-nav-next { background: #174a32 !important; color: #fff !important; border-color: #174a32 !important; }
        .golf-mobile .mobile-nav-next:disabled { opacity: .45; }
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
                      {score?.picked_up ? 'X' : score?.strokes ?? '–'}
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
        <div className="mobile-card" onTouchStart={onScoreTouchStart} onTouchEnd={onScoreTouchEnd}>
          <div className="flight-player-strip" role="group" aria-label="Vybrat hráče pro zápis skóre">
            {members.map(member => <button key={member.id} type="button" className={`${selectedMember?.id === member.id ? 'selected' : ''} ${member.finished_at ? 'finished' : ''}`} disabled={busy} aria-pressed={selectedMember?.id === member.id} onClick={() => setSelectedPlayerId(member.id)} title={member.finished_at ? 'Hráč dokončil hru – skóre nelze měnit' : member.nickname}>
              {member.nickname}{member.player_id === userId ? ' (já)' : ''}{member.finished_at ? ' ✓' : ''}
            </button>)}
          </div>
          <div className="mobile-nav">
            <strong>Jamka {activeHole?.hole_number ?? '–'} / {expected}</strong>
            <span className="mobile-sub">{completedCount} z {expected} zapsáno</span>
          </div>
          {selectedMember?.finished_at && <p className="mobile-sub" style={{ color: '#8a6034', fontWeight: 700 }}>Hráč již ukončil hru – skóre je pouze ke čtení.</p>}
          {activeHole && <>
            <p className="mobile-sub">{selectedMember ? teeName(selectedMember) : ''} · PAR {selectedMember ? memberHole(selectedMember, activeHole.hole_number)?.par ?? activeHole.par : activeHole.par} · SI {selectedMember ? memberHole(selectedMember, activeHole.hole_number)?.stroke_index ?? activeHole.stroke_index : activeHole.stroke_index}{(selectedMember ? memberHole(selectedMember, activeHole.hole_number)?.length_m : activeHole.length_m) != null ? ` · ${selectedMember ? memberHole(selectedMember, activeHole.hole_number)?.length_m : activeHole.length_m} m` : ''}</p>
            <div className="mobile-nav" style={{ marginTop: 7 }}>
              <div><strong>{selectedMember?.nickname || 'Moje skóre'}</strong><div className="mobile-sub">Herní HCP {selectedMember ? playingHandicap(selectedMember) ?? '–' : '–'}</div></div>
              <div style={{ textAlign: 'right' }}><strong>{selectedMember ? totalPoints(selectedMember) ?? '–' : '–'}</strong><div className="mobile-sub">Celkem bodů</div></div>
            </div>
            <div className="mobile-stepper">
              <button type="button" aria-label="Odebrat ránu" disabled={!myMember || Boolean(myMember.finished_at) || !selectedMember || Boolean(selectedMember.finished_at) || busy || visible.length !== expected || !activeScore?.strokes || activeScore.strokes <= 1} onClick={() => void save(activeHole.hole_number, String((activeScore?.strokes || 1) - 1))}>−</button>
              <div><div className="mobile-number">{activeScore?.picked_up ? 'X' : activeScore?.strokes ?? '–'}</div><div className="mobile-sub" style={{ textAlign: 'center' }}>RÁNY</div></div>
              <button type="button" aria-label="Přidat ránu" disabled={!myMember || Boolean(myMember.finished_at) || !selectedMember || Boolean(selectedMember.finished_at) || busy || visible.length !== expected || (activeScore?.strokes ?? 0) >= 30} onClick={() => void save(activeHole.hole_number, String(activeScore?.strokes ? activeScore.strokes + 1 : 1))}>+</button>
            </div>
            {game.scoring === 'stableford' && <div className="mobile-pill"><strong style={{ fontSize: 25 }}>{selectedMember ? points(selectedMember, activeHole) ?? '–' : '–'} {selectedMember && points(selectedMember, activeHole) === 1 ? 'bod' : 'body'}</strong><div className="mobile-sub">Stableford za jamku</div></div>}
            <div className="mobile-minor-actions">
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || !selectedMember || Boolean(selectedMember.finished_at) || busy || visible.length !== expected} onClick={() => void save(activeHole.hole_number, 'X')}>Zvednutý míč (X)</button>
              <button type="button" disabled={!myMember || Boolean(myMember.finished_at) || !selectedMember || Boolean(selectedMember.finished_at) || busy || visible.length !== expected || !activeScore} onClick={() => void save(activeHole.hole_number, '')}>Smazat skóre</button>
            </div>
            <div className="mobile-nav" style={{ marginTop: 8 }}>
              <button type="button" disabled={activeHole.hole_number <= 1} onClick={() => setMobileHole(Math.max(1, activeHole.hole_number - 1))}>← Předchozí</button>
              <button type="button" className="mobile-nav-next" disabled={activeHole.hole_number >= expected} onClick={() => setMobileHole(Math.min(expected, activeHole.hole_number + 1))}>Další →</button>
            </div>
          </>}
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
                      {score?.picked_up ? 'X' : score?.strokes ?? '–'}
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
