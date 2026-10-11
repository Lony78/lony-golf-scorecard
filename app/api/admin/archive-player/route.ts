import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !publicKey || !serviceKey) {
    return NextResponse.json({ error: 'Chybí konfigurace serveru.' }, { status: 500 });
  }

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return NextResponse.json({ error: 'Chybí přihlášení.' }, { status: 401 });

  const authClient = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: 'Neplatné přihlášení.' }, { status: 401 });
  }

  const { data: actor, error: actorError } = await adminClient
    .from('profiles').select('id,is_admin,is_archived').eq('id', user.id).maybeSingle();
  if (actorError || !actor || actor.is_admin !== true || actor.is_archived === true) {
    return NextResponse.json({ error: 'Nemáte administrátorské oprávnění.' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný požadavek.' }, { status: 400 });
  }
  const playerId = typeof body === 'object' && body !== null && 'playerId' in body
    ? (body as { playerId?: unknown }).playerId : undefined;
  if (typeof playerId !== 'string' || !uuidPattern.test(playerId)) {
    return NextResponse.json({ error: 'Neplatné ID hráče.' }, { status: 400 });
  }
  if (playerId === user.id) {
    return NextResponse.json({ error: 'Vlastní účet nelze zrušit.' }, { status: 403 });
  }

  const { data: target, error: targetError } = await adminClient
    .from('profiles').select('id,is_admin,is_archived').eq('id', playerId).maybeSingle();
  if (targetError) {
    return NextResponse.json({ error: 'Nepodařilo se ověřit hráče.' }, { status: 500 });
  }
  if (!target) return NextResponse.json({ error: 'Hráč neexistuje.' }, { status: 404 });
  if (target.is_admin === true) {
    return NextResponse.json({ error: 'Administrátorský účet nelze zrušit.' }, { status: 403 });
  }

  // Archivovaný profil lze zpracovat znovu, pokud předchozí odstranění přihlášení selhalo.
  if (target.is_archived !== true) {
    const { data: archived, error: archiveError } = await adminClient
      .from('profiles')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', playerId)
      .eq('is_admin', false)
      .eq('is_archived', false)
      .select('id')
      .maybeSingle();
    if (archiveError || !archived) {
      return NextResponse.json({ error: 'Archivace hráče se nezdařila. Zkus obnovit seznam.' }, { status: 409 });
    }
  }

  // Opakované spuštění: pokud účet již neexistuje, archivace je dokončená.
  const { data: authRecord, error: lookupError } = await adminClient.auth.admin.getUserById(playerId);
  if (lookupError) {
    // Supabase Auth vrací 404 pro neexistujícího uživatele.
    if (lookupError.status === 404) {
      return NextResponse.json({ success: true, alreadyDeleted: true });
    }
    return NextResponse.json({ error: 'Profil je archivovaný, ale stav přihlášení se nepodařilo ověřit. Zkus akci opakovat.' }, { status: 502 });
  }
  if (!authRecord.user) {
    return NextResponse.json({ success: true, alreadyDeleted: true });
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(playerId);
  if (deleteError) {
    return NextResponse.json({ error: 'Profil je archivovaný, ale přihlašovací účet nebyl odstraněn. Zkus akci opakovat.' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
