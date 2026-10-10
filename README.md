# LONY GOLF SCORECARD — první vývojový základ

Toto je **zdrojový prototyp**, nikoli nasazená nebo produkčně hotová aplikace.

## Spuštění

1. Nainstalujte Node.js 20.9+.
2. Ve složce projektu spusťte `npm install`.
3. V Supabase vytvořte nový testovací projekt a spusťte `supabase/schema.sql` v SQL Editoru.
4. Zkopírujte `.env.example` do `.env.local` a doplňte URL projektu a veřejný publishable/anon klíč. **Nikdy nevkládejte service_role klíč do NEXT_PUBLIC.**
5. V Supabase Auth nastavte Site URL na `http://localhost:3000`, zapněte e-mailové potvrzení a povolte redirect `http://localhost:3000/auth/callback`.
6. Spusťte `npm run dev`, otevřete `http://localhost:3000`.

## Co funguje
- Registrace přes e-mail/heslo a vytvoření profilu v databázi.
- Přihlášení, odhlášení, požadavek na reset hesla.
- Jednoduchý dashboard a úprava přezdívky/HCP v uživatelských metadatech.
- Počáteční databázové tabulky a RLS pro bezpečný vývoj.

## Důležitá omezení první verze
- **Potvrzovací callback je zatím pouze navigační placeholder**: pro plnou funkčnost e-mailového ověření je nutné implementovat výměnu tokenu/kódu za session pomocí Supabase SSR; výchozí Supabase e-mailové šablony mohou používat implicitní token flow.
- Obnova hesla zatím pouze odesílá e-mail, chybí obrazovka pro zadání nového hesla.
- Změny profilu se ukládají do auth metadata, ne do tabulky `profiles` (před pokračováním sjednotit).
- Biometrie/passkeys, offline režim, skutečné hry, scorekarty, zprávy a admin rozhraní **ještě nejsou implementovány**.
- Přístup do dashboardu je zatím chráněn klientskou kontrolou, ne serverovým middlewarem.
- Role Super Admin vyžaduje ruční bezpečné přiřazení na serveru; nesmí být volitelná při registraci.
- Před veřejným nasazením doplnit podmínky služby, zásady soukromí, správné RLS pro organizátora/flighty a testy.
