# Manual de usuario de LRomero

Guía paso a paso para quien administra préstamos. No hace falta saber programar.

> Los ejemplos usan soles (S/). Los nombres de botones y menús aparecen entre «comillas» tal como se ven en la plataforma.

---

## 1. Introducción

**LRomero** sirve para llevar el control de préstamos: registrar clientes, entregar préstamos (desembolso), cobrar, saber quién está atrasado, ver el dinero que entra y sale (caja), sacar reportes y recibir avisos por Telegram.

Qué puedes hacer:
- Registrar y editar clientes.
- Crear préstamos de tres tipos (cuotas fijas, solo intereses con abonos, o abierto sin plazo).
- Registrar cobros separando **intereses** y **capital**.
- Corregir un error revirtiendo un pago (sin borrar nada).
- Consultar saldos, próximos cobros y atrasos.
- Sacar siete reportes y exportarlos (CSV y PDF).
- Recibir alertas de cobro y de pagos vencidos en Telegram.

**Recomendaciones básicas**
1. Revisa siempre el resumen antes de confirmar; los cobros y desembolsos no se borran, solo se corrigen con una reversión.
2. Registra cada cobro **el mismo día** y con la **fecha real** del pago.
3. No compartas tu contraseña. Cierra sesión en equipos ajenos.
4. Ante una duda, mira «Auditoría» (administrador): ahí queda quién hizo qué y cuándo.

---

## 2. Acceso a la plataforma

**Iniciar sesión**
1. Abre la dirección de LRomero en el navegador.
2. Escribe tu **correo** y tu **contraseña** y pulsa el botón de ingreso.
3. Si el correo o la contraseña no son correctos, verás un mensaje. Si tu usuario está desactivado o no tiene perfil, no podrás entrar: pide ayuda al administrador.

**Navegar por el menú** (lado izquierdo; en el móvil se abre con el icono de menú):

| Grupo | Opciones |
|---|---|
| Principal | Dashboard |
| Préstamos | Nuevo préstamo · Lista de préstamos · Simulador |
| Cobranzas | Registro de pagos · Gestión de morosidad |
| Gestión y finanzas | Clientes · Caja y flujos · Trabajadores/Cobradores · Reportes |
| Control y sistema | Auditoría · Usuarios y permisos · Configuración |

Arriba hay un **buscador** (cliente, DNI o código de préstamo), la campana de **alertas** (mora y vencimientos de hoy) y el botón de tema claro/oscuro.

**Cerrar sesión:** botón de salida junto a tu nombre, abajo a la izquierda.

**Qué ve cada rol**

| | Administrador | Asesor | Cobrador de ruta |
|---|---|---|---|
| Crear/editar clientes | Sí | Sí | No |
| Crear préstamos | Sí | Sí | No |
| Registrar cobros | Sí | Sí | Solo de sus clientes asignados |
| Ver clientes y préstamos | Todos | Todos | Solo los asignados |
| Revertir pagos | Sí | No | No |
| Eliminar (anular) préstamos | Sí | No | No |
| Usuarios, Auditoría, Telegram | Sí | No | No |

**Buenas prácticas de seguridad:** contraseña larga y única, no reutilizada; no la anotes a la vista; avisa de inmediato si pierdes un dispositivo para que desactiven tu usuario.

---

## 3. Gestión de clientes («Clientes»)

**Registrar un cliente** (formulario «Nuevo cliente», arriba)
1. Escribe **Nombre completo** y **DNI** (8 dígitos). Teléfono, dirección y cobrador asignado son opcionales.
2. Pulsa «Registrar cliente». Verás «Cliente registrado» y aparecerá en la tabla.

**Buscar:** usa el cuadro «Filtrar…» de la tabla (nombre, DNI o teléfono) o el buscador de arriba.

