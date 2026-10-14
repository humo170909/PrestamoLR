# Avisos automáticos por Telegram

Programación actual (`vercel.json`, Vercel Cron interpreta UTC; Lima = UTC−5 sin horario de verano):

| Cron (UTC) | Hora de Lima | Job | Qué envía |
|---|---|---|---|
| `0 13 * * *` | 08:00 | `morning` | cobros de hoy + alertas de pagos vencidos |
| `0 23 * * *` | 18:00 | `evening` | cobros de mañana (y reintenta hoy/atrasos) |

## Revisión cada hora (opcional)
El código ya admite `job=hourly`: revisa vencimientos nuevos y reintenta fallos, pero **solo envía de 08:00 a 20:00 (Lima)** y
nunca repite un aviso ya enviado (clave por préstamo y día).

**No está activada por defecto** porque un cron más frecuente que una vez al día **hace fallar el despliegue en el plan Hobby de
Vercel**. Si tu plan lo permite (Pro), añade esta línea a `crons` en `vercel.json` y vuelve a desplegar:

```json
{ "path": "/api/cron/reminders?job=hourly", "schedule": "0 * * * *" }
```

(Aplica antes la migración `20261012000700_runs_hourly.sql`.) Alternativa sin cambiar de plan: un programador externo o `pg_cron`
de Supabase que llame cada hora a `/api/cron/reminders?job=hourly` con la cabecera `Authorization: Bearer $CRON_SECRET`.

## Alertas de vencimiento
Una alerta por préstamo cuando una obligación sigue pendiente a **1, 3, 5 y 7 días** de retraso y luego **cada 7 días**
(configurable en el panel). El importe exigible suma solo lo vencido; el capital pendiente del préstamo es informativo.
