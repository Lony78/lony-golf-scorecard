'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Course = { id: string; name: string };
type Player = { id: string; nickname: string; handicap_index: number | null };
type Tee = {
  id: string;
  name: string;
  course_rating: number | null;
  slope_rating: number | null;
};

function parseHandicap(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(number) && number >= -10 && number <= 54 ? number : null;
}

export default function NewGame() {
  const router = useRouter();
  const [name, setName] = useState('Golfová hra');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [course, setCourse] = useState('');
  const [tee, setTee] = useState('');
  const [courses, setCourses] = useState<Course[]>([]);
  const [tees, setTees] = useState<Tee[]>([]);
  const [count, setCount] = useState(18);
  const [scoring, setScoring] = useState('stableford');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    supabase().from('courses').select('id,name').order('name').then(({ data, error }) => {
      if (error) setError(error.message);
      else setCourses(data || []);
    });
  }, []);

  useEffect(() => {
    setTee('');
    setTees([]);
    if (!course) return;
    supabase().from('course_tees')
      .select('id,name,course_rating,slope_rating')
      .eq('course_id', course)
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setTees(data || []);
      });
  }, [course]);

  async function findPlayers() {
    setSearchError('');
    setMatches([]);
    const query = search.trim();
    if (query.length < 2) {
      setSearchError('Zadej alespoň 2 znaky přezdívky.');
      return;
    }
    setSearchBusy(true);
    try {
      const { data: { user }, error: authError } = await supabase().auth.getUser();
      if (authError || !user) throw new Error('Nejprve se přihlas.');
      const escaped = query.replace(/[\%_]/g, '\\$&');
      const { data, error } = await supabase().from('profiles')
        .select('id,nickname,handicap_index')
        .ilike('nickname', '%' + escaped + '%')
        .order('nickname').limit(15);
      if (error) throw error;
      setMatches((data || []).filter(p => p.id !== user.id && !selected.some(s => s.id === p.id)));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Vyhledávání se nezdařilo.');
    } finally {
      setSearchBusy(false);
    }
  }

  function addPlayer(player: Player) {
    if (selected.length >= 3) return;
    if (parseHandicap(player.handicap_index) === null) {
      setSearchError('Tento hráč nemá platný handicap. Musí ho nejprve uložit ve svém profilu.');
      return;
    }
    setSelected(prev => prev.some(p => p.id === player.id) ? prev : [...prev, player]);
    setMatches(prev => prev.filter(p => p.id !== player.id));
    setSearchError('');
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!course || !tee) {
      setError('Vyber hřiště a odpaliště.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: { user }, error: authError } = await supabase().auth.getUser();
      if (authError || !user) throw new Error('Nejprve se přihlas.');

       // Databázový profil je primární zdroj HCP.
       const { data: profile, error: profileError } = await supabase()
         .from('profiles').select('handicap_index').eq('id', user.id).maybeSingle();
       if (profileError) throw profileError;
       const metadata = user.user_metadata || {};
       const handicap = parseHandicap(profile?.handicap_index) ?? parseHandicap(
         metadata.handicap_index ?? metadata.hcp ?? metadata.handicap
       );

      if (handicap === null) {
        throw new Error('V profilu není dostupný platný HCP. Otevři svůj profil, ulož handicap a zkus vytvořit hru znovu.');
      }

      const { data: game, error: gameError } = await supabase().from('games')
        .insert({
          organizer_id: user.id,
          name: name.trim(),
          play_date: date,
          course_id: course,
          tee_id: tee,
          holes_count: count,
          scoring,
          status: 'planned',
        })
        .select('id')
        .single();
      if (gameError) throw gameError;

       const participants = [
         { game_id: game.id, player_id: user.id, flight_number: 1, handicap_snapshot: handicap },
         ...selected.map(player => ({
           game_id: game.id,
           player_id: player.id,
           flight_number: 1,
           handicap_snapshot: parseHandicap(player.handicap_index)!,
         })),
       ];
       const { error: memberError } = await supabase().from('game_players').insert(participants);
       if (memberError) {
         // Pokus o odstranění neúplné hry; pokud RLS smazání nepovolí, chybu zobrazíme.
         const { error: cleanupError } = await supabase().from('games').delete().eq('id', game.id);
         throw new Error(memberError.message + (cleanupError ? ' Hru se nepodařilo automaticky odstranit: ' + cleanupError.message : ''));
       }
      router.push('/games/' + game.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hru se nepodařilo vytvořit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <p className="brand">LONY GOLF SCORECARD</p>
      <div className="panel">
        <h1>Nová hra</h1>
        <form onSubmit={submit}>
          <label className="field">Název hry
            <input required maxLength={100} value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field">Datum
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} />
          </label>
          <label className="field">Golfové hřiště
            <select required value={course} onChange={e => setCourse(e.target.value)}>
              <option value="">Vyber hřiště</option>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="field">Odpaliště
            <select required value={tee} onChange={e => setTee(e.target.value)}>
              <option value="">Vyber odpaliště</option>
              {tees.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">Počet jamek
            <select value={count} onChange={e => setCount(Number(e.target.value))}>
              <option value={18}>18 jamek</option>
              <option value={9}>9 jamek (prvních devět)</option>
            </select>
          </label>
          <label className="field">Způsob hry
            <select value={scoring} onChange={e => setScoring(e.target.value)}>
              <option value="stableford">Stableford</option>
              <option value="stroke">Na rány</option>
            </select>
          </label>
          <section aria-label="Spoluhráči" style={{ marginTop: 18, marginBottom: 18 }}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: 8 }}>Spoluhráči ({selected.length}/3)</h2>
            <p className="muted">Ty jsi prvním hráčem. Do stejného flightu můžeš přidat až tři další registrované hráče podle přezdívky.</p>
            <label className="field">Vyhledat podle přezdívky
              <input
                type="search"
                value={search}
                onChange={e => { setSearch(e.target.value); setMatches([]); setSearchError(''); }}
                placeholder="Např. Petr"
                minLength={2}
                disabled={busy || selected.length >= 3}
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              onClick={findPlayers}
              disabled={busy || searchBusy || selected.length >= 3 || search.trim().length < 2}
              style={{ marginTop: 8 }}
            >
              {searchBusy ? 'Hledám…' : 'Najít spoluhráče'}
            </button>
            {searchError && <p className="error" role="alert">{searchError}</p>}
            {matches.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <p className="muted">Nalezení hráči:</p>
                {matches.map(player => (
                  <div key={player.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <span>{player.nickname} · HCP {player.handicap_index ?? 'neuveden'}</span>
                    <button type="button" onClick={() => addPlayer(player)} disabled={busy || selected.length >= 3}>Přidat</button>
                  </div>
                ))}
              </div>
            )}
            {selected.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <p><strong>Vybraní spoluhráči:</strong></p>
                {selected.map(player => (
                  <div key={player.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                    <span>{player.nickname} · HCP {player.handicap_index}</span>
                    <button type="button" onClick={() => setSelected(prev => prev.filter(p => p.id !== player.id))} disabled={busy}>Odebrat</button>
                  </div>
                ))}
              </div>
            )}
          </section>
          {courses.length === 0 && <p className="muted">Seznam hřišť je prázdný. Hřiště musí být nejprve vložena s ověřenými parametry.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn secondary" disabled={busy}>{busy ? 'Ukládám…' : 'Vytvořit hru'}</button>
        </form>
        <Link href="/games">← Zpět na moje hry</Link>
      </div>
    </main>
  );
}
