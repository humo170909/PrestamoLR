# Auditoría integral de LRomero

Fecha: 13/10/2026 · Alcance: código del repositorio `lromero-login` (Next.js 15, React 19, TypeScript, Tailwind 4, Supabase/PostgreSQL, Vercel).

> **Cómo leer este informe.** *Comprobado* = se reprodujo con una prueba automatizada o con una consulta al catálogo de la base de datos
> local (PGlite, que ejecuta las migraciones reales). *Sospecha* = razonable, pero no se pudo comprobar aquí. Lo que **no** se pudo
> ejecutar (navegador, Vercel, Telegram y Supabase reales) está en la sección 12.

## 1. Resumen ejecutivo

- **Críticos confirmados: ninguno.** No se encontró una vía para alterar dinero, saltarse RLS ni leer datos ajenos con las políticas actuales.
- Se corrigieron **2 hallazgos altos** (dos definiciones distintas de «interés pendiente» y bloqueos de filas en cada lectura) y **5 menores**
  (permisos sobrantes, funciones internas expuestas, código muerto, ficheros sin ignorar, enlace de búsqueda).
- Quedan **abiertos** 1 vulnerabilidad de dependencias de *build* (requiere subir de versión de Next), decisiones de negocio pendientes
  (cancelación anticipada, multa por mora) y mejoras de escala (reportes en el navegador).
- Estado para producción: **apto con condiciones** (sección 11). Lo esencial: aplicar las 9 migraciones en orden, configurar variables y verificar
  Telegram con «Comprobar conexión».

Pruebas ejecutadas en esta auditoría (resultados reales): TypeScript sin errores · ESLint sin avisos · `npm test` **83/83** ·
`npm run test:db` **124/124** · compilación de producción correcta (18 páginas).

## 2. Arquitectura real

| Capa | Qué hay |
|---|---|
| Rutas (App Router) | `/` (inicio de sesión) · `/dashboard` · `/[section]` (nuevo-prestamo, prestamos, simulador, registro-pagos, morosidad, clientes, caja, trabajadores, reportes, auditoria, usuarios, configuracion) |
| API (servidor) | `/api/admin/users` (alta de usuarios, solo admin) · `/api/admin/telegram` (configuración y pruebas, solo admin) · `/api/notify/payment` (aviso de pago, requiere sesión) · `/api/cron/reminders` (tarea programada, `CRON_SECRET`) |
| Reglas financieras (puras, en céntimos) | `lib/finance/`: `interest-only.ts` (céntimos, fechas), `loan-rules.ts` (modalidades, vista previa, validación de cobro, estado), `allocation.ts` (reparto interés/capital), `due-status.ts` (única regla de vencimientos), `reports.ts` (reportes y CSV) |
| Acceso a datos (navegador) | `lib/data/*` con el cliente de Supabase y RLS del usuario |
| Telegram | `lib/reminders/`: `config`, `crypto` (AES-256-GCM), `telegram`, `build` (mensajes), `dispatch` (envío/duplicados/registro), `schedule` (lee `vercel.json`) |
| Base de datos | 17 migraciones: tablas `profiles, clients, loans, installments, disbursements, loan_events, payments, payment_allocations, cash_movements, audit_log, settings, notification_log, notification_runs, telegram_settings`; vistas `v_loan_summary` (fuente única de saldos) y `v_loan_portfolio` (ahora derivada de la anterior); funciones `create_loan, register_payment, reverse_payment, cancel_loan, refresh_open_loans, loan_schedule, …` |
| Seguridad web | `middleware.ts` (sesión + perfil activo) y cabeceras en `next.config.ts` |

**Fuente de verdad de cada importe:** los saldos los calcula la base de datos (`register_payment`, vistas); la interfaz muestra y valida con las
mismas reglas, pero el servidor decide. Un pago nunca se borra: se revierte con motivo y contra-asiento.

## 3. Hallazgos y su estado

Leyenda de estado: ✅ corregido y comprobado · ⏳ abierto · 🔎 sospecha.

