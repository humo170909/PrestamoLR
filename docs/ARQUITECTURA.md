# LRomero Préstamos — arquitectura

> Actualizado tras la auditoría (informe en `auditoria-output/`) y los lotes de correcciones 1 y 2. Las reglas de dinero están en `REGLAS_FINANCIERAS.md`.

## Modelo financiero
Tasa en puntos básicos y dinero en céntimos enteros (`lib/finance/`, módulo puro y probado con `npm test`). Hay **tres modalidades**:

| Modalidad | Interés de cada período |
|---|---|
| Cuotas fijas | capital **original** × tasa del período; capital en partes iguales (el último absorbe los céntimos) |
| Solo intereses + abonos | capital **original** × tasa; el capital vence en la última cuota y admite abonos |
| **Abierto (sin plazo)** | capital **pendiente** × tasa: (capital original − capital confirmado abonado antes del vencimiento del período) × tasa; los períodos ya vencidos o cobrados quedan congelados |

| Operación | Efecto |
|---|---|
| Pago de intereses | Se imputa a `interest_paid` de los vencimientos más antiguos. `principal_outstanding` **no cambia**. |
| Devolución de capital | Se imputa al capital programado **más antiguo** pendiente (cuotas fijas / solo intereses); en préstamos abiertos, o cuando excede lo programado, reduce directamente el capital pendiente. `principal` (original) no cambia. |
| Excedente de intereses | Rechazado por `register_payment` (decisión pendiente: saldo a favor). |
| Reversión | Solo admin, con motivo (mínimo 5 caracteres). Marca el pago, deshace la imputación, contra-asienta la caja y reabre el préstamo si estaba pagado. Nada se borra. |
| Cobro duplicado | `idempotency_key` única + bloqueo de la fila del préstamo (`FOR UPDATE`). Reusar una clave con **otro préstamo o importes distintos** da error; con los mismos datos devuelve el pago original. |

## Capas
- `lib/finance/` — cálculo (puro, probado). `lib/reminders/` — avisos de Telegram. `lib/data/` — acceso a Supabase desde el navegador (RLS del usuario).
- `lib/supabase/` — `config.ts` (estado), `client.ts` (navegador), `server.ts` (SSR), `admin.ts` (service_role, solo servidor), `access.ts` (decisión de acceso del middleware, pura).
- `middleware.ts` protege las rutas **en el servidor** (ver "Acceso y sesión").
- `lib/auth.ts` — Supabase Auth; el rol sale de `public.profiles`. Usuarios demo solo con `NEXT_PUBLIC_ENABLE_DEMO_AUTH=true`, sin Supabase y fuera de producción.
- `lib/nav.ts` + `lib/nav-access.ts` — menú **filtrado por rol** (solo interfaz; la protección real es RLS y las funciones de la base de datos).
- `lib/log.ts` — logs estructurados (una línea JSON por evento) sin tokens, claves, DNI ni teléfonos.
- `components/panel/DataSourceNotice.tsx` — banner "datos de demostración" / estado "sin datos todavía".

## Estado de los módulos (con Supabase configurado)
| Módulo | Estado |
|---|---|
| Login / sesión | Supabase Auth; middleware valida sesión y perfil activo en servidor. Sin recuperación de contraseña por correo todavía: "¿Olvidaste tu contraseña?", "Contáctanos" y "Ayuda" abren ventanas informativas |
| Dashboard, Morosidad | Reales (vista `v_loan_portfolio`, hora de Lima). La campana de alertas avisa al **administrador** si no hay ejecución del cron de avisos hoy pasadas las 09:00 de Lima |
| Nuevo préstamo | Real (`create_loan`, idempotente; valida capital con máx. 2 decimales, tasa con máx. 4 y fecha de desembolso entre 2000-01-01 y un año desde hoy) |
| Lista de préstamos, Clientes | Reales, paginados (ver "Datos y paginación") |
| Registro de pagos (+ reversión admin) | Reales (`register_payment`, `reverse_payment`) |
| Caja, Reportes | Reales (capital e intereses separados); los reportes concilian lo cargado con `report_totals()` |
| Auditoría, Usuarios, Trabajadores, Configuración | Reales, solo administrador |
| Simulador | Cálculo local, no guarda |

Sin Supabase el panel **no queda abierto**: solo el login es público (y el modo demostración de desarrollo); `/api/*` responde 503 y las páginas redirigen a `/`. Con `lib/mock.ts` solo se ve la interfaz de demostración.

