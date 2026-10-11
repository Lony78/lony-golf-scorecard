'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {supabase} from '../../lib/supabase';
type HistoryGame = {id:string;name:string;play_date:string};
export default function History() {
  const router=useRouter();
  const [games,setGames]=useState<HistoryGame[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{let live=true;async function load(){try{
    const client=supabase();const {data:{user},error:ae}=await client.auth.getUser();
    if(ae)throw ae;if(!user){router.replace('/login');return;}
    const {data:members,error:me}=await client.from('game_players').select('game_id').eq('player_id',user.id).not('finished_at','is',null);
    if(me)throw me;
    const ids=(members||[]).map(m=>m.game_id);
    if(ids.length){const {data,error:ge}=await client.from('games').select('id,name,play_date').in('id',ids).order('play_date',{ascending:false});if(ge)throw ge;if(live)setGames(data||[]);}
  }catch(e){if(live)setError(e instanceof Error?e.message:'Historii se nepodařilo načíst.');}finally{if(live)setLoading(false);}}
  void load();return()=>{live=false;};},[router]);
  return <main><p className="brand">LONY GOLF SCORECARD</p><div className="panel"><h1>Historie her</h1><p className="muted">Tvé dokončené golfové hry.</p>
  {loading?<p>Načítám…</p>:error?<p role="alert" className="error">{error}</p>:games.length===0?<p>Nemáš zatím žádnou dokončenou hru.</p>:<div style={{display:'grid',gap:10}}>{games.map(g=><Link key={g.id} href={'/games/'+g.id} style={{display:'block',padding:15,background:'#eef3e5',color:'#173b29',borderRadius:12,textDecoration:'none'}}><strong>{g.name}</strong><br/><small>{g.play_date}</small></Link>)}</div>}
  <p><Link href="/dashboard">← Zpět na přehled</Link></p></div></main>;
}