**Editar** (solo administrador y asesor)
1. En la fila del cliente pulsa «Editar» (lápiz).
2. Cambia lo que necesites: nombre, DNI, teléfono, dirección, cobrador, estado activo.
3. «Guardar cambios». Aparece «Cliente actualizado correctamente».
- Editar un cliente **no cambia sus préstamos, pagos ni caja**.
- Si **vacías** un dato que ya existía (teléfono, dirección o cobrador) te pedirá confirmarlo.
- «Cancelar» cierra sin guardar.
- Un cliente **inactivo** no aparece al crear un préstamo nuevo; sus préstamos siguen igual.

**Validaciones del DNI:** deben ser 8 dígitos y **no puede repetirse**. Si dice «Ya existe un cliente con ese DNI», **no lo vuelvas a crear**: búscalo en la tabla y úsalo. Si el DNI de un cliente existente estaba mal escrito, edítalo.

**Teléfono:** de 6 a 20 caracteres (números, +, paréntesis, espacios o guiones).

---

## 4. Crear y desembolsar un préstamo («Nuevo préstamo»)

1. **Cliente:** elígelo de la lista (debe existir y estar activo).
2. **Tipo de préstamo:** cuotas fijas, solo intereses + abonos, o abierto (ver sección 5).
3. **Capital (S/):** el dinero que se entrega.
4. **Frecuencia de pago:** mensual, quincenal (cada 15 días) o semanal.
5. **Tasa por período (%):** el porcentaje que se cobra **cada período** (por ejemplo 15 % cada mes). El texto de ayuda te recuerda sobre qué capital se calcula.
6. **Plazo (períodos):** solo en cuotas fijas y solo intereses. El préstamo **abierto no tiene plazo**.
7. **Fecha de desembolso:** por defecto hoy (hora de Lima).

A la derecha ves la **vista previa**: fecha del siguiente cobro, interés previsto, capital previsto, importe total, capital pendiente estimado y, si no es abierto, el cronograma completo y el total proyectado. Si algo es inválido (capital 0, tasa negativa, fecha imposible) aparece un aviso en rojo y el botón se desactiva.

**Confirmar el desembolso**
1. Pulsa «Registrar y desembolsar».
2. Se abre «Confirmar desembolso» con el resumen (cliente, capital, modalidad, tasa, frecuencia, fecha e importe a entregar). Léelo con calma.
3. «Cancelar» cierra sin crear nada. «Confirmar desembolso» registra el préstamo (se bloquea el botón mientras trabaja: **no hagas doble clic**).
4. Si algo falla, el mensaje sale en el mismo cuadro, tus datos se conservan y puedes pulsar «Reintentar» (no se duplica).
5. Si todo sale bien, verás **«¡Préstamo registrado correctamente!»** con el **código real** (por ejemplo PR-0016).

**Consultar el préstamo creado:** en ese cuadro elige «Ver préstamo» (abre el detalle) o «Ir a la lista de préstamos» (lo resalta unos segundos).

El **Simulador** sirve para mostrar números a un cliente: calcula pero **no guarda nada**.

---

## 5. Las tres modalidades de préstamo

En todas, el pago se registra separando **intereses** y **capital**. Pagar solo intereses **nunca** baja el capital.

### 5.1 Cuotas fijas
El cliente paga cuotas periódicas que incluyen capital e interés.
- Capital: se reparte en partes iguales (el último ajusta los céntimos).
- Interés: capital original × tasa, en cada cuota.
- **Ejemplo:** S/ 1,200, 10 % mensual, 4 meses → cada cuota = S/ 300 de capital + S/ 120 de interés = **S/ 420**.
- Un pago **parcial** deja saldo en la cuota (no se marca pagada). Un pago completo la cancela.
- El préstamo se cierra cuando todas las cuotas están pagadas.

### 5.2 Solo intereses + abonos de capital
El cliente paga intereses cada período y puede abonar capital cuando quiera; el capital vence en el último período.
- Interés de cada período: **capital original × tasa** (no cambia aunque se abone).
- **Ejemplo:** S/ 1,000 al 15 % mensual → S/ 150 por mes. Si el cliente paga S/ 150, el capital sigue en S/ 1,000. Si paga S/ 150 y abona S/ 200, el capital baja a S/ 800 y el interés de los meses siguientes **sigue siendo S/ 150**.

