'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Profile = Record<string, unknown>;
type Status = 'loading' | 'allowed' | 'denied' | 'error';
type EditForm = {
  nickname: string;
  handicap_index: string;
  gender: string;
  preferred_tee_color: string;
  language: string;
  avatar_url: string;
  messages_enabled: boolean;
};

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function playerName(profile: Profile): string {
  return textValue(profile.nickname) || 'Hráč bez přezdívky';
}

function handicap(profile: Profile): string {
  const value = profile.handicap_index;
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '—';
}

function toForm(profile: Profile): EditForm {
  return {
    nickname: textValue(profile.nickname),
    handicap_index: handicap(profile) === '—' ? '' : handicap(profile),
    gender: textValue(profile.gender),
    preferred_tee_color: textValue(profile.preferred_tee_color),
    language: textValue(profile.language),
    avatar_url: textValue(profile.avatar_url),
    messages_enabled: profile.messages_enabled === true,
  };
}

export default function AdminPlayersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [players, setPlayers] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');

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

        const { data, error } = await db.from('profiles').select('*').limit(1000);
        if (error) throw error;
        if (!live) return;
        setPlayers((data ?? []) as Profile[]);
        setStatus('allowed');
      } catch (error) {
        if (!live) return;
        setMessage(error instanceof Error ? error.message : 'Nepodařilo se načíst hráče.');
        setStatus('error');
      }
    }
    void load();
    return () => { live = false; };
  }, [router]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('cs');
    return players
      .filter(player => !query || playerName(player).toLocaleLowerCase('cs').includes(query))
      .sort((a, b) => playerName(a).localeCompare(playerName(b), 'cs'));
  }, [players, search]);

  function openEdit(player: Profile) {
    const id = textValue(player.id);
    if (!id) return;
    setEditingId(id);
    setForm(toForm(player));
    setEditError('');
    setNotice('');
  }

  function closeEdit() {
    if (saving) return;
    setEditingId(null);
    setForm(null);
    setEditError('');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId || !form || saving) return;
    setEditError('');
    setNotice('');
    const nickname = form.nickname.trim();
    const hcp = Number(form.handicap_index.trim().replace(',', '.'));
    if (!nickname) { setEditError('Přezdívka nesmí být prázdná.'); return; }
    if (!form.handicap_index.trim() || !Number.isFinite(hcp) || hcp < -10 || hcp > 54) {
      setEditError('Zadej platný handicap v rozsahu -10 až 54.'); return;
    }
    if (!form.language.trim()) { setEditError('Jazyk nesmí být prázdný.'); return; }
    const avatar = form.avatar_url.trim();
    if (avatar) {
      try {
        const url = new URL(avatar);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid');
      } catch { setEditError('Adresa fotografie musí být platný odkaz http nebo https.'); return; }
    }
    setSaving(true);
    try {
      const db = supabase();
      const { error } = await db.rpc('admin_update_player_profile', {
        p_player_id: editingId,
        p_nickname: nickname,
        p_handicap_index: hcp,
        p_gender: form.gender.trim() || null,
        p_preferred_tee_color: form.preferred_tee_color.trim() || null,
        p_language: form.language.trim(),
        p_avatar_url: avatar || null,
        p_messages_enabled: form.messages_enabled,
      });
      if (error) throw error;
      const { data: refreshed, error: refreshError } = await db.from('profiles').select('*').eq('id', editingId).single();
      if (refreshError) throw refreshError;
      setPlayers(current => current.map(player => textValue(player.id) === editingId ? (refreshed as Profile) : player));
      setEditingId(null);
      setForm(null);
      setNotice(`Profil hráče ${nickname} byl uložen.`);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Profil se nepodařilo uložit.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="lony-players">
      <style>{`
        .lony-players { max-width:760px; min-height:100dvh; padding:22px 16px 48px; box-sizing:border-box; color:#f6faf5; background:linear-gradient(155deg,#0b271a,#174631); }
        .lony-players a { text-decoration:none; }
        .lony-players .players-panel { margin-top:22px; background:#f5f8f2; color:#173d2b; border-radius:20px; padding:20px 16px; }
        .lony-players .players-search, .lony-players .edit-input { width:100%; box-sizing:border-box; padding:13px 14px; border:1px solid #cdded1; border-radius:12px; font:inherit; background:white; color:#173d2b; outline-color:#548c63; }
        .lony-players .players-row { display:flex; align-items:center; gap:12px; padding:14px 0; border-bottom:1px solid #dae6dc; }
        .lony-players .players-avatar { width:42px; height:42px; border-radius:50%; background:#e1ede4; display:grid; place-items:center; font-weight:700; flex-shrink:0; }
        .lony-players .players-detail { flex:1; min-width:0; }
        .lony-players .players-detail strong { display:block; font-size:15px; overflow-wrap:anywhere; }
        .lony-players .players-detail small { display:block; margin-top:4px; color:#6a7f70; }
        .lony-players .players-badge { background:#dcebdc; color:#19542f; font-size:10px; font-weight:700; padding:5px 8px; border-radius:999px; }
        .lony-players .edit-button { border:1px solid #b6d1bc; border-radius:10px; padding:9px 12px; background:#e5f0e5; color:#19542f; font:inherit; font-size:13px; font-weight:700; cursor:pointer; }
        .lony-players .edit-panel { margin:0 0 14px; padding:17px; border:1px solid #cdded1; border-radius:15px; background:#edf4eb; }
        .lony-players .edit-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
        .lony-players .edit-field { display:flex; flex-direction:column; gap:6px; font-size:13px; font-weight:600; }
        .lony-players .edit-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:18px; }
        .lony-players .save-button { background:#195c37; color:white; border:0; border-radius:10px; padding:11px 16px; font:inherit; font-weight:700; cursor:pointer; }
        .lony-players button:disabled { opacity:.55; cursor:not-allowed; }
        @media(max-width:520px) { .lony-players .edit-grid { grid-template-columns:1fr; } .lony-players .players-row { gap:8px; } }
      `}</style>
      <Link href="/admin" style={{ color:'#d4e8d6', fontSize:14 }}>← Zpět do administrace</Link>
      <p style={{ margin:'25px 0 7px', fontSize:12, letterSpacing:2, fontWeight:700 }}>LONY GOLF SCORECARD</p>
      <h1 style={{ margin:'0 0 8px', fontSize:32 }}>Správa hráčů</h1>
      {status === 'loading' && <p>Ověřuji oprávnění a načítám hráče…</p>}
      {status === 'denied' && <p role="alert">K této stránce nemáš administrátorské oprávnění.</p>}
      {status === 'error' && <p role="alert">Načtení se nezdařilo: {message}</p>}
      {status === 'allowed' && (
        <>
          <p style={{ color:'#d0e6d4' }}>Registrovaní hráči · Správa profilů</p>
          <section className="players-panel">
            <h2 style={{ margin:'0 0 5px', fontSize:21 }}>Registrovaní hráči</h2>
            <p style={{ margin:'0 0 18px', fontSize:13, color:'#6a7f70' }}>Načteno {players.length} profilů</p>
            {notice && <p role="status" style={{ color:'#195c37', fontWeight:700 }}>{notice}</p>}
            <input
              className="players-search"
              aria-label="Hledat hráče"
              placeholder="Hledat podle přezdívky…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <div style={{ marginTop:12 }}>
              {filtered.map((player, index) => {
                const name = playerName(player);
                const id = textValue(player.id);
                const isEditing = editingId === id && form !== null;
                return (
                  <div key={id || String(index)}>
                    <div className="players-row">
                      <span className="players-avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('cs')}</span>
                      <div className="players-detail">
                        <strong>{name}</strong>
                        <small>HCP {handicap(player)}</small>
                      </div>
                      {player.is_admin === true && <span className="players-badge">ADMIN</span>}
                      <button type="button" className="edit-button" disabled={saving || !id} onClick={() => isEditing ? closeEdit() : openEdit(player)}>
                        {isEditing ? 'Zavřít' : 'Upravit'}
                      </button>
                    </div>
                    {isEditing && (
                      <form className="edit-panel" onSubmit={saveProfile}>
                        <h3 style={{ margin:'0 0 15px' }}>Úprava profilu: {name}</h3>
                        <div className="edit-grid">
                          <label className="edit-field">Přezdívka
                            <input className="edit-input" required maxLength={100} value={form.nickname} onChange={e => setForm({ ...form, nickname:e.target.value })} />
                          </label>
                          <label className="edit-field">Handicap (HCP)
                            <input className="edit-input" required inputMode="decimal" value={form.handicap_index} onChange={e => setForm({ ...form, handicap_index:e.target.value })} />
                          </label>
                          <label className="edit-field">Pohlaví
                            <select className="edit-input" value={form.gender} onChange={e => setForm({ ...form, gender:e.target.value })}>
                              <option value="">Neuvedeno</option>
                              <option value="male">Muž (male)</option>
                              <option value="female">Žena (female)</option>
                              {form.gender && !['male','female'].includes(form.gender) && <option value={form.gender}>{form.gender}</option>}
                            </select>
                          </label>
                          <label className="edit-field">Preferovaná barva odpaliště
                            <input className="edit-input" value={form.preferred_tee_color} placeholder="Např. yellow" onChange={e => setForm({ ...form, preferred_tee_color:e.target.value })} />
                          </label>
                          <label className="edit-field">Jazyk
                            <input className="edit-input" required value={form.language} placeholder="Např. cs" onChange={e => setForm({ ...form, language:e.target.value })} />
                          </label>
                          <label className="edit-field">URL profilové fotografie
                            <input className="edit-input" type="url" value={form.avatar_url} placeholder="https://…" onChange={e => setForm({ ...form, avatar_url:e.target.value })} />
                          </label>
                        </div>
                        <label style={{ display:'flex', alignItems:'center', gap:10, marginTop:16, fontSize:14 }}>
                          <input type="checkbox" checked={form.messages_enabled} onChange={e => setForm({ ...form, messages_enabled:e.target.checked })} />
                          Povolit zprávy
                        </label>
                        {editError && <p role="alert" style={{ color:'#a12d27', fontSize:13 }}>{editError}</p>}
                        <p style={{ fontSize:12, color:'#6a7f70' }}>Administrátorská role a přihlašovací údaje se zde nemění.</p>
                        <div className="edit-actions">
                          <button type="button" className="edit-button" disabled={saving} onClick={closeEdit}>Zrušit</button>
                          <button type="submit" className="save-button" disabled={saving}>{saving ? 'Ukládám…' : 'Uložit profil'}</button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
              {filtered.length === 0 && <p style={{ color:'#6a7f70', fontSize:14 }}>Žádní odpovídající hráči.</p>}
            </div>
          </section>
          <p style={{ fontSize:12, color:'#d0e6d4' }}>Změny profilů jsou dostupné pouze administrátorovi. Role ADMIN zůstává chráněná.</p>
        </>
      )}
    </main>
  );
}
