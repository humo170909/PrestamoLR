// Servidor Supabase de PRUEBA (solo para medir el diseño responsive). Datos ficticios de prueba, nunca usados por el producto.
import http from "node:http";

const PORT = 54399;
const lima = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, k) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10); };
const TODAY = lima();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: ADMIN, role: "authenticated", aud: "authenticated", exp: 4102444800 })}.firma`;
const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const USER = { id: ADMIN, aud: "authenticated", role: "authenticated", email: "admin@lromero.test", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z", email_confirmed_at: "2026-01-01T00:00:00Z" };

const LONG = "Jorge Alberto Ramírez Villanueva de la Cruz y Sotomayor Alvarado";
const loan = (o) => ({
  id: o.id, code: o.code, loan_type: o.type, db_status: o.status ?? "active", client_id: o.cid, full_name: o.name, document_id: o.dni, phone: "987654321",
  assigned_collector: null, principal: o.principal, principal_outstanding: o.out, capital_paid: o.principal - o.out, rate_pct: 15, frequency: "monthly",
  periods: o.type === "open" ? null : 3, start_date: addDays(TODAY, -45), created_at: addDays(TODAY, -45) + "T10:00:00Z",
  interest_generated: o.gen ?? 300, interest_paid: o.paid ?? 150, interest_pending: o.pend ?? 150, interest_overdue: o.over ?? 0, capital_overdue: 0,
  interest_projected: o.type === "open" ? null : 450, next_due_date: o.next ?? addDays(TODAY, 5), oldest_overdue_date: o.over ? addDays(TODAY, -3) : null,
  days_overdue: o.over ? 3 : 0, periods_elapsed: 1, periods_paid: o.pp ?? 0, periods_overdue: o.over ? 1 : 0, total_paid: o.tp ?? 150, last_payment_on: addDays(TODAY, -10),
  derived_status: o.over ? "overdue" : o.status === "paid_off" ? "paid" : "active", closed_on: null, interest_scheduled: 450, periods_unpaid_exigible: o.over ? 2 : 1,
  due_today_pending: o.today ? 150 : 0, next_due_amount: 150, business_today: TODAY,
});
const LOANS = [
  loan({ id: "11111111-1111-1111-1111-111111111111", code: "PR-0016", type: "open", cid: "c1", name: LONG, dni: "12345678", principal: 2000, out: 1000, today: true, next: TODAY }),
  loan({ id: "22222222-2222-2222-2222-222222222222", code: "PR-0017", type: "interest_only", cid: "c2", name: "José Munivez", dni: "78945612", principal: 1000, out: 1000, over: 150, pend: 300 }),
  loan({ id: "33333333-3333-3333-3333-333333333333", code: "PR-0018", type: "fixed", cid: "c3", name: "Ana Pérez", dni: "45612378", principal: 1200, out: 900 }),
  loan({ id: "44444444-4444-4444-4444-444444444444", code: "PR-0019", type: "open", cid: "c1", name: LONG, dni: "12345678", principal: 500, out: 0, status: "paid_off", pend: 0, next: null }),
];
const CLIENTS = [
  { id: "c1", full_name: LONG, document_id: "12345678", phone: "987654321", active: true, address: "Av. Los Olivos 1234, Urbanización Las Magnolias, Lima", assigned_collector: null },
  { id: "c2", full_name: "José Munivez", document_id: "78945612", phone: null, active: true, address: null, assigned_collector: null },
  { id: "c3", full_name: "Ana Pérez", document_id: "45612378", phone: "999111222", active: false, address: "Jr. Unión 55", assigned_collector: null },
  ...Array.from({ length: 12 }, (_, i) => ({ id: `cx${i}`, full_name: `Cliente de prueba ${i + 1}`, document_id: String(30000000 + i), phone: "900000000", active: true, address: null, assigned_collector: null })),
];
const PROFILES = [
  { id: ADMIN, full_name: "Administrador Romero", role: "admin", active: true, created_at: "2026-01-01T00:00:00Z", route: null },
  { id: "p2", full_name: "Asesor Uno", role: "advisor", active: true, created_at: "2026-01-02T00:00:00Z", route: null },
  { id: "p3", full_name: "Cobrador de Ruta Norte", role: "collector", active: true, created_at: "2026-01-03T00:00:00Z", route: null },
];
const inst = (loanId, n, due, paid) => ({ id: `${loanId}-${n}`, loan_id: loanId, n, due_date: due, interest_due: "150.00", interest_paid: paid ? "150.00" : "0.00", capital_due: "0.00", capital_paid: "0.00" });
const INSTALLMENTS = LOANS.flatMap((l) => [inst(l.id, 1, addDays(TODAY, -15), true), inst(l.id, 2, l.due_today_pending ? TODAY : addDays(TODAY, l.days_overdue ? -3 : 5), false), inst(l.id, 3, addDays(TODAY, 35), false)]);
const PAYMENTS = Array.from({ length: 14 }, (_, i) => ({
  id: `pay${i}`, loan_id: LOANS[i % 3].id, receipt_no: 100 + i, received_at: addDays(TODAY, -i) + "T15:00:00Z", paid_on: addDays(TODAY, -i), amount: "300.00",
  interest_amount: "150.00", capital_amount: "150.00", method: ["cash", "transfer", "yape"][i % 3], status: i === 3 ? "reversed" : "confirmed",
  reversal_reason: i === 3 ? "error de digitación" : null, note: null,
  loans: { code: LOANS[i % 3].code, clients: { full_name: LOANS[i % 3].full_name } },
}));
const CASH = Array.from({ length: 10 }, (_, i) => ({
  id: `cm${i}`, kind: i === 0 ? "disbursement" : i % 2 ? "interest_income" : "capital_recovery", direction: i === 0 ? "out" : "in", amount: "150.00", concept: "x",
  created_at: addDays(TODAY, -i) + "T15:00:00Z", payment_id: `pay${i}`, loan_id: LOANS[0].id, loans: { code: LOANS[0].code },
}));
const LOG = [{ id: "n1", kind: "overdue", for_date: TODAY, chat_id: "123456789", status: "failed", attempts: 2, items: 1, last_error: "Bad Request: chat not found → Telegram no encuentra ese chat. Verifica el Chat ID y que el destinatario haya pulsado «Iniciar» (/start).", created_at: new Date().toISOString() }];
const TABLES = { profiles: PROFILES, clients: CLIENTS, v_loan_summary: LOANS, v_loan_portfolio: LOANS.filter((l) => l.db_status === "active"), installments: INSTALLMENTS, payments: PAYMENTS, cash_movements: CASH,
  notification_log: LOG, notification_runs: [{ job: "morning", trigger: "cron", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), timezone: "America/Lima", status: "partial", obligations_checked: 4, sent: 2, skipped: 1, failed: 1, errors: ["chat not found"] }],
  settings: [{ key: "business", value: { business_name: "LRomero Préstamos y Soluciones", ruc: "20601234567", address: "Av. Principal 123, Lima", currency: "PEN", default_rate_pct: 15, late_fee_pct: 0, grace_days: 0 } }],
  audit_log: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, actor: ADMIN, action: "REGISTER_PAYMENT", entity: "payments", entity_id: `pay${i}`, after: { interest: 150, capital: 150 }, created_at: new Date().toISOString() })),
  loans: LOANS.map((l) => ({ ...l, clients: { full_name: l.full_name } })), telegram_settings: [] };

// MOCK_BIG=N añade N clientes, N préstamos activos y N pagos confirmados (para probar que ninguna lista se trunca a 1 000 filas).
const BIG = Number(process.env.MOCK_BIG ?? 0);
for (let i = 1; i <= BIG; i++) {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const l = loan({ id, code: `PB-${String(i).padStart(5, "0")}`, type: "interest_only", cid: `cb${i}`, name: `Cliente masivo ${i}`, dni: String(50000000 + i), principal: 1000, out: 1000 });
  TABLES.v_loan_summary.push(l); TABLES.v_loan_portfolio.push(l); TABLES.loans.push({ ...l, clients: { full_name: l.full_name } });
  TABLES.clients.push({ id: `cb${i}`, full_name: l.full_name, document_id: l.document_id, phone: null, active: true, address: null, assigned_collector: null });
  TABLES.payments.push({ id: `pb${i}`, loan_id: id, receipt_no: 1000 + i, received_at: addDays(TODAY, -1) + "T15:00:00Z", paid_on: addDays(TODAY, -1), amount: "100.00", interest_amount: "100.00", capital_amount: "0.00", method: "cash", status: "confirmed", reversal_reason: null, note: null, loans: { code: l.code, clients: { full_name: l.full_name } } });
}
// report_totals coherente con los datos del mock (como hace la base de datos real: solo pagos confirmados y préstamos no anulados)
const sumOf = (rows, k) => rows.reduce((t, r) => t + Math.round(Number(r[k]) * 100), 0) / 100;
// Controles de prueba (solo para tests-responsive/middleware-check.mjs): fallo de REST y estado del perfil del usuario.
const STATE = { fail: false, except: "", profile: "ok", runs: "today", role: "admin" };
const RPC = {
  refresh_open_loans: () => 0, list_collectors: () => [{ id: "p3", full_name: "Cobrador de Ruta Norte" }], register_payment: () => "00000000-0000-0000-0000-00000000pay1",
  monthly_cash: () => Array.from({ length: 6 }, (_, i) => ({ month: addDays(TODAY.slice(0, 8) + "01", -30 * (5 - i)), disbursed: "2000", interest: "300", capital: "1000" })),
  report_totals: () => { const ok = TABLES.payments.filter((p) => p.status === "confirmed"); return [{ interest: String(sumOf(ok, "interest_amount")), capital: String(sumOf(ok, "capital_amount")), disbursed: String(sumOf(TABLES.v_loan_summary.filter((l) => l.db_status !== "cancelled"), "principal")) }]; },
  worker_stats: () => PROFILES.map((p) => ({ ...p, clients: 3, collected: "1250.00" })),
  loan_schedule: (b) => INSTALLMENTS.filter((r) => r.loan_id === b.p_loan).map((r, i) => ({ ...r, reference_capital: i === 0 ? "2000" : "1000", capital_applied: i === 0 ? "1000" : "0" })),
};

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS", "Access-Control-Expose-Headers": "content-range" };
const send = (res, code, body, extra = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...cors, ...extra }); res.end(body === undefined ? "" : JSON.stringify(body)); };

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const u = new URL(req.url, "http://x");
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? (() => { try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { return {}; } })() : {};

  if (u.pathname === "/__fail") { STATE.fail = u.searchParams.get("on") === "1"; STATE.except = u.searchParams.get("except") ?? ""; return send(res, 200, STATE); }
  if (u.pathname === "/__profile") { STATE.profile = u.searchParams.get("mode") ?? "ok"; return send(res, 200, STATE); }
  if (u.pathname === "/__role") { STATE.role = u.searchParams.get("r") ?? "admin"; PROFILES[0].role = STATE.role; return send(res, 200, STATE); }
  if (u.pathname === "/__runs") { STATE.runs = u.searchParams.get("mode") ?? "today"; return send(res, 200, STATE); }
  if (STATE.fail && u.pathname.startsWith("/rest/") && !(STATE.except && u.pathname.includes("/" + STATE.except))) return send(res, 500, { message: "fallo simulado", code: "XX000" });
  if (u.pathname === "/auth/v1/token") return send(res, 200, { access_token: jwt(), token_type: "bearer", expires_in: 3600, expires_at: 4102444800, refresh_token: "r-test", user: USER });
  if (u.pathname === "/auth/v1/user") return send(res, 200, USER);
  if (u.pathname === "/auth/v1/logout") return send(res, 204);

  const rpc = /^\/rest\/v1\/rpc\/(\w+)/.exec(u.pathname);
  if (rpc) { const f = RPC[rpc[1]]; return send(res, f ? 200 : 204, f ? f(body) : undefined); }
  const t = /^\/rest\/v1\/(\w+)/.exec(u.pathname);
  if (t) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 201, []);
    let rows = TABLES[t[1]] ?? [];
    if (t[1] === "notification_runs" && STATE.runs === "empty") rows = [];
    if (t[1] === "profiles" && STATE.profile === "inactive") rows = rows.map((r) => (r.id === ADMIN ? { ...r, active: false } : r));
    if (t[1] === "profiles" && STATE.profile === "missing") rows = rows.filter((r) => r.id !== ADMIN);
    for (const [k, v] of u.searchParams) if (v.startsWith("eq.") && !k.includes(".") && !["select", "order", "limit"].includes(k)) rows = rows.filter((r) => String(r[k]) === v.slice(3));
    const total = rows.length;
    const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 0);
    rows = rows.slice(off, off + Math.min(lim || 1000, 1000));   // max_rows = 1000 como en Supabase
    const range = { "Content-Range": rows.length ? `${off}-${off + rows.length - 1}/${total}` : `*/${total}` };
    if (req.method === "HEAD") return send(res, 200, undefined, range);
    if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) return rows[0] ? send(res, 200, rows[0], range) : send(res, 406, { code: "PGRST116", message: "no rows", details: "", hint: "" });
    return send(res, 200, rows, range);
  }
  send(res, 404, { message: "no mock" });
}).listen(PORT, "127.0.0.1", () => console.log("mock supabase en", PORT));