### 5.3 Abierto sin plazo
No hay cuotas ni fecha final. Cada período se genera solo cuando corresponde (nunca se crean períodos «inventados» por adelantado).
- Interés de cada período: **capital pendiente × tasa**. Cada abono de capital baja el interés de los períodos **siguientes**.
- **Ejemplo:** S/ 2,000 al 15 % mensual. Primer período: interés S/ 300. El cliente paga S/ 300 de interés y abona S/ 1,000 de capital → capital pendiente S/ 1,000 y el interés del **siguiente** período es **S/ 150**. El período ya cobrado conserva sus S/ 300.
- El préstamo **no se cierra** por cobrar intereses: solo cuando el capital llega a cero y no queda nada vencido por pagar.

---

## 6. Registrar un cobro («Registro de pagos»)

1. Elige el **préstamo** en la lista (también puedes llegar desde el detalle con «Registrar pago»).
2. Arriba verás el resumen: cliente, código, capital pendiente, interés exigible, lo vencido y días de atraso, próximo vencimiento, último pago e interés del próximo período.
3. La tabla **Períodos** muestra cada obligación pendiente: fecha, estado (Vencido / Vence hoy / Próximo vencimiento), lo pagado antes, lo pendiente y **cómo quedaría** tras el pago.
4. Escribe el **Importe recibido**. El sistema lo reparte solo: primero **intereses** del período más antiguo y, si sobra, propone **abono a capital**. El botón «Cobrar lo exigible» rellena el total que ya venció.
5. Puedes **ajustar a mano** el «Interés aplicado» y el «Capital aplicado» (por ejemplo, para registrar solo un abono a capital). El sistema vuelve a validar.
6. Elige la **fecha del pago** (la real; no puede ser futura ni anterior al desembolso) y el **método** (Efectivo, Transferencia o Yape/Plin).
7. A la derecha lees el **desglose**: recibido, interés, capital, intereses pendientes, capital restante y saldo total.
8. Si hay excedente que irá a capital, marca la casilla que lo confirma. Marca también **«Confirmo que recibí…»**: sin eso no se puede guardar.
9. Pulsa «Registrar cobro». Se abre **«Confirmar registro de pago»** con todos los datos; «Cancelar» no registra nada.
10. Al confirmar verás **«¡Pago registrado correctamente!»** con el número de recibo y el capital pendiente actualizado. Desde ahí: «Ver préstamo» o «Volver a pagos».

**Ejemplos (S/ 1,000, 15 % mensual, interés exigible S/ 150, capital S/ 1,000)**

| El cliente | Interés | Capital abonado | Capital queda | Interés pendiente |
|---|---|---|---|---|
| Paga S/ 150 | 150 | 0 | 1,000 | 0 |
| Paga S/ 250 | 150 | 100 (excedente, se confirma) | 900 | 0 |
| Paga S/ 100 | 100 | 0 | 1,000 | 50 |
| Abona S/ 200 solo a capital | 0 | 200 | 800 | 150 (sigue pendiente) |

**Qué te protege:** no se puede cobrar más interés del que existe, ni abonar más capital que el pendiente, ni usar importes negativos o con más de 2 decimales; si el clic o la conexión se repiten, **no se cobra dos veces**.

Cada cobro genera un **recibo** con número propio y un movimiento de **caja** (intereses y capital por separado).

---

## 7. Corregir un cobro: reversión (solo administrador)

1. En «Registro de pagos» baja a **«Revertir un pago»**.
2. Elige el pago y escribe el **motivo** (mínimo 5 caracteres).
3. Confirma. El pago **no se borra**: queda marcado «Revertido» con su motivo, los saldos vuelven a como estaban y la caja registra la corrección.
4. Un pago revertido **no suma** en reportes ni en totales. En un préstamo abierto, el interés de los períodos futuros se recalcula con el capital restaurado.