## Acceso y sesión (`middleware.ts`)
- Sin sesión: las páginas redirigen a `/` y las rutas `/api/*` responden **401 JSON** (excepto `/api/cron/*` y `/api/csp-report`, que no pasan por el middleware).
- Perfil **inactivo o inexistente**: se cierra la sesión.
- **Error de infraestructura** (Auth o consulta de perfil caída): responde **503** con página de reintento y **conserva la sesión** (no se cierra a nadie por una caída breve).
- Cada petición hace dos llamadas a Supabase (`auth.getUser` + `profiles`).

## Datos y paginación
PostgREST corta cada respuesta en 1 000 filas (`max_rows`) sin avisar. `lib/data/paginate.ts` lee **paginado** con conteo exacto (`count: "exact"`, `.range()` desde las filas ya recibidas y orden estable con `id`) hasta un tope de seguridad de 20 000 filas por consulta; si el total supera lo cargado, la interfaz muestra un aviso visible. Se usa en lista de préstamos, clientes, selectores y reportes. Los reportes se calculan en el navegador sobre datos completos y **se concilian con `report_totals()`** (SQL, fuente de verdad); si no coinciden, muestran un aviso. El dashboard (`v_loan_portfolio`) ya se paginaba.

## Migraciones (aplicar en orden; 19 migraciones)
`20261008000000_init_core` · `20261008000100_create_loan` · `20261008000200_portfolio_view` · `20261008000300_settings` · `20261008000400_lima_timezone` · `20261008000500_notifications` · `20261008000600_telegram_settings` · `20261008000700_totals_status_collectors` · `20261012000000_loan_types` · `20261012000100_reports_closing` · `20261012000200_open_interest_on_outstanding` · `20261012000300_cancel_loan` · `20261012000400_client_edit_guard` · `20261012000500_telegram_alerts` · `20261012000600_notification_runs` · `20261012000700_runs_hourly` · `20261012000800_hardening_perf` · `20261013000900_audit_fixes_1` · `20261013001000_audit_fixes_2`.

- **No borran filas financieras**, pero tampoco son "puramente aditivas": incluyen `DROP FUNCTION` (se recrean `create_loan` y `register_payment` con otra firma), `DROP CONSTRAINT/TRIGGER/VIEW` y `UPDATE` de relleno (`paid_on`, `closed_on`). **Aplícalas todas, en orden, ANTES de desplegar el código**: con el código nuevo sobre una base sin migrar fallan altas y cobros.
- No son re-ejecutables salvo `…000800`, `…000900` y `…001000` (idempotentes). Usa el historial de migraciones (Supabase CLI) y no las pegues dos veces a mano.
- `…000900` (lote 1): privilegios de `v_loan_portfolio` y de funciones auxiliares, `monthly_cash()` sin cobros revertidos y **sin escrituras directas sobre `loans`** (solo las funciones `SECURITY DEFINER` escriben). `…001000` (lote 2): columna generada `installments.is_unpaid` (+ índice parcial) para el cron, e idempotencia/validaciones de `register_payment` y `create_loan`.
- Verificación: `npm run test:db` ejecuta todas en un Postgres local (PGlite): `db.test.mjs`, `repair.test.mjs`, `audit-fixes.test.mjs` y `audit-fixes-2.test.mjs` (más de 190 comprobaciones de reglas, RLS y privilegios).
- Cierre automático: un préstamo con capital e intereses totalmente cobrados pasa a `paid_off`; si se revierte un pago y vuelve a deber, regresa a `active` (triggers).
- Totales en SQL (`report_totals`, `monthly_cash`, `worker_stats`); `list_collectors` permite al asesor asignar cobrador.

## Variables de entorno
| Variable | Obligatoria | Dónde |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Sí | local y Vercel (se incorporan **al compilar**: cambiarlas exige redesplegar) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Sí** (obligatoria): alta de usuarios, Telegram, avisos de pago y cron | solo servidor; nunca con `NEXT_PUBLIC_`; salta RLS |
| `CRON_SECRET` | Sí (sin él el cron responde 503) | solo servidor |
| `TELEGRAM_ENCRYPTION_KEY` (64 hex) | Sí para guardar el token desde el panel | solo servidor; si se pierde o cambia hay que reescribir el token |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | No (respaldo) | solo servidor |
| `NEXT_PUBLIC_SUPPORT_CONTACT` | No | texto de «Contáctanos» en el login |
| `NEXT_PUBLIC_ENABLE_DEMO_AUTH` | No definir en producción (`false`) | solo desarrollo sin Supabase |

