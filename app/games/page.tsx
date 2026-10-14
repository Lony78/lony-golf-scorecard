'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Membership = { id: string; game_id: string; finished_at: string | null };
type Game = { id: string; name: string; play_date: string; status: string; scoring: string; holes_count: number };
type Entry = { game: Game; membershipId: string };

function ExitIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></svg>;
}

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

  return <main className="my-games-v14">
    <div className="my-games-hero">
      <p className="my-games-brand">LONY GOLF SCORECARD</p>
      <h1>Moje hry</h1>
      <p className="my-games-description">Plánované a rozehrané hry. Dokončené najdeš v Historii.</p>
    </div>
    <Link className="my-games-create" href="/games/new"><span className="my-games-plus" aria-hidden="true">+</span><span>Vytvořit novou hru</span><span className="my-games-arrow" aria-hidden="true">→</span></Link>
    {loading && <p className="my-games-status">Načítám hry…</p>}
    {error && <p className="my-games-error" role="alert">{error}</p>}
    {!loading && !error && entries.length === 0 && <div className="my-games-empty">Nemáš žádnou plánovanou ani rozehranou hru. <Link href="/history">Zobrazit historii</Link></div>}
    <div className="my-games-list">
      {entries.map(entry => <article key={entry.game.id} className="my-games-card">
        <Link href={'/games/' + entry.game.id} className="my-games-card-cover" aria-label={'Otevřít hru ' + entry.game.name}>
          <span className="my-games-card-text"><strong>{entry.game.name}</strong><span>{entry.game.play_date} · {entry.game.holes_count} jamek · {entry.game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</span></span>
          <span className="my-games-cover-arrow" aria-hidden="true">›</span>
        </Link>
        <div className="my-games-card-actions">
          <button type="button" className="my-games-leave" onClick={() => void leave(entry)} disabled={Boolean(leaving)}>
            <ExitIcon/><span>{leaving === entry.membershipId ? 'Odhlašuji…' : 'Opustit hru'}</span>
          </button>
          <span className="my-games-card-hint">Otevři hru klepnutím na fotografii</span>
        </div>
      </article>)}
    </div>
    <Link href="/dashboard" className="my-games-back"><span aria-hidden="true">←</span> Zpět na přehled</Link>
    <style jsx global>{`
      main.my-games-v14{position:relative;isolation:isolate;max-width:560px;min-height:100dvh;padding:80px 20px 100px;color:#fff;background:#062c20;overflow:hidden}
      .my-games-v14:before{content:"";position:absolute;z-index:-1;inset:0 0 auto;height:490px;background:linear-gradient(90deg,rgba(3,38,27,.9) 0%,rgba(3,38,27,.53) 58%,rgba(3,38,27,.16) 100%),linear-gradient(0deg,#062c20 0%,transparent 62%),url('/games-scenery.jpg') center 28%/cover no-repeat;pointer-events:none}
      .my-games-hero{margin-bottom:26px}.my-games-brand{font-size:11px;letter-spacing:3px;font-weight:750;color:#e1e9b8;margin:0 0 10px}.my-games-hero h1{font-size:clamp(36px,9vw,47px);line-height:1.12;letter-spacing:-1px;margin:0 0 24px;color:white}.my-games-description{color:#e1e9df;font-size:14px;line-height:1.5;margin:0;max-width:440px}
      .my-games-create{display:flex;align-items:center;gap:15px;min-height:67px;padding:12px 18px;border-radius:17px;background:linear-gradient(110deg,#d9e9b3,#e6f0c8);color:#073426;text-decoration:none;font-weight:800;font-size:clamp(15px,4vw,19px);box-shadow:0 8px 20px rgba(0,0,0,.12)}
      .my-games-plus{display:grid;place-items:center;flex:none;width:39px;height:39px;border-radius:50%;background:#063b2a;color:#e5f5c2;font-size:30px;font-weight:400;line-height:1}.my-games-arrow{margin-left:auto;font-size:29px;font-weight:400}
      .my-games-list{display:grid;gap:18px;margin-top:19px}.my-games-card{border-radius:21px;overflow:hidden;background:#fff;box-shadow:0 12px 32px rgba(0,0,0,.16);border:1px solid rgba(255,255,255,.45)}
      .my-games-card-cover{position:relative;display:flex;align-items:flex-end;min-height:182px;padding:22px 46px 19px 20px;background:linear-gradient(0deg,rgba(1,34,23,.95) 0%,rgba(1,34,23,.3) 52%,rgba(1,34,23,.03) 100%),url('/games-scenery.jpg') center 51%/cover no-repeat;color:#fff;text-decoration:none}
      .my-games-card-text{display:grid;gap:5px;min-width:0}.my-games-card-text strong{font-size:clamp(22px,6vw,29px);line-height:1.12;overflow-wrap:anywhere}.my-games-card-text>span{font-size:clamp(12px,3.4vw,15px);color:#e1e7e0;line-height:1.4}.my-games-cover-arrow{position:absolute;right:18px;bottom:29px;font-size:43px;line-height:1}
      .my-games-card-actions{display:flex;align-items:center;gap:12px;min-height:84px;padding:15px 18px;color:#123d2b}.my-games-leave{display:inline-flex;align-items:center;justify-content:center;gap:9px;flex:none;min-height:46px;padding:10px 13px;background:#fff4f4;color:#99282e;border:1px solid #e5b6b9;border-radius:13px;font-size:15px;font-weight:750;cursor:pointer}.my-games-leave:disabled{opacity:.5;cursor:wait}.my-games-card-hint{font-size:11px;color:#60776a;line-height:1.4}
      .my-games-back{display:inline-flex;align-items:center;justify-content:center;gap:13px;margin-top:24px;min-height:51px;padding:12px 21px;border-radius:999px;background:#e8f3ec;color:#123e2e;text-decoration:none;font-weight:750;font-size:15px;border:1px solid #d6e8db}.my-games-back span{font-size:23px;line-height:1}
      .my-games-status,.my-games-empty,.my-games-error{margin-top:20px;padding:19px;border-radius:17px;background:#edf6ef;color:#173f2e;line-height:1.5}.my-games-empty a{color:#196843;font-weight:700}.my-games-error{background:#fff1f1;color:#8f2525}
      @media(max-width:380px){.my-games-v14 .my-games-card-hint{display:none}.my-games-card-actions{min-height:75px}.my-games-description{font-size:13px}}
    `}</style>
  </main>;
}
