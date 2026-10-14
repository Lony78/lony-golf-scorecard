'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

type Game = { id: string; name: string; play_date: string; status: string };
export default function Dashboard() {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState('');
  const [hcp, setHcp] = useState<number | null>(null);
  const [avatar, setAvatar] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Game | null>(null);
  const [activeLoading, setActiveLoading] = useState(true);
  const [activeError, setActiveError] = useState('');
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const client = supabase();
        const { data: { user }, error } = await client.auth.getUser();
        if (error) throw error;
        if (!user) { router.replace('/login'); return; }
        const { data: profile } = await client.from('profiles').select('nickname,handicap_index').eq('id', user.id).maybeSingle();
        if (!live) return;
        setNickname(profile?.nickname || user.user_metadata?.nickname || user.email || 'Hráč');
        const handicap = profile?.handicap_index ?? user.user_metadata?.handicap_index;
        setHcp(handicap === null || handicap === undefined || handicap === '' ? null : Number(handicap));
        setAvatar(String(user.user_metadata?.avatar_url || ''));
        // Oprávnění zjišťujeme na serveru přes databázovou funkci, nikoli podle přezdívky.
        const { data: adminAllowed, error: adminError } = await client.rpc('is_admin');
        if (!live) return;
        setIsAdmin(!adminError && adminAllowed === true);
        setLoading(false);
        const { data: memberships, error: memberError } = await client.from('game_players').select('game_id,finished_at').eq('player_id',user.id).is('finished_at',null);
        if (memberError) throw memberError;
        const ids = (memberships || []).map(m => m.game_id);
        if (ids.length) {
          const { data: games, error: gameError } = await client.from('games').select('id,name,play_date,status').in('id', ids).order('play_date',{ascending:false});
          if (gameError) throw gameError;
          if (live) setActive((games || []).find(g => g.status !== 'cancelled' && g.status !== 'finished') || null);
        }
      } catch (e) {
        if (live) { setActiveError(e instanceof Error ? e.message : 'Nepodařilo se načíst aktivní hru.'); setLoading(false); }
      } finally { if (live) setActiveLoading(false); }
    }
    void load();
    return () => { live = false; };
  }, [router]);
  useEffect(() => {
    if (!open) return;
    function outside(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); }
    function escape(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  async function logout() { await supabase().auth.signOut(); router.replace('/login'); }
  if (loading) return <main>Ověřuji přihlášení…</main>;
  const items = [
    { label: 'Aktivní hra', subtitle: activeLoading ? 'Načítám…' : activeError ? 'Nelze načíst' : active ? 'Hra právě probíhá' : 'Žádná rozehraná hra', href: active ? '/games/' + active.id : '', icon: '▷', image: '/dashboard-v12/active-game.webp', inactive: !active || activeLoading || Boolean(activeError) },
    { label: 'Nová hra', subtitle: 'Založ novou hru', href: '/games/new', icon: '+', image: '/dashboard-v12/new-game.webp', inactive: false },
    { label: 'Moje hry', subtitle: 'Přehled a výsledky', href: '/games', icon: '☷', image: '/dashboard-v12/my-games.webp', inactive: false },
    { label: 'Žebříček', subtitle: 'Připravujeme', href: '', icon: '🏆', image: '/dashboard-v12/leaderboard.webp', inactive: true },
    { label: 'Historie', subtitle: 'Tvoje odehrané hry', href: '/history', icon: '↶', image: '/dashboard-v12/history.webp', inactive: false },
  ];
  return <main className="lony-dashboard">
    <style>{`
      .lony-dashboard {
        position: relative; isolation: isolate; overflow: hidden;
        max-width: 520px; min-height: 100dvh;
        background: #0b271a url('/golf-photo-final.jpg') center bottom / cover no-repeat;
        color: #fff;
      }
      .lony-dashboard::before {
        content: ''; position: absolute; inset: 0; z-index: -1;
        background: linear-gradient(180deg,rgba(5,31,21,.75) 0%,rgba(6,36,24,.60) 47%,rgba(7,28,18,.22) 100%);
        pointer-events: none;
      }
      .lony-dashboard .brand { color: #f0f3dd; letter-spacing: .17em; font-weight: 750; }
      .lony-dashboard .brand::first-letter { color: #fff; }
      .lony-dashboard .lony-tiles {
        display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px;
      }
      .lony-dashboard .lony-card {
        position: relative; isolation: isolate; overflow: hidden;
        display: flex; flex-direction: column; justify-content: flex-end;
        box-sizing: border-box; min-width: 0; min-height: 185px;
        padding: 16px; border-radius: 23px;
        border: 1px solid rgba(245,255,243,.34);
        background: #163d2a; color: #fff; text-decoration: none;
        box-shadow: 0 12px 28px rgba(0,0,0,.22);
        transition: transform .16s ease, border-color .16s ease;
      }
      .lony-dashboard a.lony-card:active { transform: scale(.98); }
      .lony-dashboard a.lony-card:hover { border-color: rgba(255,255,255,.78); }
      .lony-dashboard .lony-card::before {
        content: ''; position: absolute; inset: 0; z-index: -2;
        background-image: var(--tile-image); background-size: cover;
        background-position: center 30%;
      }
      .lony-dashboard .lony-card::after {
        content: ''; position: absolute; inset: 0; z-index: -1;
        background: linear-gradient(180deg,rgba(4,31,20,.04) 0%,rgba(4,31,20,.32) 36%,rgba(3,32,20,.96) 100%);
      }
      .lony-dashboard .lony-card--inactive { opacity: .77; cursor: default; }
      .lony-dashboard .lony-card--inactive::after {
        background: linear-gradient(180deg,rgba(12,35,26,.23),rgba(5,31,21,.94));
      }
      .lony-dashboard .lony-card-icon {
        display: grid; place-items: center; width: 43px; height: 43px;
        margin-bottom: 13px; border: 2px solid rgba(255,255,255,.94);
        border-radius: 50%; font-size: 29px; line-height: 1; font-weight: 500;
      }
      .lony-dashboard .lony-card-heading {
        display: flex; align-items: center; justify-content: space-between; gap: 4px;
        font-size: clamp(17px,4.5vw,23px); font-weight: 800; line-height: 1.2;
        white-space: nowrap;
      }
      .lony-dashboard .lony-card-arrow { font-size: 25px; font-weight: 300; opacity: .95; }
      .lony-dashboard .lony-card-subtitle {
        margin-top: 5px; color: rgba(255,255,255,.81);
        font-size: clamp(11px,3.1vw,14px); line-height: 1.3;
      }
      .lony-dashboard .lony-card--wide {
        grid-column: 1 / -1; min-height: 104px; padding: 16px 19px;
        flex-direction: row; align-items: center; justify-content: flex-start; gap: 15px;
      }
      .lony-dashboard .lony-card--wide::before { background-position: center 55%; }
      .lony-dashboard .lony-card--wide::after {
        background: linear-gradient(90deg,rgba(3,31,21,.95),rgba(4,37,25,.69));
      }
      .lony-dashboard .lony-card--wide .lony-card-icon { flex-shrink: 0; margin: 0; }
      .lony-dashboard .lony-card--wide .lony-card-content { flex: 1; min-width: 0; }
      .lony-dashboard .lony-card--wide .lony-card-arrow { margin-left: auto; }
      .lony-dashboard .lony-card:focus-visible { outline: 3px solid #e5d49b; outline-offset: 3px; }
      @media (max-width: 360px) {
        .lony-dashboard .lony-tiles { gap: 9px; }
        .lony-dashboard .lony-card { padding: 12px; min-height: 164px; border-radius: 18px; }
        .lony-dashboard .lony-card-heading { font-size: 16px; }
        .lony-dashboard .lony-card-icon { width: 37px; height: 37px; font-size: 25px; }
      }
      @media (min-width: 600px) {
        .lony-dashboard { border-left: 1px solid rgba(255,255,255,.06); border-right: 1px solid rgba(255,255,255,.06); }
      }
    `}</style>
    <header style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,position:'relative',marginBottom:28}}>
      <p className="brand" style={{margin:0,fontSize:'clamp(11px,2.7vw,15px)'}}>LONY GOLF SCORECARD</p>
      <div ref={menuRef} style={{position:'relative',flexShrink:0}}>
        <button type="button" aria-label="Otevřít uživatelské menu" aria-expanded={open} onClick={() => setOpen(v => !v)} style={{display:'flex',alignItems:'center',gap:7,background:'transparent',border:'1px solid #759180',borderRadius:30,color:'white',padding:'5px 9px',cursor:'pointer',maxWidth:190}}>
          {avatar ? <img src={avatar} alt="Profilová fotografie" style={{width:32,height:32,borderRadius:'50%',objectFit:'cover'}} /> : <span style={{display:'grid',placeItems:'center',width:32,height:32,borderRadius:'50%',background:'#e6f1df',color:'#173b29',fontWeight:800}}>{nickname.slice(0,1).toUpperCase()}</span>}
          <span style={{fontSize:13,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:92}}>{nickname}</span><span aria-hidden="true">⌄</span>
        </button>
        {open && <div role="menu" style={{position:'absolute',right:0,top:'calc(100% + 9px)',zIndex:30,width:240,maxWidth:'calc(100vw - 32px)',background:'#fff',color:'#173b29',borderRadius:14,boxShadow:'0 12px 36px #0005',padding:15}}>
          <div style={{display:'flex',alignItems:'center',gap:10,paddingBottom:12,borderBottom:'1px solid #e1e8df'}}>
            {avatar ? <img src={avatar} alt="" style={{width:40,height:40,borderRadius:'50%',objectFit:'cover'}}/> : <span style={{display:'grid',placeItems:'center',width:40,height:40,borderRadius:'50%',background:'#e6f1df',fontWeight:800}}>{nickname.slice(0,1).toUpperCase()}</span>}
            <div style={{minWidth:0}}><div style={{fontWeight:800,overflowWrap:'anywhere'}}>{nickname} <span style={{fontWeight:400,fontSize:12,whiteSpace:'nowrap'}}>HCP {hcp === null || !Number.isFinite(hcp) ? '–' : hcp.toLocaleString('cs-CZ')}</span></div><small>Můj účet</small></div>
          </div>
          <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} style={{display:'block',padding:'13px 4px',color:'#173b29',textDecoration:'none',fontWeight:700}}>✎ Upravit profil</Link>
          {isAdmin && <Link role="menuitem" href="/admin" onClick={() => setOpen(false)} style={{display:'block',padding:'13px 4px',color:'#173b29',textDecoration:'none',fontWeight:700,borderTop:'1px solid #e1e8df'}}>⚙ Administrace</Link>}
          <button role="menuitem" type="button" onClick={logout} style={{width:'100%',textAlign:'left',padding:'13px 4px',background:'transparent',border:0,borderTop:'1px solid #e1e8df',color:'#173b29',cursor:'pointer'}}>↪ Odhlásit se</button>
        </div>}
      </div>
    </header>
    <h1 style={{marginBottom:8}}>Ahoj, {nickname}!</h1>
    <p style={{color:'#d9e7b5',marginBottom:24}}>Tvůj golfový přehled</p>
    <div className="lony-tiles">
      {items.map(item => {
        const wide = item.label === 'Historie';
        const cardClass = `lony-card${wide ? ' lony-card--wide' : ''}${item.inactive ? ' lony-card--inactive' : ''}`;
        const contents = <>
          <span className="lony-card-icon" aria-hidden="true">{item.icon}</span>
          <span className="lony-card-content">
            <span className="lony-card-heading">{item.label}{!wide && !item.inactive && <span className="lony-card-arrow" aria-hidden="true">›</span>}</span>
            <span className="lony-card-subtitle" style={{display:'block'}}>{item.subtitle}</span>
          </span>
          {wide && <span className="lony-card-arrow" aria-hidden="true">›</span>}
        </>;
        const cardStyle = { '--tile-image': `url("${item.image}")` } as CSSProperties;
        return item.href && !item.inactive ?
          <Link key={item.label} href={item.href} className={cardClass} style={cardStyle}>{contents}</Link> :
          <div key={item.label} className={cardClass} style={cardStyle} aria-disabled="true">{contents}</div>;
      })}
    </div>
    {activeError && <p role="alert" style={{color:'#f9c8b7',marginTop:12}}>Aktivní hra: {activeError}</p>}
  </main>;
}