## Seguridad web
Cabeceras en `next.config.ts`: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` y **`Content-Security-Policy-Report-Only`** (`lib/csp.ts`; solo informa, no bloquea). Las violaciones llegan a `/api/csp-report` y quedan en los logs como `csp_violation`. La política aún permite scripts y estilos en línea (Next, framer-motion, recharts): para pasar a modo bloqueante hace falta nonces. `X-Powered-By` desactivado. Las exportaciones CSV neutralizan fórmulas de Excel (`= + - @`).

## Observabilidad
`lib/log.ts` escribe una línea JSON por evento (`cron_started`, `job_finished`, `telegram_delivery_failed`, `pending_fetch_failed`, `run_record_failed`, `auth_unavailable`, `csp_violation`…) con campos sensibles redactados (tokens, claves, DNI, teléfonos, nombres; el chat solo con sus últimos 4 dígitos). Se leen en Vercel Logs. Cada ejecución del cron queda además en `notification_runs`.

## Antes de subir / desplegar
- Subir solo la carpeta `lromero-login`. `.gitignore` y `.vercelignore` excluyen `.env*` (salvo `.env.example`), `supabase/seed/` (contiene contraseñas iniciales: cámbialas) y `auditoria-output/`.
- Cargar las variables en el panel de Vercel y aplicar las migraciones antes que el código.
- Scripts: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`. Pruebas de navegador: `tests-responsive/` (ver su README).
- No ejecutar `npm run build` con `npm run dev` abierto (comparten `.next`).

## Decisiones pendientes
1. Tasa por período de pago (hoy) o mensual prorrateada; interés sobre capital original o sobre saldo (cuotas fijas y solo intereses).
2. Pagos de más: hoy se rechazan (alternativas: saldo a favor / siguiente vencimiento).
3. Multa por mora y días de gracia: reglas de cálculo (hoy se guardan pero **no se aplican**).
4. Capital anticipado: ¿autorización del administrador?
5. Cobrador: ¿puede registrar pagos sin aprobación? (hoy sí, solo de sus clientes).
6. Refinanciación y prórroga (`loan_events.authorized_by`).
7. Respaldo programado de la base antes de operar con dinero real.
8. Abonos de capital con fecha retroactiva en préstamos abiertos (los períodos ya generados no se recalculan).
9. Recuperación de contraseña por correo.

## Recordatorios por Telegram
- Lógica pura y probada: `lib/reminders/build.ts` (importes **pendientes reales**: interés/capital de cada vencimiento menos lo ya pagado; atrasado de períodos anteriores aparte).
- Lectura de cuotas: **una sola consulta por ejecución** (compartida por todos los avisos del trabajo), filtrada en SQL con `installments.is_unpaid` (solo cuotas con algo pendiente).
- Envío: `lib/reminders/telegram.ts` (3 reintentos solo en fallos transitorios; el token nunca se registra). Orquestación y deduplicación: `lib/reminders/dispatch.ts` (clave `tipo:fecha:chat` reservada en `notification_log` antes de enviar; hasta 3 intentos por clave; semántica "al menos una vez").
- Rutas: `/api/cron/reminders?job=morning|evening` (Vercel Cron, `Authorization: Bearer CRON_SECRET`, comparación en tiempo constante en `lib/cron-auth.ts`) y `/api/admin/telegram` (solo administrador: comprobar, prueba, enviar ahora, historial). Panel: Configuración > Recordatorios por Telegram.
- `vercel.json`: 13:00 UTC (08:00 Lima) hoy + vencidos; 23:00 UTC (18:00 Lima) mañana + próximos 7 días + cierre del día. **Hobby permite 2 crons diarios pero no garantiza la hora exacta** (la ejecución puede caer dentro de la hora indicada, "ventana de 1 h"); por eso la alerta del panel espera hasta las 09:00 de Lima. En Pro se pueden añadir ejecuciones extra de reintento (es idempotente).
- Independiente de los pagos: el job solo lee cronogramas y escribe `notification_log`; registrar un pago nunca llama a Telegram.

### Configuración de Telegram desde el panel
- Configuración > Recordatorios por Telegram: token del bot, chat ids, activar/desactivar y qué avisos enviar (hoy, vencidos, mañana).
- El token se verifica con Telegram (`getMe`) antes de guardarse y se almacena **cifrado** (AES-256-GCM, `TELEGRAM_ENCRYPTION_KEY`) en `telegram_settings`, tabla sin acceso para `anon`/`authenticated`: solo el servidor (service_role) la lee. Nunca se devuelve al navegador, ni cifrado.
- Prioridad: lo guardado en el panel > variables de entorno (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, respaldo). Si la clave de cifrado cambia, se usa el respaldo y se registra `telegram_decrypt_failed`.
- Cada cambio se audita (sin secretos). Los horarios los fija `vercel.json` (Vercel Cron no los lee de la base de datos).
