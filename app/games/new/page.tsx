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
  const [selected, setSelected] = useState<Player[]>([]);
  const [searchError, setSearchError] = useState('');
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [playersBusy, setPlayersBusy] = useState(false);
  const [playersError, setPlayersError] = useState('');
  const [showPlayerList, setShowPlayerList] = useState(false);
  const [activePlayerIds, setActivePlayerIds] = useState<string[]>([]);
  const [checkingActive, setCheckingActive] = useState(true);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [activeCheckError, setActiveCheckError] = useState('');

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

  useEffect(() => {
    let active = true;
    async function loadPlayers() {
      setPlayersBusy(true);
      setPlayersError('');
      try {
        const { data: { user }, error: authError } = await supabase().auth.getUser();
        if (authError || !user) throw new Error('Nejprve se přihlas.');
        const players: Player[] = [];
        const pageSize = 500;
        for (let start = 0; ; start += pageSize) {
          const { data, error } = await supabase().from('profiles')
            .select('id,nickname,handicap_index')
            .order('nickname').order('id')
            .range(start, start + pageSize - 1);
          if (error) throw error;
          const batch = data || [];
          players.push(...batch.filter(p => p.id !== user.id && Boolean(p.nickname)));
          if (batch.length < pageSize) break;
        }
        if (active) setAllPlayers(players);
      } catch (e) {
        if (active) setPlayersError(e instanceof Error ? e.message : 'Seznam hráčů se nepodařilo načíst.');
      } finally {
        if (active) setPlayersBusy(false);
      }
    }
    void loadPlayers();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    async function checkActive() {
      try {
        const client = supabase();
        const { data: { user }, error: authError } = await client.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }
        // Vlastní účast zjišťujeme samostatně; ostatní hráče může omezovat RLS.
        const { data: own, error: ownError } = await client.from('game_players')
          .select('game_id').eq('player_id', user.id).is('finished_at', null).limit(1);
        if (ownError) throw ownError;
        if (mounted) setActiveGameId(own?.[0]?.game_id ?? null);
        const { data, error } = await client.from('game_players')
          .select('player_id').is('finished_at', null);
        if (error) throw error;
        if (mounted) setActivePlayerIds((data || []).map(p => p.player_id));
      } catch (e) {
        if (mounted) setActiveCheckError('Aktivní hry se nepodařilo ověřit. Obnov stránku a zkus to znovu.');
      } finally { if (mounted) setCheckingActive(false); }
    }
    void checkActive();
    return () => { mounted = false; };
  }, [router]);

  // Seznam je načtený při otevření stránky; výsledky se mění ihned při psaní.
  const normalizedSearch = search.trim().toLocaleLowerCase('cs');
  const matchingPlayers = normalizedSearch.length > 0
    ? allPlayers.filter(player =>
        !selected.some(s => s.id === player.id) &&
        player.nickname.toLocaleLowerCase('cs').includes(normalizedSearch)
      ).sort((a, b) => a.nickname.localeCompare(b.nickname, 'cs', { sensitivity: 'base' })).slice(0, 15)
    : [];

  function addPlayer(player: Player) {
    if (selected.length >= 3) return;
    if (activePlayerIds.includes(player.id)) {
      setSearchError('Tento hráč už má aktivní hru a nelze ho přidat do dalšího flightu.');
      return;
    }
    if (parseHandicap(player.handicap_index) === null) {
      setSearchError('Tento hráč nemá platný handicap. Musí ho nejprve uložit ve svém profilu.');
      return;
    }
    setSelected(prev => prev.some(p => p.id === player.id) ? prev : [...prev, player]);
    setSearch('');
    setShowPlayerList(false);
    setSearchError('');
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (checkingActive || activeCheckError) { setError('Nepodařilo se ověřit aktivní hru. Obnov stránku.'); return; }
    if (activeGameId) { setError('Již máš aktivní hru. Nejdříve ji dokonči nebo opusť.'); return; }
    if (!course || !tee) {
      setError('Vyber hřiště a odpaliště.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { data: { user }, error: authError } = await supabase().auth.getUser();
      if (authError || !user) throw new Error('Nejprve se přihlas.');
      const { data: existing, error: existingError } = await supabase().from('game_players')
        .select('game_id').eq('player_id', user.id).is('finished_at', null).limit(1);
      if (existingError) throw existingError;
      if (existing?.length) { setActiveGameId(existing[0].game_id); throw new Error('Již máš aktivní hru. Nejdříve ji dokonči nebo opusť.'); }

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
         if (memberError.code === '23505' || memberError.message.includes('one_active_game_per_player')) {
           throw new Error('Ty nebo některý vybraný spoluhráč už máte aktivní hru. Nejdříve ji dokončete nebo opusťte.' + (cleanupError ? ' Nepodařilo se uklidit neúplný záznam hry.' : ''));
         }
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
        {checkingActive ? <p className="muted">Ověřuji aktivní hru…</p> : activeCheckError ? (
          <div role="alert"><p className="error">{activeCheckError}</p><button type="button" className="btn secondary" onClick={() => window.location.reload()}>Zkusit znovu</button></div>
        ) : activeGameId ? (
          <div role="status" style={{ padding: 16, borderRadius: 12, background: '#edf4ee', color: '#123d2b' }}>
            <h2 style={{ marginTop: 0 }}>Již máš aktivní hru</h2>
            <p>Nejdříve ji dokonči nebo opusť, potom můžeš vytvořit novou.</p>
            <Link href={'/games/' + activeGameId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', minHeight: 48, boxSizing: 'border-box', padding: '12px 16px', borderRadius: 10, background: '#123d2b', color: '#ffffff', fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>Přejít na aktivní hru</Link>
          </div>
        ) : <form onSubmit={submit}>
          <label className="field">Název hry
            <input required maxLength={100} value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="field">Datum
            <input
              className="new-game-date"
              type="date"
              required
              value={date}
              onChange={e => setDate(e.target.value)}
            />
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
            <p className="muted">Ty jsi prvním hráčem. Přidej až tři další registrované hráče.</p>
            <button
              type="button"
              className="btn secondary"
              aria-expanded={showPlayerList}
              aria-controls="registered-player-list"
              disabled={busy || selected.length >= 3}
              onClick={() => setShowPlayerList(open => !open)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 9, marginTop: 8, marginBottom: 10 }}
            >
              <span aria-hidden="true" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>⊕</span>
              {showPlayerList ? 'Zavřít seznam hráčů' : 'Přidat hráče'}
            </button>
            {showPlayerList && (
              <div id="registered-player-list" style={{ border: '1px solid #c8d8ce', borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <p style={{ margin: '0 0 10px', fontWeight: 700 }}>Registrovaní hráči (A–Z)</p>
                {playersBusy ? <p className="muted">Načítám hráče…</p> :
                  allPlayers.filter(p => !selected.some(s => s.id === p.id))
                    .sort((a, b) => a.nickname.localeCompare(b.nickname, 'cs', { sensitivity: 'base' }))
                    .map(player => (
                      <button
                        key={player.id}
                        type="button"
                        disabled={busy || selected.length >= 3}
                        onClick={() => addPlayer(player)}
                        style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 8px', marginBottom: 4, background: '#f1f6f2', border: '1px solid #dbe8de', borderRadius: 8, color: '#123d2b', textAlign: 'left', cursor: 'pointer' }}
                      >
                        <span style={{ overflowWrap: 'anywhere' }}>{player.nickname}</span>
                        <span style={{ flexShrink: 0, fontSize: 12 }}>HCP {player.handicap_index ?? '–'}　＋</span>
                      </button>
                    ))}
                {!playersBusy && allPlayers.filter(p => !selected.some(s => s.id === p.id)).length === 0 && !playersError &&
                  <p className="muted">Žádní další registrovaní hráči nejsou k dispozici.</p>}
              </div>
            )}
            {playersError && <p className="error" role="alert">{playersError}</p>}
            <p className="muted">Nebo použij vyhledávání:</p>
            <label className="field">Vyhledat podle přezdívky
              <input
                type="search"
                value={search}
                onChange={e => { setSearch(e.target.value); setSearchError(''); }}
                placeholder="Např. Petr"
                disabled={busy || selected.length >= 3}
              />
            </label>
            {searchError && <p className="error" role="alert">{searchError}</p>}
            {normalizedSearch.length > 0 && (
              <div style={{ marginTop: 10 }} aria-live="polite">
                {playersBusy ? <p className="muted">Načítám hráče…</p> :
                  matchingPlayers.length > 0 ? (
                    <div style={{ border: '1px solid #c8d8ce', borderRadius: 12, padding: 8 }}>
                      {matchingPlayers.map(player => (
                        <button
                          key={player.id}
                          type="button"
                          disabled={busy || selected.length >= 3 || activePlayerIds.includes(player.id)}
                          onClick={() => addPlayer(player)}
                          style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 8px', marginBottom: 4, background: '#f1f6f2', border: '1px solid #dbe8de', borderRadius: 8, color: '#123d2b', textAlign: 'left', cursor: 'pointer' }}
                        >
                          <span style={{ overflowWrap: 'anywhere' }}>{player.nickname}</span>
                          <span style={{ flexShrink: 0, fontSize: 12 }}>{activePlayerIds.includes(player.id) ? 'Aktivní hra' : `HCP ${player.handicap_index ?? '–'}　＋`}</span>
                        </button>
                      ))}
                    </div>
                  ) : !playersError ? <p className="muted">Žádný odpovídající hráč.</p> : null}
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
        </form>}
        <div style={{ marginTop: 22, marginBottom: 12 }}>
      <Link href="/games" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 9, minHeight: 44, padding: '10px 18px', borderRadius: 999, backgroundColor: '#e7f1ea', color: '#164b35', fontSize: 14, fontWeight: 650, textDecoration: 'none', lineHeight: 1.2, border: '1px solid #d5e6da', boxSizing: 'border-box' }}>
        <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>←</span>
        <span>Zpět na moje hry</span>
      </Link>
    </div>
        <style>{`
          /* Výběrové nabídky na PC: světlý systémový seznam i při tmavém motivu webu. */
          .panel .field select {
            color-scheme: light;
            background-color: #ffffff !important;
            color: #123d2b !important;
            -webkit-text-fill-color: #123d2b;
          }
          .panel .field select:hover,
          .panel .field select:focus {
            background-color: #f1f7f2 !important;
            color: #123d2b !important;
            -webkit-text-fill-color: #123d2b;
          }
          .panel .field select option {
            background-color: #ffffff;
            color: #123d2b;
          }
          .panel .field select option:checked {
            background-color: #dcecdf;
            color: #123d2b;
          }
          /* iOS Safari: datum nesmí mít vlastní minimální šířku ani přetékat z formuláře. */
          .field { min-width: 0; }
          .field input.new-game-date {
            display: block;
            width: 100%;
            min-width: 0;
            max-width: 100%;
            box-sizing: border-box;
            font-size: 16px;
            line-height: normal;
            -webkit-appearance: none;
            appearance: none;
            text-align: left;
          }
          .field input.new-game-date::-webkit-date-and-time-value {
            min-width: 0;
            text-align: left;
          }
          .field input.new-game-date::-webkit-datetime-edit { min-width: 0; }
        `}</style>
      </div>
    </main>
  );
}
