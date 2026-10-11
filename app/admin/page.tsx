'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Stat = { label: string; value: string; icon: string };
type Player = { id: string; nickname: string | null; handicap_index: number | null; avatar_url: string | null; is_admin: boolean | null };
export default function AdminPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'allowed' | 'denied' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [playersOpen, setPlayersOpen] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState('');
  const [playerSearch, setPlayerSearch] = useState('');
  const [stats, setStats] = useState<Stat[]>([
    { label: 'Registrovaní hráči', value: '—', icon: '♙' },
    { label: 'Golfová hřiště', value: '—', icon: '⚑' },
    { label: 'Všechny hry', value: '—', icon: '▤' },
    { label: 'Aktivní hry', value: '—', icon: '⛳' },
  ]);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const db = supabase();
        const { data: { user }, error: authError } = await db.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }
        const { data: allowed, error: permissionError } = await db.rpc('is_admin');
        if (permissionError) throw permissionError;
        if (allowed !== true) { if (live) setStatus('denied'); return; }
        if (!live) return;
        setStatus('allowed');
        // Tyto součty podléhají existujícím RLS pravidlům.
        const [profiles, courses, games, active] = await Promise.all([
          db.from('profiles').select('id', { count: 'exact', head: true }),
          db.from('courses').select('id', { count: 'exact', head: true }),
          db.from('games').select('id', { count: 'exact', head: true }),
          db.from('games').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        ]);
        if (!live) return;
        const counts = [profiles, courses, games, active];
        setStats(old => old.map((item, index) => ({ ...item, value: counts[index].error ? '—' : String(counts[index].count ?? 0) })));
        if (counts.some(item => item.error)) setMessage('Některé statistiky nejsou podle aktuálních databázových oprávnění dostupné.');
      } catch (e) {
        if (live) { setMessage(e instanceof Error ? e.message : 'Nepodařilo se ověřit oprávnění.'); setStatus('error'); }
      }
    }
    void load();
    return () => { live = false; };
  }, [router]);
  async function openPlayers() {
    if (playersOpen) { setPlayersOpen(false); return; }
    setPlayersOpen(true);
    setPlayersLoading(true);
    setPlayersError('');
    const db = supabase();
    const { data: { user }, error: authError } = await db.auth.getUser();
    if (authError || !user) { setPlayersError('Přihlášení není dostupné. Přihlas se znovu.'); setPlayersLoading(false); return; }
    const { data: allowed, error: permissionError } = await db.rpc('is_admin');
    if (permissionError || allowed !== true) { setPlayersError('Přístup odepřen.'); setPlayersLoading(false); return; }
    const { data, error } = await db.from('profiles').select('id,nickname,handicap_index,avatar_url,is_admin').order('nickname', { ascending: true });
    if (error) setPlayersError('Nepodařilo se načíst hráče: ' + error.message);
    else setPlayers((data ?? []) as Player[]);
    setPlayersLoading(false);
  }
  const visiblePlayers = players.filter(player => (player.nickname ?? '').toLocaleLowerCase('cs').includes(playerSearch.toLocaleLowerCase('cs')));
  return <main className="lony-admin">
    <style>{`
      .lony-admin { max-width: 760px; min-height: 100dvh; color: #f6faf5; background: linear-gradient(155deg,#0b271a,#174631); padding: 22px 16px 48px; box-sizing: border-box; }
      .lony-admin a { text-decoration: none; }
      .lony-admin .admin-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
      .lony-admin .admin-stat { background:#244c38;border:1px solid #416b52;border-radius:17px;padding:18px 14px;min-height:100px; }
      .lony-admin .admin-stat strong { display:block;font-size:30px;margin:10px 0 3px; }
      .lony-admin .admin-stat small { color:#d2e7d7; }
      .lony-admin .admin-panel { background:#f5f8f2;color:#173d2b;border-radius:20px;padding:20px 16px;margin-top:18px; }
      .lony-admin .admin-row { display:flex;align-items:center;gap:13px;padding:15px 2px;border-bottom:1px solid #dae6dc; }
      .lony-admin .admin-row:last-child { border-bottom:0; }
      .lony-admin .admin-icon { width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#e1ede4;font-size:22px;flex-shrink:0; }
      .lony-admin .admin-row strong { display:block;font-size:15px; }
      .lony-admin .admin-row small { display:block;color:#6a7f70;margin-top:3px; }
      .lony-admin .admin-player { display:flex;gap:12px;align-items:center;padding:12px 0;border-top:1px solid #dae6dc; }
      .lony-admin .admin-avatar { width:44px;height:44px;flex-shrink:0;border-radius:50%;background:#dceadd;color:#18452f;display:grid;place-items:center;font-weight:800;overflow:hidden; }
      .lony-admin .admin-avatar img { width:100%;height:100%;object-fit:cover; }
      .lony-admin .admin-search { width:100%;box-sizing:border-box;border:1px solid #c9d8cb;border-radius:12px;padding:12px;margin:12px 0;background:white;color:#173d2b;font-size:15px; }
      .lony-admin .admin-action { border:0;background:transparent;color:inherit;cursor:pointer;text-align:left;padding:0;font:inherit;width:100%; }
      .lony-admin .admin-action:focus-visible { outline:3px solid #548c63;outline-offset:4px;border-radius:8px; }
    `}</style>
    <Link href="/dashboard" style={{ color:'#d4e8d6',fontSize:14 }}>← Zpět na úvodní stránku</Link>
    <p className="brand" style={{ margin:'25px 0 7px',fontSize:12 }}>LONY GOLF SCORECARD</p>
    <h1 style={{ margin:'0 0 8px',fontSize:32 }}>Administrace</h1>
    {status === 'loading' && <p>Ověřuji administrátorská oprávnění…</p>}
    {status === 'denied' && <p role="alert">K této stránce nemáš administrátorské oprávnění.</p>}
    {status === 'error' && <p role="alert">Ověření se nezdařilo: {message}</p>}
    {status === 'allowed' && <>
      <p style={{ color:'#d0e6d4',marginBottom:24 }}>Správa aplikace · Přehled systému</p>
      <div className="admin-grid">{stats.map(item => <div key={item.label} className="admin-stat"><span aria-hidden="true" style={{fontSize:23}}>{item.icon}</span><strong>{item.value}</strong><small>{item.label}</small></div>)}</div>
      {message && <p style={{color:'#ffdfbd',fontSize:13}}>{message}</p>}
      <section className="admin-panel">
        <h2 style={{ margin:'0 0 8px',fontSize:21 }}>Správa aplikace</h2>
        {[
          ['♙','Správa hráčů','Profily, handicap a oprávnění'],
          ['⚑','Golfová hřiště','Jamky, odpaliště, PAR, SI, CR/SR'],
          ['▤','Správa her','Aktivní a dokončené hry'],
          ['✎','Výsledky','Kontrola a opravy skóre'],
          ['🏆','Žebříčky a statistiky','Výsledky a aktivita hráčů'],
          ['⚙','Nastavení systému','Oprávnění a historie změn'],
        ].map(([icon,name,description]) => <div className="admin-row" key={name}>
          <span className="admin-icon" aria-hidden="true">{icon}</span>
          {name === 'Správa hráčů' ? <button type="button" className="admin-action" onClick={() => void openPlayers()} aria-expanded={playersOpen} aria-controls="admin-players"><strong>{name}</strong><small>{description}</small></button> : <div style={{ flex:1 }}><strong>{name}</strong><small>{description}</small></div>}
          <span style={{fontSize:11,color:'#718578'}}>{name === 'Správa hráčů' ? (playersOpen ? 'Skrýt ▲' : 'Otevřít ›') : 'Připravujeme'}</span>
        </div>)}
        {playersOpen && <div id="admin-players" style={{marginTop:16,paddingTop:10,borderTop:'2px solid #d5e3d7'}}>
          <h3 style={{margin:'0 0 6px',fontSize:19}}>Registrovaní hráči</h3>
          <p style={{fontSize:12,color:'#667e6c',margin:'0 0 10px'}}>Přehled profilů · pouze pro čtení</p>
          <input className="admin-search" aria-label="Hledat hráče" placeholder="Hledat podle přezdívky…" value={playerSearch} onChange={e => setPlayerSearch(e.target.value)} />
          {playersLoading && <p>Načítám hráče…</p>}
          {playersError && <p role="alert" style={{color:'#a33027'}}>{playersError}</p>}
          {!playersLoading && !playersError && visiblePlayers.length === 0 && <p>Žádní hráči k zobrazení.</p>}
          {!playersLoading && !playersError && visiblePlayers.map(player => <div className="admin-player" key={player.id}>
            <div className="admin-avatar">{player.avatar_url ? <img src={player.avatar_url} alt="" referrerPolicy="no-referrer" /> : (player.nickname || '?').slice(0,1).toLocaleUpperCase('cs')}</div>
            <div style={{flex:1,minWidth:0}}><strong style={{display:'block',overflowWrap:'anywhere'}}>{player.nickname || 'Bez přezdívky'}</strong><small style={{color:'#647d6b'}}>HCP {player.handicap_index ?? '—'}</small></div>
            {player.is_admin === true && <span style={{fontSize:11,fontWeight:700,color:'#24583d',background:'#e0eddf',padding:'6px 8px',borderRadius:10}}>ADMIN</span>}
          </div>)}
          {!playersLoading && !playersError && <p style={{fontSize:12,color:'#667e6c'}}>Zobrazeno {visiblePlayers.length} hráčů</p>}
        </div>}
      </section>
      <p style={{fontSize:12,color:'#c2dac8',marginTop:18}}>Správa hráčů: přehled pouze pro čtení. Úpravy databáze zatím nejsou aktivní.</p>
    </>}
  </main>;
}