---

## 8. Lista y detalle de préstamos («Lista de préstamos»)

**Lista:** buscador (cliente, documento o código), botón «Nuevo préstamo», filtros **Todos / Activo / Pagado / Vencido** (con contadores) y una tarjeta por préstamo con capital original y pendiente, intereses pendientes, tasa, modalidad, frecuencia, inicio, **próximo cobro**, estado y pagos realizados. Arriba aparece **«Cobros de hoy»** si algún vencimiento es hoy.

**Cómo entender las fechas**
- **Vence hoy:** la obligación vence hoy y sigue pendiente.
- **Próximo vencimiento:** fecha futura.
- **Vencido:** pasó la fecha y sigue pendiente (se indica desde cuándo y cuántos períodos).
- **Pagado / Préstamo cancelado:** sin obligaciones.
Siempre se usa la **hora de Lima**.

**Detalle** («Ver detalle»): datos del cliente y del préstamo, **progreso financiero** (intereses generados, cobrados y pendientes; capital abonado y pendiente; total pagado; días de atraso), **cronograma** («Ver cronograma»: capital de referencia, interés previsto y cobrado, capital abonado y estado de cada período) e **historial de pagos** (recibo, fecha, desglose, método y estado).
El % de capital recuperado **solo** cuenta abonos de capital: los intereses no lo aumentan.

**Exportar a PDF:** botón «Exportar a PDF» (o «Exportar estado» en la tarjeta). Se abre el diálogo de impresión: elige «Guardar como PDF».

---

## 9. Eliminar (anular) un préstamo (solo administrador)

1. En la tarjeta o en el detalle, pulsa «Eliminar préstamo».
2. Lee el aviso («¿Eliminar este préstamo?»), revisa cliente, código, capital y estado, y escribe el **motivo**.
3. «Confirmar eliminación» (o «Cancelar» para no tocar nada).

Qué ocurre de verdad: el préstamo queda **anulado**, **no se borra** ningún registro y el desembolso se contra-asienta en caja. Deja de contar como préstamo otorgado en los reportes.
**Si el préstamo ya tiene pagos confirmados no se puede eliminar.** Primero se revierten esos pagos (sección 7) y después se puede anular. Un préstamo ya pagado por completo tampoco se anula.

---

## 10. Dashboard y morosidad

**Dashboard:** capital pendiente, intereses cobrados y pendiente exigible, vencimientos de hoy, índice de morosidad, gráfico de caja por mes y niveles de atraso.
**Gestión de morosidad:** préstamos con atraso, días, intereses vencidos, capital vencido y teléfono del cliente, ordenados por antigüedad.
El **importe exigible** es solo lo que ya venció; el capital pendiente total se muestra como información.

---

## 11. Caja y flujos («Caja y flujos»)

Muestra intereses cobrados, capital recuperado, desembolsos y **saldo de caja** (entradas − salidas), con la lista de movimientos. Las reversiones y las anulaciones de desembolso aparecen como movimientos propios: nada se borra. En el reporte «Caja» (Reportes) se compara cada cobro con sus movimientos y se marcan diferencias.

---

## 12. Reportes («Reportes»)

Siete pestañas: **Préstamos otorgados · Cobros · Capital recuperado · Intereses · Cancelados · Saldos y morosidad · Caja**.

**Filtros:** fechas desde/hasta, cliente o documento, código de préstamo, modalidad, estado y método de pago. Cada reporte aclara a qué fecha se aplica (desembolso, cobro, vencimiento o cancelación). «Limpiar» borra los filtros.

**Cómo leerlos**
- Los **pagos revertidos** aparecen tachados y **no suman**.
- **Capital recuperado** cuenta solo abonos de capital confirmados.
- **Intereses:** *previstos* (cronograma) ≠ *generados* (ya vencidos) ≠ *cobrados* (pagos confirmados).
- Los **préstamos anulados** no aparecen como cartera.
- Sin resultados verás «No hay datos para el periodo seleccionado».

