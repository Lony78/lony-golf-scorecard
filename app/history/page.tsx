'use client';

import Link from 'next/link';

export default function HistoryPage() {
  return (
    <main>
      <p className="brand">LONY GOLF SCORECARD</p>

      <div className="panel">
        <h1>Historie her</h1>
        <p className="muted">
          Zde bude přehled tvých dokončených golfových her.
        </p>

        <Link href="/dashboard">
          ← Zpět na hlavní stránku
        </Link>
      </div>
    </main>
  );
}
