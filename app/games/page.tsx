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

  return <main>
    <p className="brand">LONY GOLF SCORECARD</p>
    <h1>Moje hry</h1>
    <p className="muted">Plánované a rozehrané hry. Dokončené najdeš v Historii.</p>
    <Link className="btn" href="/games/new">+ Vytvořit novou hru</Link>
    {loading && <p>Načítám…</p>}
    {error && <p className="panel error" role="alert">{error}</p>}
    {!loading && !error && entries.length === 0 && <div className="panel">Nemáš žádnou aktivní hru. <Link href="/history">Zobrazit historii</Link></div>}
    {entries.map(entry => <div key={entry.game.id} className="panel" style={{marginTop:12,padding:14}}>
      <Link href={'/games/' + entry.game.id} style={{display:'block',textDecoration:'none',marginBottom:12}}>
        <strong style={{display:'block',fontSize:18}}>{entry.game.name}</strong>
        <span className="muted">{entry.game.play_date} · {entry.game.holes_count} jamek · {entry.game.scoring === 'stableford' ? 'Stableford' : 'Na rány'}</span>
      </Link>
      <button type="button" onClick={() => void leave(entry)} disabled={Boolean(leaving)}
        style={{border:'1px solid #e7c7c7',background:'#fff3f3',color:'#8c2525',padding:'9px 14px',borderRadius:10,cursor:'pointer',fontWeight:700}}>
        {leaving === entry.membershipId ? 'Odhlašuji…' : '🗑 Opustit hru'}
      </button>
    </div>)}
    <div style={{ marginTop: 22, marginBottom: 12 }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}>
        <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span>
        <span>Zpět na přehled</span>
      </Link>
    </div>
  </main>;
}
