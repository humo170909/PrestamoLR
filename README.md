# Login + Panel LRomero

1. `npm install`
2. `cp .env.example .env.local` y completa los valores de Supabase (ver `docs/ARQUITECTURA.md`)
3. `npm run dev`  ->  http://localhost:3000

Scripts: `npm test` (lógica financiera), `npm run test:db` (migraciones y RLS), `npm run lint`, `npm run typecheck`, `npm run build`.

Sin Supabase el acceso está cerrado. Solo para ver la UI en local: `NEXT_PUBLIC_ENABLE_DEMO_AUTH=true` en `.env.local`
habilita admin@lromero.com / Admin12345 y cobrador@lromero.com / Cobrador123 (datos ficticios, con banner).

Imágenes del login: `public/images/fondo1.png`, `fondo2.png`, `fondo3.png`.
