'use client';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
export default function Profile() {
  const router = useRouter();
  const [nickname,setNickname] = useState('');
  const [hcp,setHcp] = useState('');
  const [avatar,setAvatar] = useState('');
  const [gender,setGender] = useState('');
  const [preferredTeeColor,setPreferredTeeColor] = useState('');
  const [photo,setPhoto] = useState<File | null>(null);
  const [preview,setPreview] = useState('');
  const [info,setInfo] = useState('');
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const client = supabase();
        const {data:{user},error} = await client.auth.getUser();
        if (error) throw error;
        if (!user) {router.replace('/login');return;}
        const {data:profile,error:pe} = await client.from('profiles').select('nickname,handicap_index,gender,preferred_tee_color').eq('id',user.id).maybeSingle();
        if (pe) throw pe;
        if (!live) return;
        setNickname(String(profile?.nickname ?? user.user_metadata?.nickname ?? ''));
        setHcp(String(profile?.handicap_index ?? user.user_metadata?.handicap_index ?? 54));
        setAvatar(String(user.user_metadata?.avatar_url || ''));
        setGender(String(profile?.gender ?? ''));
        setPreferredTeeColor(String(profile?.preferred_tee_color ?? ''));
      } catch (e) { if (live) setInfo(e instanceof Error ? e.message : 'Profil se nepodařilo načíst.'); }
      finally { if (live) setLoading(false); }
    }
    void load();return () => {live=false;};
  },[router]);
  function choosePhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {setInfo('Fotografie musí být JPG, PNG nebo WebP.');return;}
    if (file.size > 2*1024*1024) {setInfo('Fotografie může mít maximálně 2 MB.');return;}
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(file);setPreview(URL.createObjectURL(file));setInfo('');
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = nickname.trim();const handicap = Number(hcp.replace(',','.'));
    if (!trimmed || !Number.isFinite(handicap) || handicap < -10 || handicap > 54) {setInfo('Zadej přezdívku a handicap od -10 do 54.');return;}
    if (!gender || !preferredTeeColor) {setInfo('Vyber pohlaví a preferovaná odpaliště.');return;}
    setSaving(true);setInfo('');
    try {
      const client = supabase();
      const {data:{user},error:ae} = await client.auth.getUser();
      if (ae) throw ae;if (!user) {router.replace('/login');return;}
      let avatarUrl = avatar;
      if (photo) {
        const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
        const path = `${user.id}/avatar.${extension}`;
        const {error:uploadError} = await client.storage.from('avatars').upload(path,photo,{upsert:true,contentType:photo.type});
        if (uploadError) throw new Error('Fotografii nelze uložit. Zkontroluj nastavení úložiště avatars v Supabase. ' + uploadError.message);
        const {data:publicData} = client.storage.from('avatars').getPublicUrl(path);
        avatarUrl = publicData.publicUrl + '?v=' + Date.now();
      }
      const {error:pe} = await client.from('profiles').upsert({id:user.id,nickname:trimmed,handicap_index:handicap,gender,preferred_tee_color:preferredTeeColor},{onConflict:'id'});
      if (pe) throw pe;
      const {error:me} = await client.auth.updateUser({data:{nickname:trimmed,handicap_index:handicap,avatar_url:avatarUrl}});
      if (me) throw me;
      setNickname(trimmed);setHcp(String(handicap));setAvatar(avatarUrl);setPhoto(null);
      if (preview) {URL.revokeObjectURL(preview);setPreview('');}
      setInfo('Profil byl úspěšně uložen.');
    } catch (err) {setInfo(err instanceof Error ? err.message : 'Profil se nepodařilo uložit.');}
    finally {setSaving(false);}
  }
  return <main><p className="brand">LONY GOLF SCORECARD</p><div className="panel"><h1>Upravit profil</h1>
    <form onSubmit={save}>
      <div style={{display:'flex',alignItems:'center',gap:14,marginBottom:20}}>
        {(preview || avatar) ? <img src={preview || avatar} alt="Profilová fotografie" style={{width:78,height:78,borderRadius:'50%',objectFit:'cover'}}/> : <span style={{width:78,height:78,borderRadius:'50%',background:'#e6f1df',display:'grid',placeItems:'center',fontSize:28,color:'#173b29'}}>{nickname.slice(0,1).toUpperCase() || '⛳'}</span>}
        <label style={{display:'block',flex:1}}>Profilová fotografie<input type="file" accept="image/jpeg,image/png,image/webp" disabled={loading || saving} onChange={choosePhoto} style={{display:'block',width:'100%',maxWidth:280,marginTop:8}}/><small>JPG, PNG nebo WebP, maximálně 2 MB</small></label>
      </div>
      <label className="field">Přezdívka<input required maxLength={60} disabled={loading || saving} value={nickname} onChange={e=>setNickname(e.target.value)}/></label>
      <label className="field">Handicap Index<input type="number" min="-10" max="54" step="0.1" required disabled={loading || saving} value={hcp} onChange={e=>setHcp(e.target.value)}/></label>
      <label className="field">Pohlaví<select required disabled={loading || saving} value={gender} onChange={e=>setGender(e.target.value)}><option value="">Vyber pohlaví</option><option value="male">Muž</option><option value="female">Žena</option></select></label>
      <label className="field">Preferovaná odpaliště<select required disabled={loading || saving} value={preferredTeeColor} onChange={e=>setPreferredTeeColor(e.target.value)}><option value="">Vyber odpaliště</option><option value="white">Bílá</option><option value="yellow">Žlutá</option><option value="blue">Modrá</option><option value="red">Červená</option></select><small>Při vytváření hry se tato odpaliště předvyplní, pokud jsou na vybraném hřišti dostupná. Pro jednotlivou hru je lze změnit.</small></label>
      <button className="btn secondary" disabled={loading || saving}>{saving ? 'Ukládám…' : loading ? 'Načítám…' : 'Uložit profil'}</button>
    </form>
    {info && <p role="status" style={{overflowWrap:'anywhere'}}>{info}</p>}
    <div style={{ marginTop: 22, marginBottom: 12 }}>
      <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}>
        <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span>
        <span>Zpět na přehled</span>
      </Link>
    </div>
  </div></main>;
}
