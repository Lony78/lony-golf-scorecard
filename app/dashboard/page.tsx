'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {supabase} from '../../lib/supabase';
export default function Dashboard(){
 const [nickname,setNickname]=useState(''),[loading,setLoading]=useState(true);const router=useRouter();
 useEffect(()=>{supabase().auth.getUser().then(({data})=>{if(!data.user)router.replace('/login');else{setNickname(data.user.user_metadata?.nickname||data.user.email||'Hráč');setLoading(false)}}).catch(()=>router.replace('/login'))},[router]);
 async function logout(){await supabase().auth.signOut();router.replace('/login')}
 if(loading)return <main>Ověřuji přihlášení…</main>;
 return <main><header><p className="brand">LONY GOLF SCORECARD</p><button onClick={logout}>Odhlásit</button></header><h1>Ahoj, {nickname}!</h1><p style={{color:'#d9e7b5'}}>Tvůj golfový přehled</p><div className="panel"><h2>Moje aktivní hra</h2><p className="muted">Své rozehrané hry najdeš v přehledu her.</p><Link className="btn secondary" href="/games">Otevřít moje hry</Link></div><div className="tiles"><Link className="tile" href="/games">Moje hry</Link><Link className="tile" href="/games/new">Nová hra</Link><Link className="tile" href="/dashboard">Žebříček (připravujeme)</Link><Link className="tile" href="/profile">Můj profil</Link></div></main>
}
