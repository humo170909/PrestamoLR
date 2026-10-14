type Cell = string | number;
export type Row = Record<string, Cell>;
const rows = (keys: string[], data: Cell[][]): Row[] =>
  data.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])) as Row);

export const SEDES = [
  { id: "all", label: "Todas las sedes", f: 1 },
  { id: "lima", label: "Sede Lima Centro", f: 0.46 },
  { id: "sjl", label: "Sede San Juan de Lurigancho", f: 0.32 },
  { id: "norte", label: "Ruta Norte", f: 0.13 },
  { id: "sur", label: "Ruta Sur", f: 0.09 },
];

export const MONTHLY = [
  { mes: "Abr", desembolsado: 62000, cobrado: 48000, intereses: 9800 },
  { mes: "May", desembolsado: 71000, cobrado: 53000, intereses: 11200 },
  { mes: "Jun", desembolsado: 58000, cobrado: 57000, intereses: 12100 },
  { mes: "Jul", desembolsado: 84000, cobrado: 61000, intereses: 13400 },
  { mes: "Ago", desembolsado: 79000, cobrado: 66000, intereses: 14500 },
  { mes: "Sep", desembolsado: 91000, cobrado: 72000, intereses: 16200 },
];

export const MORA_TRAMOS = [
  { name: "1–7 días", value: 42 },
  { name: "8–30 días", value: 28 },
  { name: "31–60 días", value: 16 },
  { name: "Más de 60", value: 9 },
];

export const ALERTS = [
  { id: 1, tone: "danger", title: "12 cuotas vencidas hoy", detail: "S/ 4,860 pendientes de cobro", time: "Hace 10 min" },
  { id: 2, tone: "warn", title: "3 préstamos por aprobar", detail: "Esperan revisión del administrador", time: "Hace 1 h" },
  { id: 3, tone: "info", title: "Liquidez baja en Sede SJL", detail: "Caja por debajo de S/ 2,000", time: "Hace 2 h" },
];

export const TODAY_DUES = rows(
  ["cliente", "prestamo", "cuota", "monto", "cobrador", "estado"],
  [
    ["María Huamán Torres", "PR-0128", "5 de 12", 420, "C. Quispe", "Pendiente"],
    ["Jorge Salazar Ríos", "PR-0131", "3 de 6", 780, "R. Medina", "En ruta"],
    ["Rosa Campos Vega", "PR-0119", "9 de 12", 350, "C. Quispe", "Pagada"],
    ["Pedro Ccori Mamani", "PR-0134", "2 de 8", 560, "L. Paredes", "Pendiente"],
    ["Lucía Fernández Díaz", "PR-0122", "7 de 10", 295, "R. Medina", "Pagada"],
    ["Andrés Villanueva", "PR-0137", "1 de 6", 910, "L. Paredes", "En ruta"],
  ],
);

export const CLIENTS = rows(
  ["name", "dni", "phone", "loans", "historial", "saldo", "estado"],
  [
    ["María Huamán Torres", "45128736", "987 214 560", 2, "Excelente", 3150, "Activo"],
    ["Jorge Salazar Ríos", "40872219", "956 331 084", 1, "Bueno", 2340, "Activo"],
    ["Rosa Campos Vega", "47220915", "912 408 773", 3, "Excelente", 1050, "Activo"],
    ["Pedro Ccori Mamani", "43905612", "984 120 337", 1, "Regular", 3920, "Moroso"],
    ["Lucía Fernández Díaz", "46318850", "943 652 190", 2, "Bueno", 870, "Activo"],
    ["Andrés Villanueva Paz", "41567093", "999 075 421", 1, "Riesgo", 5400, "Moroso"],
    ["Carmen Rojas Luna", "44790126", "951 883 206", 1, "Bueno", 0, "Inactivo"],
    ["Walter Mendoza Ochoa", "42651387", "965 447 912", 2, "Regular", 2680, "Activo"],
    ["Elena Gutiérrez Soto", "48093571", "977 530 148", 1, "Excelente", 1960, "Activo"],
    ["Hugo Paredes Arce", "45821304", "920 316 875", 1, "Riesgo", 4710, "Moroso"],
  ],
);

export const LOANS = rows(
  ["id", "client", "amount", "rate", "term", "balance", "estado", "next"],
  [
    ["PR-0128", "María Huamán Torres", 5000, "4,5%", "12 meses", 3150, "Vigente", "05/10/2026"],
    ["PR-0131", "Jorge Salazar Ríos", 3000, "5,0%", "6 meses", 2340, "Vigente", "07/10/2026"],
    ["PR-0119", "Rosa Campos Vega", 2500, "4,0%", "12 meses", 1050, "Vigente", "03/10/2026"],
    ["PR-0134", "Pedro Ccori Mamani", 4500, "5,5%", "8 meses", 3920, "En mora", "18/09/2026"],
    ["PR-0122", "Lucía Fernández Díaz", 2000, "4,5%", "10 meses", 870, "Vigente", "09/10/2026"],
    ["PR-0137", "Andrés Villanueva Paz", 6000, "5,0%", "6 meses", 5400, "En mora", "28/08/2026"],
    ["PR-0098", "Carmen Rojas Luna", 1500, "4,0%", "6 meses", 0, "Cancelado", "—"],
    ["PR-0125", "Walter Mendoza Ochoa", 3500, "4,5%", "9 meses", 2680, "Vigente", "11/10/2026"],
    ["PR-0140", "Elena Gutiérrez Soto", 2400, "4,0%", "12 meses", 1960, "Vigente", "15/10/2026"],
    ["PR-0116", "Hugo Paredes Arce", 5200, "5,5%", "8 meses", 4710, "En mora", "02/09/2026"],
  ],
);

