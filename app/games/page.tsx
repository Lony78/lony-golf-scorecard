'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Membership = { id: string; game_id: string; finished_at: string | null };
type Game = { id: string; name: string; play_date: string; status: string; scoring: string; holes_count: number };
type Entry = { game: Game; membershipId: string };
type GameStats = { players: number | null; completed: number | null; organizer: boolean | null };

export default function Games() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [stats, setStats] = useState<Record<string, GameStats>>({});

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = supabase();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }
        if (active) setUserId(user.id);
        const { data: memberships, error: memberError } = await client.from('game_players')
          .select('id,game_id,finished_at').eq('player_id', user.id).is('finished_at', null);
        if (memberError) throw memberError;
        const list = (memberships || []) as Membership[];
        if (!list.length) { if (active) setEntries([]); return; }
        const { data: games, error: gameError } = await client.from('games')
          .select('id,name,play_date,status,scoring,holes_count')
          .in('id', list.map(m => m.game_id)).order('play_date', { ascending: false });
        if (gameError) throw gameError;
        const lookup = new Map(list.map(m => [m.game_id, m.id]));
        const visible = ((games || []) as Game[])
          .filter(g => g.status !== 'cancelled' && g.status !== 'finished' && lookup.has(g.id))
          .map(game => ({ game, membershipId: lookup.get(game.id)! }));
        if (active) setEntries(visible);
        // Doplňkové statistiky jsou nezávislé na načtení her.
        void Promise.all(visible.map(async entry => {
          try {
            const [playersResult, scoresResult, organizerResult] = await Promise.all([
              client.from('game_players').select('id').eq('game_id', entry.game.id),
              client.from('scores').select('hole_number,strokes,picked_up').eq('game_player_id', entry.membershipId),
              client.from('games').select('organizer_id').eq('id', entry.game.id).maybeSingle(),
            ]);
            const data: GameStats = {
              players: playersResult.error ? null : (playersResult.data || []).length,
              completed: scoresResult.error ? null : new Set((scoresResult.data || [])
                .filter(score => score.strokes !== null || score.picked_up)
                .map(score => score.hole_number)).size,
              organizer: organizerResult.error || !organizerResult.data ? null : organizerResult.data.organizer_id === user.id,
            };
            if (active) setStats(prev => ({ ...prev, [entry.game.id]: data }));
          } catch { /* Hry zůstanou viditelné i bez statistik. */ }
        }));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Hry se nepodařilo načíst.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  async function leave(entry: Entry) {
    if (!userId || leaving) return;
    if (!window.confirm(`Opravdu chceš opustit hru „${entry.game.name}“?\n\nOdhlásíš se z flightu a tvoje dosavadní zapsané výsledky v této hře budou odstraněny. Ostatní hráči ve hře zůstanou.`)) return;
    setLeaving(entry.membershipId);
    setError('');
    try {
      const client = supabase();
      // Smazání vlastních skóre před odstraněním účasti kvůli vazbě scores -> game_players.
      const { error: scoresError } = await client.from('scores').delete()
        .eq('game_player_id', entry.membershipId);
      if (scoresError) throw scoresError;
      const { data: removed, error: memberError } = await client.from('game_players')
        .delete().eq('id', entry.membershipId).eq('player_id', userId)
        .is('finished_at', null).select('id');
      if (memberError) throw memberError;
      if (!removed?.length) throw new Error('Odhlášení se nepotvrdilo. Obnov stránku a zkus to znovu.');
      setEntries(prev => prev.filter(e => e.membershipId !== entry.membershipId));
    } catch (e) {
      setError((e instanceof Error ? e.message : 'Odhlášení se nezdařilo.') + ' Pokud jde o oprávnění databáze, bude potřeba upravit pravidla Supabase.');
    } finally { setLeaving(null); }
  }

  async function cancelGame(entry: Entry) {
    if (!userId || leaving) return;
    if (stats[entry.game.id]?.organizer !== true) { await leave(entry); return; }
    if (!window.confirm(`Opravdu chceš ZRUŠIT CELOU HRU „${entry.game.name}“?\n\nTím odstraníš hru a její výsledky všem hráčům. Tuto akci nelze vrátit.`)) return;
    setLeaving(entry.membershipId);
    setError('');
    try {
      const client = supabase();
      const { data, error: deleteError } = await client.from('games').delete()
        .eq('id', entry.game.id).eq('organizer_id', userId).select('id');
      if (deleteError) throw deleteError;
      if (!data?.length) throw new Error('Hru se nepodařilo zrušit. Zkontroluj oprávnění.');
      setEntries(prev => prev.filter(e => e.game.id !== entry.game.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hru se nepodařilo zrušit.');
    } finally { setLeaving(null); }
  }

  return <main className="lony-v17">
    <div className="v17-content">
      <header className="v17-header">
        <div className="v17-art" aria-hidden="true"><div className="v17-hill"/><span>⚑</span></div>
        <p className="v17-brand">LONY GOLF SCORECARD</p>
        <h1>Moje hry</h1>
        <p className="v17-description">Plánované a rozehrané hry.<br/>Dokončené najdeš v Historii.</p>
      </header>
      <Link href="/games/new" className="v17-create"><span className="v17-plus">+</span><strong>Vytvořit novou hru</strong><span className="v17-arrow">→</span></Link>
      {loading && <div className="v17-notice">Načítám hry…</div>}
      {error && <div className="v17-notice v17-error" role="alert">{error}</div>}
      {!loading && !error && entries.length === 0 && <div className="v17-notice">Zatím nemáš rozehranou hru. <Link href="/history">Zobrazit historii</Link></div>}
      <section className="v17-list" aria-label="Seznam her">
        {entries.map(entry => <article key={entry.game.id} className="v17-card">
          <Link href={'/games/' + entry.game.id} className="v17-cardtop">
            <span className="v17-photo" aria-hidden="true"/>
            <span className="v17-details"><strong>{entry.game.name}</strong><span>▦ &nbsp;{entry.game.play_date}</span><span>⚑ &nbsp;{entry.game.holes_count} jamek</span><span>♜ &nbsp;{entry.game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</span></span>
            <span className="v17-chevron">›</span>
          </Link>
          <div className="v17-cardbottom">
            <button type="button" className="v17-cancel" disabled={Boolean(leaving)} onClick={() => void cancelGame(entry)}>
              <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v7m4-7v7"/></svg>
              {leaving === entry.membershipId ? 'Zpracovávám…' : stats[entry.game.id]?.organizer === true ? 'Zrušit hru' : 'Opustit hru'}
            </button>
            <span className="v17-stat"><span className="v17-stat-icon">♟</span><strong>{stats[entry.game.id]?.players ?? '–'}</strong><small>hráčů</small></span>
            <span className="v17-stat v17-stat-progress"><span className="v17-stat-icon">⚑</span><strong>{stats[entry.game.id]?.completed ?? '–'} / {entry.game.holes_count}</strong><small>zapsáno</small></span>
          </div>
        </article>)}
      </section>
      <Link href="/dashboard" className="v17-back"><span>←</span> Zpět na přehled</Link>
    </div>
    <div className="v17-bottom-art" aria-hidden="true"/>
    <style jsx global>{`
      .lony-v17{min-height:100dvh;position:relative;isolation:isolate;overflow:hidden;background:radial-gradient(ellipse at 68% 14%,#126246 0%,#06432f 43%,#062c20 100%);color:white;padding:38px 20px 100px;font-family:inherit}
      .lony-v17 *{box-sizing:border-box}
      .v17-content{position:relative;z-index:2;max-width:540px;margin:auto}
      .lony-v17 .v17-header{display:block!important;position:relative!important;min-height:218px!important;margin:0 0 18px!important;padding:0!important;width:100%!important;background:transparent!important;text-align:left!important;overflow:visible!important}
      .lony-v17 .v17-brand{display:block!important;position:relative!important;z-index:2;font-size:12px!important;letter-spacing:3px!important;color:#e7e9c2!important;font-weight:750!important;margin:0 0 26px!important;width:auto!important}
      .lony-v17 .v17-header h1{display:block!important;position:relative!important;z-index:2;font-size:clamp(38px,9vw,48px)!important;line-height:1.12!important;margin:0 0 18px!important;color:#fff!important;width:auto!important;letter-spacing:-1px!important}
      .lony-v17 .v17-description{display:block!important;position:relative!important;z-index:2;font-size:15px!important;line-height:1.5!important;color:#bcd4c6!important;margin:0!important;width:auto!important}
      .v17-art{position:absolute;z-index:1;right:-20px;top:18px;width:59%;height:190px;overflow:hidden;pointer-events:none;mask-image:linear-gradient(90deg,transparent,black 42%)}
      .v17-hill{position:absolute;bottom:0;right:-20%;width:140%;height:76px;background:#408b47;border-radius:70% 35% 0 0;transform:rotate(-5deg)}
      .v17-art>span{position:absolute;right:22%;top:10px;font-size:63px;color:#dfebd7}
      .v17-create{display:flex;align-items:center;gap:14px;min-height:70px;padding:13px 17px;border-radius:18px;background:linear-gradient(105deg,#e5f1c7,#cfe5b0);color:#063c2a;text-decoration:none;font-size:clamp(16px,4.5vw,21px);box-shadow:0 10px 30px #001e1228}
      .v17-plus{display:grid;place-items:center;flex:0 0 44px;height:44px;border-radius:50%;background:#063e2b;color:#e8f3c8;font-size:35px;font-weight:400}
      .v17-arrow{margin-left:auto;font-size:30px;font-weight:400}
      .v17-list{display:grid;gap:17px;margin-top:20px}
      .v17-card{border-radius:22px;background:linear-gradient(120deg,#fff,#e8f4eb);color:#083e2d;padding:15px;box-shadow:0 10px 35px #001a1233;border:1px solid #fff9}
      .v17-cardtop{display:flex;align-items:center;gap:15px;min-height:131px;text-decoration:none;color:inherit}
      .v17-photo{display:block;flex:0 0 39%;height:126px;border-radius:16px;background:#34724b url('/games-course-v17.webp') center/cover no-repeat}
      .v17-details{min-width:0;flex:1;display:flex;flex-direction:column;gap:8px}
      .v17-details strong{font-size:clamp(17px,4.5vw,22px);line-height:1.16;overflow-wrap:anywhere}
      .v17-details>span{font-size:13px;color:#648176;line-height:1.2}
      .v17-chevron{font-size:30px;line-height:1;color:#0c4833}
      .v17-cardbottom{display:flex;align-items:center;justify-content:space-between;gap:8px;border-top:1px solid #d6e6da;margin-top:14px;padding-top:13px}
      .v17-cancel{display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid #e5a8ad;border-radius:12px;padding:11px 9px;background:#fff0f1;color:#a32330;font-size:12px;font-weight:750;white-space:nowrap;cursor:pointer}
      .v17-cancel:disabled{opacity:.6}
      .v17-stat{display:grid;grid-template-columns:auto auto;column-gap:4px;align-items:center;color:#093d2b}
      .v17-stat-icon{grid-row:1/3;font-size:22px}
      .v17-stat strong{font-size:15px;line-height:1.1;white-space:nowrap}
      .v17-stat small{font-size:10px;color:#799187}
      .v17-stat-progress{border-left:1px solid #cbdcd0;padding-left:10px}
      .v17-back{display:inline-flex;align-items:center;gap:12px;margin-top:38px;padding:15px 23px;border-radius:999px;background:#eaf6ec;color:#073d2b;text-decoration:none;font-weight:750}
      .v17-back span{font-size:24px;font-weight:400}
      .v17-notice{padding:17px;margin-top:17px;border-radius:16px;background:#eaf6ec;color:#073d2b}
      .v17-error{background:#fff0f0;color:#a22b34}
      .v17-bottom-art{position:absolute;z-index:0;bottom:-45px;left:-5%;width:110%;height:170px;background:#2e6a41;opacity:.4;clip-path:polygon(0 45%,34% 65%,70% 20%,100% 40%,100% 100%,0 100%)}
      @media(max-width:390px){.lony-v17{padding-left:14px;padding-right:14px}.v17-card{padding:12px}.v17-cardtop{gap:10px}.v17-photo{flex-basis:34%;height:113px}.v17-cardbottom{gap:5px}.v17-cancel{padding:10px 7px;font-size:11px}.v17-stat strong{font-size:13px}.v17-stat-progress{padding-left:6px}}
    `}</style>
  </main>;
}