**Exportar:** «CSV» (se abre en Excel; incluye filtros, fecha de generación y totales) y «PDF» (diálogo de impresión → «Guardar como PDF»). Lo exportado es lo que ves en pantalla.

---

## 13. Avisos por Telegram («Configuración», solo administrador)

El bot envía automáticamente:
- **Cobros de mañana** (18:00, hora de Lima) y **cobros de hoy** (08:00).
- **Alerta de pago vencido** a 1, 3, 5 y 7 días de retraso y luego cada 7 días (los días se pueden cambiar).
- **Pago registrado / revertido**, al momento.
Si una obligación se paga, deja de avisarse. Un mismo aviso **no se repite**.

**Panel de estado:** muestra si hay credenciales guardadas, la **última ejecución**, el último envío exitoso, el último error, el total enviado y la **próxima ejecución**.
**Botones útiles**
- «Comprobar conexión»: Telegram confirma el bot **y cada destinatario**. Es la prueba real.
- «Enviar prueba»: manda un mensaje de prueba.
- «Detectar chats»: ayuda a encontrar tu Chat ID.
El token se guarda cifrado y **nunca se vuelve a mostrar**; no hace falta reescribirlo.

**Si aparece `chat not found`:** Telegram no encuentra ese Chat ID. Comprueba que (1) el destinatario abrió el bot y pulsó **Iniciar**, (2) el número está bien copiado (sin espacios; los grupos llevan signo menos) y (3) el bot está dentro del grupo. «Comprobar conexión» te dice cuál de tus chats falla.

---

## 14. Usuarios, trabajadores, auditoría y ajustes (administrador)

- **Usuarios y permisos:** crear usuarios (nombre, correo, contraseña de mínimo 8 caracteres y rol), cambiar el rol o activar/desactivar. No puedes cambiar tu propio rol ni tu estado. Un usuario desactivado pierde el acceso.
- **Trabajadores / Cobradores:** clientes asignados y total cobrado por cada persona.
- **Auditoría:** registro de acciones (pagos, reversiones, anulaciones, cambios de clientes, configuración de Telegram).
- **Configuración:** datos del negocio y tasa sugerida. *La multa por mora y los días de gracia se guardan pero todavía no se aplican automáticamente.*

---

## 15. Problemas frecuentes

| Situación | Qué hacer |
|---|---|
| «Ya existe un cliente con ese DNI» | Búscalo y úsalo; no lo dupliques. |
| El botón «Registrar cobro» está gris | Falta marcar «Confirmo que recibí…», hay un error en rojo (importe mayor al pendiente, fecha futura) o el importe es 0. |
| Me equivoqué en un cobro | Pide a un administrador que lo revierta (sección 7) y regístralo de nuevo. |
| Me equivoqué al crear un préstamo | Si no tiene pagos: «Eliminar préstamo» (se anula, queda historial). Si tiene pagos: revertirlos primero. |
| «No se pudo cargar el préstamo» | Se muestra el motivo; suele faltar aplicar una actualización de base de datos: avisa al responsable técnico. |
| No llegan avisos de Telegram | Mira «Última ejecución» y «Último error» en Configuración; usa «Comprobar conexión». |
| La conexión falló al guardar | Pulsa de nuevo «Reintentar»: la misma operación no se duplica. |

---

## 16. Glosario

- **Capital original:** dinero entregado al inicio. **Capital pendiente:** lo que aún falta devolver.
- **Interés exigible:** interés de períodos ya vencidos (o que vencen hoy) y aún no cobrado.
- **Desembolso:** entrega del préstamo.
- **Período:** cada mes, quincena o semana según la frecuencia.
- **Reversión:** anular un pago dejando constancia (no se borra).
- **Anulación:** «eliminar» un préstamo conservando su historial.
- **Abono extraordinario:** pago adicional a capital fuera del calendario.