### Altos
| ID | Hallazgo | Archivo | Impacto | Solución | Verificación |
|---|---|---|---|---|---|
| A-1 ✅ | **Dos fórmulas de «interés pendiente».** `v_loan_portfolio` (dashboard y morosidad) contaba también intereses **futuros** y el período siguiente del préstamo abierto; `v_loan_summary` (lista, cobros, reportes) solo lo vencido o de hoy. | `supabase/migrations/…0200_portfolio_view.sql` | El dashboard mostraba «por cobrar» mayor que los reportes; saldos distintos para el mismo préstamo. | `v_loan_portfolio` pasa a leer `v_loan_summary` (migración `…0800`). | Prueba: ambas vistas devuelven filas idénticas; el interés futuro no cuenta como pendiente (`interest_pending = 0`, `interest_total = 300`). |
| A-2 ✅ | **Escritura en cada lectura.** `refresh_open_loans` recorría y **bloqueaba** (`FOR UPDATE`) todos los préstamos abiertos cada vez que se abría lista, detalle, cobros o reportes. | `…0200_open_interest…sql`, `lib/data/loans.ts` | Contención de bloqueos con varios usuarios y pagos simultáneos; trabajo creciente con la cartera. | Solo procesa los préstamos que necesitan un período nuevo; el navegador no lo pide más de una vez cada 30 s. | Prueba: el número de préstamos procesados coincide con los que realmente lo necesitan y no se duplican períodos. *Antes/después medido cualitativamente (no hay base real para cronometrar).* |

### Medios
| ID | Hallazgo | Estado |
|---|---|---|
| M-1 ⏳ | **Dependencias:** `npm audit --omit=dev` informa 2 avisos (1 alto, 1 moderado) por `postcss` incluido en `next`. Es una dependencia de **compilación** (procesa el CSS propio); no recibe CSS de usuarios, por lo que el riesgo en ejecución es bajo. Corregirlo exige `next@16` (cambio mayor). | Planificar la actualización de Next en una versión aparte y con pruebas. |
| M-2 ⏳ | **Multa por mora y días de gracia** se guardan en Configuración pero **no se aplican** (lo indica la propia pantalla). | Función incompleta: requiere regla de negocio (¿sobre qué base? ¿se acumula?). |
| M-3 ⏳ | **Cancelación anticipada de cuotas fijas** no existe. Con interés directo, saldar un préstamo exige pagar también el interés programado de todas las cuotas futuras. | Decisión de negocio: ¿descuento de intereses no devengados? |
| M-4 ⏳ | **Reportes en el navegador:** cargan pagos, cuotas y caja completos y calculan allí. Correcto para una cartera pequeña/mediana; se volverá lento con decenas de miles de filas. | Mejora: totales y paginación en SQL cuando crezca el volumen. |
| M-5 🔎 | **Períodos ya vencidos del préstamo abierto quedan congelados:** si se revierte un abono de capital, los períodos futuros se recalculan, pero uno ya vencido conserva el interés calculado entonces (regla deliberada: «no alterar lo ya generado»). | Confirmar con el negocio; no es un error técnico. |
| M-6 ⏳ | **Quincenal = 15 días fijos** desde el desembolso (no «1 y 16»). | Documentado; cambiar solo si el negocio lo pide. |
| M-7 ⏳ | **Sin CSP** (política de contenido): el script de tema y los de Next son en línea. Las demás cabeceras sí están (HSTS, X-Frame-Options, nosniff, Referrer, Permissions). | Mejora recomendada: CSP con *nonces*. |

### Bajos
| ID | Hallazgo | Estado |
|---|---|---|
| B-1 ✅ | Las vistas de cartera eran legibles por `anon` (fallaba por la tabla base) y tenían `INSERT/UPDATE/DELETE` por defecto; `loan_events` tenía permisos de escritura para `authenticated` (RLS ya los bloqueaba). | Revocados. Comprobado: `anon` y `authenticated` rechazados. |
| B-2 ✅ | Funciones internas `app.*` (devengo, recálculo, sincronización de estado, triggers) ejecutables por cualquier rol. No están expuestas por la API REST, pero quedaban a un cambio de configuración de serlo. | `REVOKE EXECUTE`. Comprobado: rechazo directo y la aplicación sigue funcionando (124 pruebas). |
| B-3 ✅ | Código muerto: `LiveReports`, `LiveLoans`, `fetchLoans`, `reportTotals/fetchPaymentTotals/fetchDisbursedTotal`. | Eliminado (tsc, lint y build limpios). |
| B-4 ✅ | La búsqueda global enlazaba un préstamo a la lista, no a su detalle. | Ahora abre `/prestamos?loan=<id>`. |
| B-5 ✅ | `tsconfig.tsbuildinfo` no estaba en `.gitignore`. | Añadido. |
| B-6 ⏳ | Siguen dos `window.confirm`: revertir un pago y eliminar el token (panel Telegram). | Pasar al modal propio. |
| B-7 🔎 | `register_payment` con una clave de idempotencia ya usada en **otro** préstamo devuelve el pago anterior sin comprobar el préstamo. Exige conocer un UUID; las claves las genera el propio navegador. | Endurecer si se abre una API externa. |
| B-8 ⏳ | `lib/config.ts` conserva un TODO con enlaces de ayuda/WhatsApp de ejemplo. | Completar con los reales. |
| B-9 ⏳ | La carpeta **no es un repositorio git** (no hay historial ni copia de seguridad del código). | Mejora recomendada: crear el repositorio (los secretos ya están en `.gitignore`). |

