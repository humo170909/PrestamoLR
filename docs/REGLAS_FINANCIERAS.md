# Reglas financieras de LRomero

Fuente única en código: `lib/finance/loan-rules.ts` (cliente) y `supabase/migrations/20261012000000_loan_types.sql` (autoridad en BD).

## Interés
**Abierto sin plazo:** el interés de cada período = (capital original − capital confirmado abonado antes del vencimiento del período) × tasa. Un abono el mismo día del vencimiento baja el período SIGUIENTE; los períodos vencidos o ya cobrados quedan congelados y un pago revertido deja de contar (migración `20261012000200`). Ejemplo: S/2,000 al 15 % → 300; paga 300 + abona 1,000 → siguiente período 150.

**Cuotas fijas y solo intereses** (sin cambios):
Cada período cobra **capital ORIGINAL × tasa del período** (interés directo). Un abono de capital baja el saldo, pero **no** modifica intereses ya generados ni futuros.

| Alternativa | Efecto (S/1,000 al 15 % mensual, abono de S/200 en el mes 2) |
|---|---|
| **Sobre capital original (vigente)** | Mes 3 en adelante: S/150 por período |
| Sobre capital pendiente (NO implementada) | Mes 3 en adelante: S/120 por período |

Cambiar de regla altera el dinero adeudado: requiere decisión del negocio (ver "Decisiones pendientes").

## Modalidades
- **Cuotas fijas**: `n` cuotas; capital en partes iguales (el último absorbe céntimos) + interés sobre el original en cada cuota.
- **Solo intereses + abonos**: interés cada período; el capital vence en la última cuota y admite abonos en cualquier cobro.
- **Abierto**: sin plazo ni cuotas. Se materializa únicamente el período en curso hasta el primero que aún no vence (idempotente, `unique(loan_id, n)`). Se cierra solo con capital 0 y sin períodos exigibles impagos.

## Estados
`Activo` (saldo/obligación vigente) · `Vencido` (obligación exigible impaga; se **deriva**, no se guarda) · `Pagado` (lo fija la BD al saldar todo).

## Cobros
`register_payment` valida en la BD: importes ≥ 0 con 2 decimales, interés ≤ lo generado/programado impago, capital ≤ pendiente, fecha real no futura ni anterior al desembolso, idempotencia por clave, bloqueo por préstamo. `reverse_payment` conserva el pago, el motivo y el contra-asiento de caja.

## Decisiones pendientes (dinero)
1. ¿Interés sobre capital original (actual) o sobre saldo pendiente?
2. Cuotas fijas: se usó interés directo (capital/n + interés sobre el original). Si se desea amortización francesa, hay que cambiarlo.
3. Cobros por encima de lo adeudado (saldo a favor) siguen rechazados.
4. Edición de condiciones contractuales: la BD las bloquea; hace falta una función autorizada con `loan_events`.
