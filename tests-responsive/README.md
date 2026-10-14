# Prueba responsive en navegador real

Mide, en 8 anchos (320–1440 px), desbordes horizontales, controles táctiles pequeños, el menú móvil, los modales y errores de consola
recorriendo las 14 pantallas del panel. Usa un **Supabase de prueba local** (`mock-supabase.mjs`, datos ficticios solo para estas pruebas).

```bash
# una sola vez (no se añade al package.json): 
npm i --no-save playwright && npx playwright install chromium

# 1) servidor de prueba y compilación apuntando a él
node tests-responsive/mock-supabase.mjs &
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=test SUPABASE_SERVICE_ROLE_KEY=test CRON_SECRET=x npm run build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399 NEXT_PUBLIC_SUPABASE_ANON_KEY=test SUPABASE_SERVICE_ROLE_KEY=test CRON_SECRET=x npx next start -p 3100 &

# 2) medir (capturas en ./shots)
OUT=shots node tests-responsive/run.mjs
```
Después recompila sin esas variables antes de desplegar (`rm -rf .next && npm run build`).

## Listas con más de 1 000 filas (A-03)
`MOCK_BIG=2500 node tests-responsive/mock-supabase.mjs` añade 2 500 clientes, préstamos y pagos y emula el tope de 1 000 filas por respuesta de PostgREST.
Con la app compilada y arrancada contra ese mock (mismas variables que arriba, `-p 3100`): `MOCK_BIG=2500 node tests-responsive/big-lists.mjs`.

## Middleware (M-06)
Con la app compilada y arrancada contra el mock: `PW_CHANNEL=chrome node tests-responsive/middleware-check.mjs` (error de perfil → 503 sin cerrar sesión; perfil inactivo/inexistente → cierra sesión; sin sesión → login).
Sin variables de Supabase el panel ya no queda abierto: compilar sin `NEXT_PUBLIC_SUPABASE_*` y comprobar que `/dashboard` redirige a `/` y `/api/*` responde 503.

## Lote 2
Todos usan la app compilada contra el mock (`PW_CHANNEL=chrome node tests-responsive/<script>.mjs`):
- `csp-check.mjs`: CSP en modo informe, sin `X-Powered-By`, `/api/*` sin sesión → 401 JSON, 15 pantallas sin violaciones.
- `alerts-check.mjs`: la campana del administrador avisa si el cron no se ejecutó hoy pasadas las 09:00 de Lima.
- `nav-check.mjs`: menú filtrado por rol, mensajes y casilla accesible (B-04/B-05/B-06/B-11/M-03).
El mock acepta `/__runs?mode=empty|today`, `/__role?r=admin|advisor|collector`, `/__fail?on=1`, `/__profile?mode=ok|inactive|missing`.
