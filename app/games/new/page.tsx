'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Course = { id: string; name: string };
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

      // Profil v současné verzi může ukládat HCP do auth.user_metadata.
      // Databázový profil použijeme jako záložní zdroj.
      const metadata = user.user_metadata || {};
      const metadataHcp = parseHandicap(
        metadata.handicap_index ?? metadata.hcp ?? metadata.handicap
      );
      let handicap = metadataHcp;

      if (handicap === null) {
        const { data: profile, error: profileError } = await supabase()
          .from('profiles')
          .select('handicap_index')
          .eq('id', user.id)
          .maybeSingle();
        if (!profileError) handicap = parseHandicap(profile?.handicap_index);
      }

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

      const { error: memberError } = await supabase().from('game_players')
        .insert({
          game_id: game.id,
          player_id: user.id,
          flight_number: 1,
          handicap_snapshot: handicap,
        });
      if (memberError) {
        await supabase().from('games').delete().eq('id', game.id);
        throw memberError;
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
          <p className="muted">V této první verzi se do hry automaticky přidáš jako první hráč. Přidávání dalších hráčů připravujeme.</p>
          {courses.length === 0 && <p className="muted">Seznam hřišť je prázdný. Hřiště musí být nejprve vložena s ověřenými parametry.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn secondary" disabled={busy}>{busy ? 'Ukládám…' : 'Vytvořit hru'}</button>
        </form>
        <Link href="/games">← Zpět na moje hry</Link>
      </div>
    </main>
  );
}
