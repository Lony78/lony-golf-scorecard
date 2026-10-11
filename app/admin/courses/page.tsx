'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

type Row = Record<string, unknown>;
type Status = 'loading' | 'allowed' | 'denied' | 'error';
const asText = (value: unknown) => value === null || value === undefined ? '' : String(value);
const formatNumber = (value: unknown) => {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? '—' : number.toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
};
const holeNumber = (hole: Row) => Number(hole.hole_number ?? hole.number ?? hole.hole_no ?? hole.hole ?? 0);
const strokeIndex = (hole: Row) => hole.stroke_index ?? hole.si ?? hole.handicap ?? hole.hcp ?? null;
const holeLength = (hole: Row) => hole.length_m ?? hole.length_meters ?? hole.length ?? hole.distance_m ?? hole.distance ?? null;

export default function AdminCoursesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [courses, setCourses] = useState<Row[]>([]);
  const [tees, setTees] = useState<Row[]>([]);
  const [holes, setHoles] = useState<Row[]>([]);
  const [expandedTee, setExpandedTee] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const db = supabase();
        const { data: { user }, error: authError } = await db.auth.getUser();
        if (authError) throw authError;
        if (!user) { router.replace('/login'); return; }
        const { data: allowed, error: permissionError } = await db.rpc('is_admin');
        if (permissionError) throw permissionError;
        if (allowed !== true) { if (active) setStatus('denied'); return; }
        const [coursesResult, teesResult, holesResult] = await Promise.all([
          db.from('courses').select('*').limit(1000),
          db.from('tees').select('*').limit(1000),
          db.from('holes').select('*').limit(5000),
        ]);
        if (coursesResult.error) throw coursesResult.error;
        if (teesResult.error) throw teesResult.error;
        if (holesResult.error) throw holesResult.error;
        if (!active) return;
        setCourses((coursesResult.data ?? []) as Row[]);
        setTees((teesResult.data ?? []) as Row[]);
        setHoles((holesResult.data ?? []) as Row[]);
        setStatus('allowed');
      } catch (error) {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : 'Data hřišť se nepodařilo načíst.');
        setStatus('error');
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  const sortedCourses = useMemo(() => [...courses].sort((a, b) => asText(a.name).localeCompare(asText(b.name), 'cs')), [courses]);

  return <main className="lony-courses">
    <style>{`
      .lony-courses { max-width:760px; min-height:100dvh; padding:22px 16px 48px; box-sizing:border-box; color:#f6faf5; background:linear-gradient(155deg,#0b271a,#174631); }
      .lony-courses a { text-decoration:none; }
      .lony-courses .panel { margin-top:20px; padding:20px 16px; background:#f5f8f2; color:#173d2b; border-radius:20px; }
      .lony-courses .course { padding:14px 0; border-bottom:1px solid #d9e6dc; }
      .lony-courses .course:last-child { border-bottom:0; }
      .lony-courses .tee { background:#ebf2e9; border:1px solid #d1e1d2; border-radius:13px; margin-top:10px; padding:12px; }
      .lony-courses .tee-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
      .lony-courses .tee-title { font-size:15px; font-weight:700; }
      .lony-courses .muted { color:#667f6e; font-size:13px; }
      .lony-courses button { cursor:pointer; border:1px solid #b9d5bf; border-radius:9px; padding:9px 12px; background:#e1ede4; color:#19542f; font:inherit; font-size:13px; font-weight:700; }
      .lony-courses button:focus-visible { outline:3px solid #548c63; outline-offset:2px; }
      .lony-courses .table-scroll { overflow-x:auto; margin-top:14px; }
      .lony-courses table { width:100%; border-collapse:collapse; font-size:12px; white-space:nowrap; }
      .lony-courses th, .lony-courses td { padding:9px 8px; border-bottom:1px solid #d1e1d2; text-align:right; }
      .lony-courses th:first-child, .lony-courses td:first-child { text-align:left; }
      .lony-courses th { color:#436b50; }
    `}</style>
    <Link href="/admin" style={{ color:'#d4e8d6', fontSize:14 }}>← Zpět do administrace</Link>
    <p style={{ margin:'25px 0 7px', fontSize:12, letterSpacing:2, fontWeight:700 }}>LONY GOLF SCORECARD</p>
    <h1 style={{ margin:'0 0 8px', fontSize:32 }}>Golfová hřiště</h1>
    <p style={{ color:'#d0e6d4' }}>Správa hřišť · Přehled pouze pro čtení</p>
    {status === 'loading' && <p>Ověřuji oprávnění a načítám hřiště…</p>}
    {status === 'denied' && <p role="alert">K této stránce nemáš administrátorské oprávnění.</p>}
    {status === 'error' && <p role="alert">Načtení se nezdařilo: {errorMessage}</p>}
    {status === 'allowed' && <section className="panel">
      <h2 style={{ margin:'0 0 5px', fontSize:21 }}>Registrovaná hřiště</h2>
      <p className="muted" style={{ margin:'0 0 14px' }}>Načteno {courses.length} hřišť, {tees.length} odpališť a {holes.length} jamek.</p>
      {sortedCourses.map(course => {
        const courseTees = tees.filter(tee => asText(tee.course_id) === asText(course.id));
        return <div className="course" key={asText(course.id)}>
          <h3 style={{ margin:'0 0 5px', fontSize:18 }}>{asText(course.name) || 'Nepojmenované hřiště'}</h3>
          <p className="muted" style={{ margin:'0 0 10px' }}>{courseTees.length} odpališť</p>
          {courseTees.map(tee => {
            const teeId = asText(tee.id);
            const teeHoles = holes.filter(hole => asText(hole.tee_id) === teeId).sort((a,b) => holeNumber(a) - holeNumber(b));
            const par = teeHoles.reduce((total, hole) => total + (Number(hole.par) || 0), 0);
            const expanded = expandedTee === teeId;
            return <div className="tee" key={teeId}>
              <div className="tee-head">
                <div>
                  <div className="tee-title">{asText(tee.name) || 'Odpaliště'}</div>
                  <div className="muted">CR {formatNumber(tee.course_rating)} · SR {formatNumber(tee.slope_rating)} · PAR {teeHoles.length ? par : '—'} · {teeHoles.length} jamek</div>
                </div>
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedTee(expanded ? null : teeId)}>{expanded ? 'Zavřít' : 'Jamky'}</button>
              </div>
              {expanded && <div className="table-scroll">
                <table>
                  <thead><tr><th>Jamka</th><th>PAR</th><th>SI</th><th>Délka (m)</th></tr></thead>
                  <tbody>{teeHoles.map((hole, index) => <tr key={asText(hole.id) || String(index)}>
                    <td>{holeNumber(hole) || index + 1}</td><td>{formatNumber(hole.par)}</td><td>{formatNumber(strokeIndex(hole))}</td><td>{formatNumber(holeLength(hole))}</td>
                  </tr>)}</tbody>
                </table>
                {teeHoles.length === 0 && <p className="muted">Pro toto odpaliště nejsou dostupné jamky.</p>}
              </div>}
            </div>;
          })}
        </div>;
      })}
      {courses.length === 0 && <p className="muted">Žádná hřiště nebyla nalezena.</p>}
    </section>}
  </main>;
}
