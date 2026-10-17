'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Membership = { id: string; game_id: string; finished_at: string | null };
type Game = { id: string; name: string; play_date: string; status: string; scoring: string; holes_count: number };
type Entry = { game: Game; membershipId: string };

export default function Games() {
  const router = useRouter();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');

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
        if (active) setEntries(((games || []) as Game[])
          .filter(g => g.status !== 'cancelled' && g.status !== 'finished' && lookup.has(g.id))
          .map(game => ({ game, membershipId: lookup.get(game.id)! })));
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


  return <main className="lony-games">
    <div className="lony-games-wrap">
      <header className="lony-games-hero">
        <p className="lony-games-brand">LONY GOLF SCORECARD</p>
        <h1>Moje hry</h1>
        <p className="lony-games-description">Plánované a rozehrané hry. Dokončené najdeš v Historii.</p>
        <div className="lony-games-landscape" aria-hidden="true">
          <span className="lony-games-hill lony-games-hill-back" />
          <span className="lony-games-hill lony-games-hill-front" />
          <span className="lony-games-flag">⚑</span>
        </div>
      </header>

      <Link className="lony-games-create" href="/games/new">
        <span className="lony-games-create-icon" aria-hidden="true">+</span>
        <span>Vytvořit novou hru</span>
        <span className="lony-games-arrow" aria-hidden="true">→</span>
      </Link>

      {loading && <div className="lony-games-notice">Načítám hry…</div>}
      {error && <div className="lony-games-notice lony-games-error" role="alert">{error}</div>}
      {!loading && !error && entries.length === 0 && (
        <div className="lony-games-notice">Zatím nemáš žádnou plánovanou ani rozehranou hru. <Link href="/history">Zobrazit historii</Link></div>
      )}

      <section className="lony-games-list" aria-label="Plánované a rozehrané hry">
        {entries.map(entry => (
          <article className="lony-games-card" key={entry.game.id}>
            <Link className="lony-games-card-link" href={'/games/' + entry.game.id} aria-label={'Otevřít hru ' + entry.game.name}>
              <span className="lony-games-thumb" aria-hidden="true" />
              <span className="lony-games-card-info">
                <strong>{entry.game.name}</strong>
                <span className="lony-games-meta"><span aria-hidden="true">▦</span> {entry.game.play_date} <span className="lony-games-dot">·</span> {entry.game.holes_count} jamek</span>
                <span className="lony-games-meta"><span aria-hidden="true">⚑</span> {entry.game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</span>
              </span>
              <span className="lony-games-chevron" aria-hidden="true">›</span>
            </Link>
            <div className="lony-games-card-footer">
              <button className="lony-games-leave" type="button" onClick={() => void leave(entry)} disabled={Boolean(leaving)}>
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
                {leaving === entry.membershipId ? 'Odhlašuji…' : 'Opustit hru'}
              </button>
              <span className="lony-games-footer-hint">Otevři kartu pro pokračování <span aria-hidden="true">↗</span></span>
            </div>
          </article>
        ))}
      </section>

      <Link href="/dashboard" className="lony-games-back"><span aria-hidden="true">←</span> Zpět na přehled</Link>
    </div>
    <div className="lony-games-bottom-landscape" aria-hidden="true"><span /></div>
    <style jsx global>{`
      .lony-games { position:relative; isolation:isolate; min-height:100dvh; overflow:hidden; background:radial-gradient(ellipse at 70% 18%,#14583c 0%,#083c2a 36%,#062b20 74%,#05281e 100%); color:#fff; padding: max(34px,env(safe-area-inset-top)) 20px max(55px,env(safe-area-inset-bottom)); box-sizing:border-box; font-family:inherit; }
      .lony-games * {box-sizing:border-box}
      .lony-games-wrap {max-width:530px;margin:0 auto;position:relative;z-index:2}
      .lony-games-hero {position:relative;padding:20px 0 25px;min-height:230px}
      .lony-games-brand {font-size:12px;font-weight:750;letter-spacing:3px;color:#e2eab9;margin:0 0 26px}
      .lony-games-hero h1 {position:relative;z-index:2;font-size:clamp(34px,8vw,46px);line-height:1.1;letter-spacing:-1px;margin:0 0 27px;color:white}
      .lony-games-description {position:relative;z-index:2;font-size:14px;line-height:1.5;color:#c0d5c9;max-width:400px;margin:0}
      .lony-games-landscape {position:absolute;z-index:1;right:-20px;top:18px;width:70%;height:165px;opacity:.85;overflow:hidden;pointer-events:none;mask-image:linear-gradient(to right,transparent,black 28%)}
      .lony-games-hill {position:absolute;display:block;left:0;right:-30px;border-radius:50% 50% 0 0}
      .lony-games-hill-back {height:95px;bottom:15px;background:#2d6d3f;transform:rotate(-7deg) translateY(45px)}
      .lony-games-hill-front {height:80px;bottom:-12px;background:#4e8c42;transform:rotate(5deg) translateY(36px)}
      .lony-games-flag {position:absolute;right:24%;top:21px;font-size:50px;color:#e8efdf;text-shadow:0 0 8px #13402d}
      .lony-games-create {display:flex;align-items:center;gap:15px;min-height:70px;padding:14px 19px;border-radius:18px;background:linear-gradient(110deg,#e1efc1,#cde3aa);color:#073b29;text-decoration:none;font-weight:800;font-size:clamp(17px,4.4vw,21px);box-shadow:0 8px 26px #00190e30}
      .lony-games-create-icon {display:grid;place-items:center;flex:0 0 43px;height:43px;border-radius:50%;background:#043b2a;color:#e3efc7;font-size:34px;font-weight:400;line-height:1}
      .lony-games-arrow {margin-left:auto;font-size:29px;font-weight:400}
      .lony-games-list {display:grid;gap:16px;margin-top:20px}
      .lony-games-card {border-radius:22px;background:linear-gradient(125deg,#fff,#e9f4ec);color:#073a2b;overflow:hidden;box-shadow:0 12px 34px #001b102d;border:1px solid #ffffffa8}
      .lony-games-card-link {display:flex;align-items:center;gap:14px;padding:17px 15px 12px;text-decoration:none;color:inherit;min-height:118px}
      .lony-games-thumb {display:block;flex:0 0 92px;height:90px;border-radius:15px;background:#2c6946 url('/games-scenery.jpg') center/cover no-repeat;box-shadow:inset 0 0 0 1px #ffffff5c}
      .lony-games-card-info {min-width:0;flex:1;display:flex;flex-direction:column;gap:7px}
      .lony-games-card-info strong {font-size:clamp(17px,4.5vw,22px);line-height:1.2;overflow-wrap:anywhere}
      .lony-games-meta {font-size:12px;color:#5e766b;line-height:1.35}
      .lony-games-dot {padding:0 3px}
      .lony-games-chevron {font-size:34px;line-height:1;color:#0c4d34}
      .lony-games-card-footer {display:flex;align-items:center;gap:10px;padding:0 15px 16px}
      .lony-games-leave {display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:43px;padding:10px 12px;border-radius:12px;border:1px solid #e6a9ab;background:#fff1f1;color:#a0272e;font-weight:750;font-size:13px;cursor:pointer;white-space:nowrap}
      .lony-games-leave:disabled {opacity:.6;cursor:wait}
      .lony-games-footer-hint {margin-left:auto;color:#5e766b;font-size:11px;text-align:right}
      .lony-games-back {display:inline-flex;align-items:center;gap:11px;margin-top:28px;padding:14px 21px;border-radius:999px;background:#edf6ef;color:#073a2b;font-size:15px;font-weight:750;text-decoration:none}
      .lony-games-back span {font-size:23px;font-weight:400}
      .lony-games-notice {margin-top:18px;padding:18px;border-radius:17px;background:#eff7f0;color:#103e2c;font-size:14px}
      .lony-games-notice a {color:#0b6b43;font-weight:750}
      .lony-games-error {color:#99252b;background:#fff0f0}
      .lony-games-bottom-landscape {position:absolute;z-index:0;bottom:-80px;left:-10%;width:120%;height:220px;background:#164b32;clip-path:polygon(0 50%,20% 59%,43% 49%,68% 26%,100% 38%,100% 100%,0 100%);opacity:.58}
      .lony-games-bottom-landscape span {position:absolute;inset:70px 0 0;background:#39703f;clip-path:polygon(0 42%,26% 13%,56% 50%,82% 28%,100% 42%,100% 100%,0 100%);opacity:.4}
      @media(max-width:390px) {.lony-games {padding-left:14px;padding-right:14px}.lony-games-card-link{gap:10px;padding-left:12px;padding-right:12px}.lony-games-thumb{flex-basis:78px;height:83px}.lony-games-card-footer{padding-left:12px;padding-right:12px}.lony-games-footer-hint{font-size:10px}}
    `}</style>
  </main>;
}
