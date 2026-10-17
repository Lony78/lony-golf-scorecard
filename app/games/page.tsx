'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Membership = { id: string; game_id: string; finished_at: string | null };
type Game = { id: string; name: string; play_date: string; status: string; scoring: string; holes_count: number; organizer_id: string };
type Entry = { game: Game; membershipId: string; players: number; completed: number };

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
          .select('id,name,play_date,status,scoring,holes_count,organizer_id')
          .in('id', list.map(m => m.game_id)).order('play_date', { ascending: false });
        if (gameError) throw gameError;
        const lookup = new Map(list.map(m => [m.game_id, m.id]));
        const visible = ((games || []) as Game[]).filter(g => g.status !== 'cancelled' && g.status !== 'finished' && lookup.has(g.id));
        const ids = visible.map(g => g.id);
        const [{ data: allPlayers, error: playersError }, { data: scores, error: scoresError }] = await Promise.all([
          client.from('game_players').select('game_id,player_id').in('game_id',ids),
          client.from('scores').select('game_id,player_id,hole_number,strokes,picked_up').in('game_id',ids).eq('player_id',user.id),
        ]);
        if (playersError) throw playersError;
        if (scoresError) throw scoresError;
        if (active) setEntries(visible.map(game => ({
          game, membershipId: lookup.get(game.id)!,
          players: (allPlayers || []).filter(p => p.game_id === game.id).length,
          completed: new Set((scores || []).filter(sc => sc.game_id === game.id && (sc.strokes !== null || sc.picked_up)).map(sc => sc.hole_number)).size
        })));
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Hry se nepodařilo načíst.');
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  async function cancel(entry: Entry) {
    if (!userId || leaving) return;
    const organizer = entry.game.organizer_id === userId;
    const warning = organizer
      ? `Opravdu chceš ZRUŠIT CELOU HRU „${entry.game.name}“?\\n\\nHra a všechny zapsané výsledky všech hráčů budou trvale odstraněny. Tuto akci nelze vrátit.`
      : `Nejsi organizátorem hry „${entry.game.name}“. Můžeš pouze opustit svoji účast.\\n\\nTvoje vlastní výsledky budou odstraněny, ostatní hráči zůstanou. Pokračovat?`;
    if (!window.confirm(warning)) return;
    setLeaving(entry.membershipId);
    setError('');
    try {
      const client = supabase();
      if (organizer) {
        const { data, error: deleteError } = await client.from('games').delete()
          .eq('id',entry.game.id).eq('organizer_id',userId).select('id');
        if (deleteError) throw deleteError;
        if (!data?.length) throw new Error('Zrušení hry se nepodařilo. Zkontroluj oprávnění.');
        setEntries(prev => prev.filter(e => e.game.id !== entry.game.id));
      } else {
        const { error: scoresError } = await client.from('scores').delete()
          .eq('game_id',entry.game.id).eq('player_id',userId);
        if (scoresError) throw scoresError;
        const { data, error: memberError } = await client.from('game_players').delete()
          .eq('game_id',entry.game.id).eq('player_id',userId).select('game_id');
        if (memberError) throw memberError;
        if (!data?.length) throw new Error('Odchod ze hry se nepodařil.');
        setEntries(prev => prev.filter(e => e.game.id !== entry.game.id));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Akce se nepodařila.');
    } finally { setLeaving(null); }
  }


  return <main className="lg16">
    <div className="lg16-inner">
      <header className="lg16-head">
        <div className="lg16-art" aria-hidden="true"><span className="lg16-green"/><span className="lg16-flag">⚑</span></div>
        <div className="lg16-brand">LONY GOLF SCORECARD</div>
        <h1>Moje hry</h1>
        <p>Plánované a rozehrané hry.<br/>Dokončené najdeš v Historii.</p>
      </header>
      <Link href="/games/new" className="lg16-new"><span className="lg16-plus">+</span><strong>Vytvořit novou hru</strong><span className="lg16-arr">→</span></Link>
      {loading && <div className="lg16-message">Načítám hry…</div>}
      {error && <div className="lg16-message lg16-error" role="alert">{error}</div>}
      {!loading && !error && entries.length === 0 && <div className="lg16-message">Nemáš žádnou rozehranou hru. <Link href="/history">Zobrazit historii</Link></div>}
      <div className="lg16-list">
        {entries.map(entry => <article key={entry.game.id} className="lg16-card">
          <Link className="lg16-top" href={'/games/'+entry.game.id}>
            <span className="lg16-photo" aria-hidden="true"/>
            <span className="lg16-info">
              <strong>{entry.game.name}</strong>
              <span>▦ &nbsp;{entry.game.play_date}</span>
              <span>⚑ &nbsp;{entry.game.holes_count} jamek</span>
              <span>♜ &nbsp;{entry.game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</span>
            </span>
            <span className="lg16-chevron">›</span>
          </Link>
          <div className="lg16-bottom">
            <button type="button" disabled={Boolean(leaving)} onClick={() => void cancel(entry)} className="lg16-cancel">
              <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2m3 0-1 15H6L5 6m5 4v7m4-7v7"/></svg>
              {leaving === entry.membershipId ? 'Zpracovávám…' : entry.game.organizer_id === userId ? 'Zrušit hru' : 'Opustit hru'}
            </button>
            <span className="lg16-stat"><span className="lg16-people">♟</span><strong>{entry.players}</strong><small>{entry.players === 1 ? 'hráč' : entry.players < 5 ? 'hráči' : 'hráčů'}</small></span>
            <span className="lg16-stat lg16-progress"><span>⚑</span><strong>{entry.completed} / {entry.game.holes_count}</strong><small>zapsáno</small></span>
          </div>
        </article>)}
      </div>
      <Link className="lg16-back" href="/dashboard"><span>←</span> Zpět na přehled</Link>
    </div>
    <div className="lg16-land" aria-hidden="true"/>
    <style jsx global>{`
      .lg16{min-height:100dvh;position:relative;isolation:isolate;overflow:hidden;background:radial-gradient(ellipse at 66% 18%,#126043 0%,#06412e 48%,#063325 100%);color:white;padding:38px 20px 80px;font-family:inherit}
      .lg16 *{box-sizing:border-box}
      .lg16-inner{position:relative;z-index:2;max-width:540px;margin:0 auto}
      .lg16 .lg16-head{display:block!important;position:relative!important;width:100%!important;min-height:222px!important;margin:0 0 18px!important;padding:0!important;background:none!important;text-align:left!important;overflow:visible!important}
      .lg16-brand{display:block!important;position:relative;z-index:2;color:#e4e9bb;font-size:12px;letter-spacing:3px;font-weight:750;margin:0 0 26px}
      .lg16 .lg16-head h1{display:block!important;position:relative;z-index:2;width:auto!important;margin:0 0 18px!important;color:white;font-size:clamp(37px,9vw,49px);line-height:1.12;letter-spacing:-1px}
      .lg16 .lg16-head p{display:block!important;position:relative;z-index:2;width:auto!important;margin:0!important;color:#b4cfc0;font-size:15px;line-height:1.55}
      .lg16-art{position:absolute;right:-20px;top:25px;width:58%;height:180px;opacity:.82;overflow:hidden;mask-image:linear-gradient(90deg,transparent,black 35%)}
      .lg16-green{position:absolute;bottom:0;right:-25%;width:145%;height:65px;background:#48883e;border-radius:90% 20% 0 0;transform:rotate(-5deg)}
      .lg16-flag{position:absolute;top:4px;right:21%;font-size:65px;color:#d6e7cf}
      .lg16-new{display:flex;align-items:center;gap:14px;min-height:70px;border-radius:18px;padding:13px 17px;background:linear-gradient(105deg,#e1f0c1,#cfe5ad);color:#063d2a;text-decoration:none;font-size:clamp(16px,4.5vw,21px);box-shadow:0 9px 24px #001e1220}
      .lg16-plus{display:grid;place-items:center;flex:0 0 45px;height:45px;border-radius:50%;background:#063b2a;color:#e4f0c7;font-size:34px;font-weight:400}
      .lg16-arr{margin-left:auto;font-size:30px;font-weight:400}
      .lg16-list{display:grid;gap:17px;margin-top:19px}
      .lg16-card{background:linear-gradient(115deg,#fff,#e9f5ec);color:#083e2d;border:1px solid #ffffffc2;border-radius:22px;overflow:hidden;padding:15px;box-shadow:0 10px 30px #00231535}
      .lg16-top{display:flex;gap:15px;align-items:center;color:inherit;text-decoration:none;min-height:130px}
      .lg16-photo{display:block;flex:0 0 39%;height:126px;border-radius:16px;background:#4c8b4d url('/games-course-v16.webp') center/cover no-repeat}
      .lg16-info{display:flex;flex-direction:column;gap:7px;min-width:0;flex:1}
      .lg16-info strong{font-size:clamp(17px,4.7vw,23px);line-height:1.15;overflow-wrap:anywhere}
      .lg16-info>span{font-size:13px;color:#607c70;line-height:1.25}
      .lg16-chevron{font-size:30px;line-height:1}
      .lg16-bottom{border-top:1px solid #dce9df;margin-top:14px;padding-top:12px;display:flex;align-items:center;justify-content:space-between;gap:8px}
      .lg16-cancel{display:flex;align-items:center;gap:6px;border:1px solid #e9a7ab;background:#fff0f1;color:#aa2630;padding:11px 9px;border-radius:12px;font-weight:750;font-size:12px;white-space:nowrap;cursor:pointer}
      .lg16-cancel:disabled{opacity:.55}
      .lg16-stat{display:grid;grid-template-columns:auto auto;column-gap:4px;align-items:center;color:#083c2a}
      .lg16-stat>span{grid-row:1 / 3;font-size:23px}
      .lg16-stat strong{font-size:15px;white-space:nowrap;line-height:1.1}
      .lg16-stat small{color:#779086;font-size:10px}
      .lg16-progress{border-left:1px solid #cbdcd0;padding-left:10px}
      .lg16-back{display:inline-flex;align-items:center;gap:12px;margin-top:40px;border-radius:999px;padding:15px 23px;background:#eaf6ec;color:#073d2b;font-weight:750;text-decoration:none}
      .lg16-back span{font-size:25px;font-weight:400}
      .lg16-message{background:#eaf6ec;color:#073d2b;padding:17px;border-radius:15px;margin-top:18px}
      .lg16-error{background:#fff0f0;color:#a02b33}
      .lg16-land{position:absolute;bottom:-70px;left:-5%;width:110%;height:160px;background:#23623c;clip-path:polygon(0 45%,35% 70%,75% 22%,100% 45%,100% 100%,0 100%);opacity:.55}
      @media(max-width:390px){.lg16{padding-left:14px;padding-right:14px}.lg16-photo{flex-basis:33%;height:116px}.lg16-top{gap:10px}.lg16-card{padding:12px}.lg16-bottom{gap:5px}.lg16-cancel{font-size:11px;padding:10px 7px}.lg16-progress{padding-left:6px}.lg16-stat strong{font-size:13px}}
    `}</style>
  </main>;
}
