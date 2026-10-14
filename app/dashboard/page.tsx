'use client';
import { useEffect, useRef, useState } from 'react';
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
    { label: 'Aktivní hra', href: active && !activeLoading && !activeError ? '/games/' + active.id : '', image: '/dashboard-approved/01_aktivni_hra.png', inactive: !active || activeLoading || Boolean(activeError), status: activeLoading ? 'Načítám aktivní hru' : activeError ? 'Aktivní hru nelze načíst' : active ? 'Hra právě probíhá' : 'Žádná rozehraná hra' },
    { label: 'Nová hra', href: '/games/new', image: '/dashboard-approved/02_nova_hra.png', inactive: false, status: 'Založ novou hru' },
    { label: 'Moje hry', href: '/games', image: '/dashboard-approved/03_moje_hry.png', inactive: false, status: 'Přehled a výsledky' },
    { label: 'Žebříček', href: '', image: '/dashboard-approved/04_zebricek.png', inactive: true, status: 'Připravujeme' },
    { label: 'Historie', href: '/history', image: '/dashboard-approved/05_historie.png', inactive: false, status: 'Tvoje odehrané hry' },
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
        display: grid; grid-template-columns: repeat(2,minmax(0,1fr));
        column-gap: 3%; row-gap: 14px;
      }
      .lony-dashboard .lony-card {
        display: block; position: relative; min-width: 0; width: 100%;
        aspect-ratio: 570 / 459; overflow: hidden; border-radius: 9%;
        text-decoration: none; background: transparent;
        transition: transform .16s ease;
      }
      .lony-dashboard .lony-card--short { aspect-ratio: 570 / 419; }
      .lony-dashboard .lony-card--wide {
        grid-column: 1 / -1; aspect-ratio: 1176 / 232;
        border-radius: 5% / 24%;
      }
      .lony-dashboard .lony-card img {
        width: 100%; height: 100%; display: block; object-fit: fill;
      }
      .lony-dashboard a.lony-card:hover { transform: translateY(-2px); }
      .lony-dashboard a.lony-card:active { transform: scale(.98); }
      .lony-dashboard .lony-card--inactive { cursor: default; }
      .lony-dashboard .lony-card:focus-visible { outline: 3px solid #e5d49b; outline-offset: 3px; }
      .lony-dashboard .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
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
      {items.map((item, index) => {
        const wide = index === 4;
        const short = index === 2 || index === 3;
        const cardClass = `lony-card${wide ? ' lony-card--wide' : ''}${short ? ' lony-card--short' : ''}${item.inactive ? ' lony-card--inactive' : ''}`;
        const content = <>
          <img src={item.image} alt={`${item.label} – ${index === 0 ? 'Žádná rozehraná hra' : item.status}`} draggable={false} />
          <span className="sr-only">{item.status}</span>
        </>;
        return item.href && !item.inactive ?
          <Link key={item.label} href={item.href} className={cardClass} aria-label={`${item.label}: ${item.status}`}>{content}</Link> :
          <div key={item.label} className={cardClass} aria-label={`${item.label}: ${item.status}`} aria-disabled="true">{content}</div>;
      })}
    </div>
    {activeError && <p role="alert" style={{color:'#f9c8b7',marginTop:12}}>Aktivní hra: {activeError}</p>}
  </main>;
}