## 4. Auditoría financiera (comprobado con pruebas)

| Regla | Resultado |
|---|---|
| Cuotas fijas: capital en partes iguales, el último absorbe céntimos; interés sobre el capital original | ✅ (1000/3 → 333,33 + 333,33 + 333,34) |
| Pago parcial de una cuota deja saldo; pago completo la cancela | ✅ |
| Solo intereses: pagar intereses no baja el capital; abonos de capital sí; capital no negativo | ✅ |
| **Abierto, S/ 2,000 al 15 %:** paga 300 de interés + 1,000 de capital → capital 1,000 y siguiente interés **150**; el período cobrado conserva 300 | ✅ |
| Pagos revertidos no suman como ingreso; la reversión conserva pago, motivo y contra-asiento; el interés del siguiente período se restaura | ✅ |
| Reintento con la misma clave no duplica el cobro ni el desembolso | ✅ |
| Recarga/consulta repetida no duplica períodos de interés | ✅ |
| Préstamo abierto no se cierra por cobrar intereses; solo con capital 0 y sin períodos vencidos pendientes | ✅ |
| Anulación: solo admin, sin pagos confirmados, contra-asiento en caja, historial intacto; borrar físicamente sigue prohibido | ✅ |
| Caja: un movimiento por pago y tipo (índice único); caja neta de pagos = pagos confirmados | ✅ |
| Cobrador: registra pagos solo de clientes asignados y no puede anular | ✅ |

Reglas fijadas por decisión (no por error): el interés de cuotas fijas y «solo intereses» se calcula sobre el capital **original**; el del préstamo abierto, sobre el capital **pendiente**.

## 5. Clientes y préstamos
Comprobado: la edición de un cliente (nombre, teléfono, dirección, cobrador, estado) no modifica préstamos, pagos ni caja (se compara el estado
completo antes y después); el DNI duplicado se rechaza; el id es inmutable; el cobrador asignado debe existir y estar activo; solo admin y asesor editan
(el cobrador recibe «0 filas» por RLS). Los clientes inactivos no aparecen al crear préstamos y sus préstamos no cambian.

## 6. Reportes y caja
Los siete reportes usan datos reales (pagos, cuotas, vistas y caja) y aplican la misma lógica de filtros que las exportaciones: se prueba que el CSV coincide
con la tabla (filtros, fecha de generación, filas y totales). Los revertidos se listan pero no suman; el capital recuperado solo cuenta abonos de capital
confirmados; sin datos se muestra «No hay datos para el periodo seleccionado». El PDF usa el diálogo de impresión del navegador (no hay generador de PDF
en servidor): **no verificable aquí**.

