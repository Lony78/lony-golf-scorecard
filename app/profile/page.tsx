'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function Profile() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [hcp, setHcp] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const client = supabase();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('nickname,handicap_index')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!active) return;
        // Auth metadata may contain newer edits from the old profile screen,
        // which previously did not update the public profiles table.
        setNickname(String(user.user_metadata?.nickname ?? profile?.nickname ?? ''));
        setHcp(String(user.user_metadata?.handicap_index ?? profile?.handicap_index ?? 54));
      } catch (err) {
        if (active) setInfo(err instanceof Error ? err.message : 'Profil se nepodařilo načíst.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = nickname.trim();
    const handicap = Number(hcp);
    if (!trimmed || !Number.isFinite(handicap) || handicap < -10 || handicap > 54) {
      setInfo('Zadej přezdívku a platný handicap od -10 do 54.');
      return;
    }
    setSaving(true);
    setInfo('');
    try {
      const client = supabase();
      const { data: { user }, error: authError } = await client.auth.getUser();
      if (authError) throw authError;
      if (!user) { router.replace('/login'); return; }
      const { error: profileError } = await client.from('profiles').upsert(
        { id: user.id, nickname: trimmed, handicap_index: handicap },
        { onConflict: 'id' }
      );
      if (profileError) throw profileError;
      const { error: metadataError } = await client.auth.updateUser({
        data: { nickname: trimmed, handicap_index: handicap }
      });
      if (metadataError) {
        setInfo('Profil je uložen v databázi, ale nepodařilo se aktualizovat přihlašovací údaje: ' + metadataError.message);
        return;
      }
      setNickname(trimmed);
      setInfo('Profil byl uložen do databáze i přihlašovacích údajů.');
    } catch (err) {
      setInfo(err instanceof Error ? err.message : 'Chyba ukládání profilu.');
    } finally {
      setSaving(false);
    }
  }

  return <main>
    <p className="brand">LONY GOLF SCORECARD</p>
    <div className="panel">
      <h2>Můj profil</h2>
      <form onSubmit={save}>
        <label className="field">Přezdívka
          <input required maxLength={60} disabled={loading || saving} value={nickname} onChange={e => setNickname(e.target.value)} />
        </label>
        <label className="field">Handicap Index
          <input type="number" min="-10" max="54" step="0.1" required disabled={loading || saving} value={hcp} onChange={e => setHcp(e.target.value)} />
        </label>
        <button className="btn secondary" disabled={loading || saving}>
          {saving ? 'Ukládám…' : loading ? 'Načítám…' : 'Uložit profil'}
        </button>
      </form>
      {info && <p role="status">{info}</p>}
      <Link href="/dashboard">Zpět na přehled</Link>
    </div>
  </main>;
}
