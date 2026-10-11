'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Profile = Record<string, unknown>;
type Status = 'loading' | 'allowed' | 'denied' | 'error';

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function playerName(profile: Profile): string {
  return textValue(profile.nickname) || textValue(profile.display_name) || 'Hráč bez přezdívky';
}

function handicap(profile: Profile): string {
  const value = profile.handicap ?? profile.hcp ?? profile.handicap_index;
  return typeof value === 'number' || typeof value === 'string' ? String(value) : '—';
}

export default function AdminPlayersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const [players, setPlayers] = useState<Profile[]>([]);
  const [search, setSearch] = useState('');

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
      .filter(player => !query || [playerName(player), textValue(player.first_name), textValue(player.last_name), textValue(player.surname)]
        .some(value => value.toLocaleLowerCase('cs').includes(query)))
      .sort((a, b) => playerName(a).localeCompare(playerName(b), 'cs'));
  }, [players, search]);

  return (
    <main className="lony-players">
      <style>{`
        .lony-players { max-width:760px; min-height:100dvh; padding:22px 16px 48px; box-sizing:border-box; color:#f6faf5; background:linear-gradient(155deg,#0b271a,#174631); }
        .lony-players a { text-decoration:none; }
        .lony-players .players-panel { margin-top:22px; background:#f5f8f2; color:#173d2b; border-radius:20px; padding:20px 16px; }
        .lony-players .players-search { width:100%; box-sizing:border-box; padding:13px 14px; border:1px solid #cdded1; border-radius:12px; font:inherit; background:white; color:#173d2b; outline-color:#548c63; }
        .lony-players .players-row { display:flex; align-items:center; gap:12px; padding:14px 0; border-bottom:1px solid #dae6dc; }
        .lony-players .players-row:last-child { border-bottom:0; }
        .lony-players .players-avatar { width:42px; height:42px; border-radius:50%; background:#e1ede4; display:grid; place-items:center; font-weight:700; flex-shrink:0; }
        .lony-players .players-detail { flex:1; min-width:0; }
        .lony-players .players-detail strong { display:block; font-size:15px; overflow-wrap:anywhere; }
        .lony-players .players-detail small { display:block; margin-top:4px; color:#6a7f70; }
        .lony-players .players-badge { background:#dcebdc; color:#19542f; font-size:10px; font-weight:700; padding:5px 8px; border-radius:999px; }
      `}</style>
      <Link href="/admin" style={{ color:'#d4e8d6', fontSize:14 }}>← Zpět do administrace</Link>
      <p style={{ margin:'25px 0 7px', fontSize:12, letterSpacing:2, fontWeight:700 }}>LONY GOLF SCORECARD</p>
      <h1 style={{ margin:'0 0 8px', fontSize:32 }}>Správa hráčů</h1>
      {status === 'loading' && <p>Ověřuji oprávnění a načítám hráče…</p>}
      {status === 'denied' && <p role="alert">K této stránce nemáš administrátorské oprávnění.</p>}
      {status === 'error' && <p role="alert">Načtení se nezdařilo: {message}</p>}
      {status === 'allowed' && (
        <>
          <p style={{ color:'#d0e6d4' }}>Registrovaní hráči · Přehled pouze pro čtení</p>
          <section className="players-panel">
            <h2 style={{ margin:'0 0 5px', fontSize:21 }}>Registrovaní hráči</h2>
            <p style={{ margin:'0 0 18px', fontSize:13, color:'#6a7f70' }}>Načteno {players.length} profilů</p>
            <input
              className="players-search"
              aria-label="Hledat hráče"
              placeholder="Hledat podle přezdívky nebo jména…"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <div style={{ marginTop:12 }}>
              {filtered.map((player, index) => {
                const name = playerName(player);
                return (
                  <div className="players-row" key={textValue(player.id) || String(index)}>
                    <span className="players-avatar" aria-hidden="true">{name.slice(0, 1).toLocaleUpperCase('cs')}</span>
                    <div className="players-detail">
                      <strong>{name}</strong>
                      <small>HCP {handicap(player)}</small>
                    </div>
                    {player.is_admin === true && <span className="players-badge">ADMIN</span>}
                  </div>
                );
              })}
              {filtered.length === 0 && <p style={{ color:'#6a7f70', fontSize:14 }}>Žádní odpovídající hráči.</p>}
            </div>
          </section>
          <p style={{ fontSize:12, color:'#d0e6d4' }}>Úpravy profilů a oprávnění zatím nejsou aktivní.</p>
        </>
      )}
    </main>
  );
}