export const MORA = rows(
  ["client", "dni", "cuotas", "dias", "deuda", "cobrador", "phone"],
  [
    ["Pedro Ccori Mamani", "43905612", 2, 14, 1120, "L. Paredes", "984 120 337"],
    ["Andrés Villanueva Paz", "41567093", 4, 35, 3640, "L. Paredes", "999 075 421"],
    ["Hugo Paredes Arce", "45821304", 5, 61, 4350, "R. Medina", "920 316 875"],
    ["Silvia Ancco Huanca", "46002718", 1, 5, 310, "C. Quispe", "958 214 660"],
    ["Raúl Cárdenas Yupanqui", "40318865", 3, 22, 1980, "R. Medina", "947 703 112"],
    ["Marta Quiroz Alva", "44176290", 1, 3, 260, "C. Quispe", "986 541 307"],
  ],
);

export const PAYMENTS = rows(
  ["recibo", "fecha", "client", "prestamo", "capital", "interes", "multa", "metodo"],
  [
    ["R-04821", "02/10/2026", "Rosa Campos Vega", "PR-0119", 270, 80, 0, "Efectivo"],
    ["R-04820", "02/10/2026", "Lucía Fernández Díaz", "PR-0122", 205, 90, 0, "Yape"],
    ["R-04819", "01/10/2026", "Pedro Ccori Mamani", "PR-0134", 380, 150, 30, "Efectivo"],
    ["R-04818", "01/10/2026", "Elena Gutiérrez Soto", "PR-0140", 150, 100, 0, "Transferencia"],
    ["R-04817", "30/09/2026", "Walter Mendoza Ochoa", "PR-0125", 260, 120, 0, "Efectivo"],
    ["R-04816", "30/09/2026", "Jorge Salazar Ríos", "PR-0131", 630, 150, 0, "Plin"],
  ],
);

export const CASH = rows(
  ["hora", "concepto", "tipo", "monto"],
  [
    ["08:40", "Cobro PR-0119 · Rosa Campos", "Entrada", 350],
    ["09:15", "Desembolso PR-0141 · N. Castillo", "Salida", 3000],
    ["10:05", "Cobro PR-0122 · Lucía Fernández", "Entrada", 295],
    ["11:30", "Cobro PR-0134 · Pedro Ccori", "Entrada", 560],
    ["12:10", "Pasajes y viáticos de cobradores", "Salida", 120],
    ["13:45", "Cobro PR-0125 · Walter Mendoza", "Entrada", 380],
  ],
);
export const CASH_WEEK = [
  { dia: "Lun", entradas: 4200, salidas: 3000 },
  { dia: "Mar", entradas: 3800, salidas: 5200 },
  { dia: "Mié", entradas: 5100, salidas: 2400 },
  { dia: "Jue", entradas: 4600, salidas: 4000 },
  { dia: "Vie", entradas: 6100, salidas: 3600 },
  { dia: "Sáb", entradas: 3300, salidas: 1500 },
];

export const WORKERS = rows(
  ["name", "rol", "ruta", "clientes", "recaudo", "estado"],
  [
    ["Carlos Quispe", "Cobrador", "Ruta Lima Centro", 64, 18400, "Activo"],
    ["Rocío Medina", "Cobrador", "Ruta SJL Norte", 58, 16250, "Activo"],
    ["Luis Paredes", "Cobrador", "Ruta SJL Sur", 49, 12900, "Activo"],
    ["Diana Castro", "Asesora", "Oficina Central", 31, 0, "Activo"],
    ["Mario Flores", "Cobrador", "Ruta Norte", 37, 9800, "Inactivo"],
  ],
);
export const COLLECTOR_PERF = [
  { cobrador: "C. Quispe", recaudo: 18400, meta: 17000 },
  { cobrador: "R. Medina", recaudo: 16250, meta: 16500 },
  { cobrador: "L. Paredes", recaudo: 12900, meta: 14000 },
  { cobrador: "M. Flores", recaudo: 9800, meta: 12000 },
];

export const AUDIT = rows(
  ["fecha", "usuario", "accion", "modulo", "detalle"],
  [
    ["02/10/2026 09:12", "Luis Romero", "Inició sesión", "Sistema", "Acceso desde Lima"],
    ["02/10/2026 09:30", "Diana Castro", "Registró pago", "Cobranzas", "Recibo R-04820 · S/ 295"],
    ["02/10/2026 10:02", "Luis Romero", "Anuló pago", "Cobranzas", "Recibo R-04811 · motivo: error de monto"],
    ["01/10/2026 16:45", "Diana Castro", "Creó préstamo", "Préstamos", "PR-0141 · S/ 3,000"],
    ["01/10/2026 11:20", "Luis Romero", "Cambió tasa", "Configuración", "Tasa base 4,0% → 4,5%"],
    ["30/09/2026 18:05", "Carlos Quispe", "Registró visita", "Morosidad", "Cliente P. Ccori · promesa de pago"],
  ],
);

export const USER_ROWS = rows(
  ["name", "email", "rol", "acceso", "estado"],
  [
    ["Luis Romero", "admin@lromero.com", "Administrador", "Hoy 09:12", "Activo"],
    ["Diana Castro", "diana@lromero.com", "Asesor", "Hoy 08:55", "Activo"],
    ["Carlos Quispe", "cobrador@lromero.com", "Cobrador de ruta", "Ayer 18:40", "Activo"],
    ["Rocío Medina", "rocio@lromero.com", "Cobrador de ruta", "Ayer 17:10", "Activo"],
    ["Mario Flores", "mario@lromero.com", "Cobrador de ruta", "20/09/2026", "Inactivo"],
  ],
);