## 7. Telegram
- Credenciales: se leen solo en el servidor; el token cifrado (AES-256-GCM) no es legible por ningún rol de la API (comprobado: admin, asesor y cobrador reciben «permission denied»).
- **Tres estados que no deben confundirse:** *guardada* (hay token y chat), *prueba exitosa* (el botón «Comprobar conexión» valida el bot **y cada chat** con `getMe` + `getChat`) y *ejecución automática exitosa* (una fila en «Última ejecución» con envíos confirmados). El panel muestra cada una por separado.
- `Bad Request: chat not found` **no es un problema de horario**: Telegram no encuentra el Chat ID o el bot no tiene acceso. Causas comunes: destinatario que no pulsó «Iniciar», ID mal copiado (guion largo, espacios), bot fuera del grupo. El sistema normaliza el ID y explica la causa; qué chat falla en su caso solo puede decirlo «Comprobar conexión» con las credenciales reales.
- Sin duplicados (clave por tipo/fecha/chat o préstamo), reintento hasta 3 veces, un fallo de Telegram no afecta pagos (comprobado), cron protegido por `CRON_SECRET`, horario efectivo leído de `vercel.json` (13:00 y 23:00 UTC = 08:00 y 18:00 de Lima).
- Revisión horaria: implementada pero **no activada** (el plan Hobby de Vercel solo admite crons diarios).

## 8. Seguridad (permisos efectivos medidos en el catálogo)
- RLS activo en las 14 tablas; `anon` sin acceso a ninguna; `authenticated` sin escritura directa en `payments, installments, payment_allocations, cash_movements, disbursements, audit_log, loan_events` y sin ningún acceso a `telegram_settings`.
- RPC: todas revocadas a `public`/`anon`; `cancel_loan` y `reverse_payment` exigen administrador **dentro** de la función; `create_loan` admin/asesor; `register_payment` exige perfil activo y visibilidad del préstamo.
- Rutas API: `/api/admin/*` verifican sesión + rol admin en servidor y mismo origen; `/api/notify/payment` exige sesión y que el pago sea visible por RLS; `/api/cron` exige `CRON_SECRET` (comparación en tiempo constante).
- Inyección SQL: no hay SQL construido por concatenación en la aplicación (consultas con el cliente de Supabase y funciones con parámetros). La búsqueda global elimina `% , ( )` antes de usarla en el filtro.
- Secretos: `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_*`, `CRON_SECRET` solo en servidor; `.env*` y `supabase/seed/` en `.gitignore`. Este informe no contiene credenciales.
- Autenticación de demostración: solo con Supabase sin configurar, fuera de producción y con bandera explícita.
- Desactivar un usuario (`active=false`) lo bloquea en middleware y en RLS (`app.current_role()` devuelve nulo).

## 9. Optimización realizada
Centralización: una sola fórmula de saldos (`v_loan_summary`), una regla de vencimientos (`due-status.ts`), un reparto de cobros (`allocation.ts`) y un único cronograma (`loan_schedule`).
Rendimiento: devengo sin bloqueos innecesarios y con tope de frecuencia; índices nuevos en `payments(paid_on)`, `cash_movements(loan_id)` y préstamos abiertos activos.
No se hicieron refactorizaciones sin beneficio verificable.

## 10. Funciones duplicadas / complejidad
Eliminado el código muerto (B-3). `interest-only.ts` conserva `buildSchedule` solo para sus pruebas y como base de `loan-rules.ts` (candidato a limpieza futura).
Queda `docs/ARQUITECTURA.md` anterior a estos cambios: puede estar desactualizado en las modalidades de préstamo.

## 11. Preparación para producción
1. Aplicar las migraciones **en orden** (`…0000` a `…0800`); son aditivas y no borran datos. Probar primero en un entorno de prueba.
2. Variables en Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `TELEGRAM_ENCRYPTION_KEY` (64 hex; no cambiarla o habrá que reintroducir el token). `NEXT_PUBLIC_ENABLE_DEMO_AUTH` **no** definida.
3. Panel → Configuración → Telegram: «Comprobar conexión»; luego «Enviar prueba».
4. Comprobar tras las 08:00 de Lima que «Última ejecución» se llena.
5. Planificar M-1 (Next), decidir M-2/M-3 y crear el repositorio git (B-9).

## 12. Limitaciones de esta auditoría
- No se ejecutó la aplicación en un navegador ni se probó en móviles: la adaptación a móvil se revisó por código (rejillas responsivas, modales a pantalla completa en pantallas pequeñas), no visualmente. No hay pruebas automáticas de interfaz ni de navegación.
- No se tuvo acceso a Vercel (logs, plan, ejecución real del cron), a Telegram ni a la base Supabase real. Los datos de prueba son los de un PostgreSQL local con las migraciones reales.
- No se modificaron datos reales.
- No se hizo una prueba de carga: las afirmaciones de rendimiento son por diseño (menos bloqueos y consultas), no cronometradas.
