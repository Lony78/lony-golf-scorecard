# LONY GOLF SCORECARD – verze 0.2

## Co je hotové
- Zachované přihlášení, registrace, profil.
- Moje hry, vytvoření hry, výběr hřiště a odpaliště ze Supabase.
- Scorekarta jednoho hráče, zapisování ran 1–30 / X / prázdná jamka, uložení do databáze.
- Potvrzení dokončení, kontrola úplnosti skóre.
- Stableford pouze pro 18 jamek s kompletním CR/Slope/PAR/SI; jinak se body nezobrazují.

## Co ještě není hotové
- Přidávání dalších hráčů, flighty a společné zadávání výsledků.
- Automatický import golfových hřišť, 9jamkový WHS, offline režim, žebříček.
- Dokončení právních textů, bezpečnostní audit před veřejným provozem.

## Nasazení (bez změny přihlášení)
1. Supabase → SQL Editor → New query → vložit obsah `supabase/phase2.sql` → Run. **Jen pokud již dříve běžel `schema.sql`.**
2. Pokud v Supabase nejsou golfová hřiště, vložit ověřené údaje do `courses`, `course_tees`, `holes` (bez vymyšlených CR/Slope/SI).
3. GitHub → repozitář → Add file → Upload files. Nahraj obsah složek `app` a `supabase` z tohoto ZIP, zachovej jejich cesty. Alternativně GitHub Desktop.
4. Commit changes. Vercel provede nové nasazení. Ověřit stav Ready.
5. Přihlásit se → Moje hry → Nová hra → vybrat hřiště → uložit → scorekarta.

## Poznámka k oprávněním
Jde o první vývojový prototyp. Před přidáním více hráčů je potřeba zpevnit databázová oprávnění a audit, zejména aby hráč nemohl měnit cizí výsledky a dokončení bylo vynuceno i v databázi.
