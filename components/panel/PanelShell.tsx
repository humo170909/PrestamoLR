"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Bell, Building2, Loader2, LogOut, Menu, Search, X } from "lucide-react";
import { ThemeToggle } from "@/components/login/ThemeToggle";
import { EASE } from "@/components/login/field-styles";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clearSession, getSession, type SessionUser } from "@/lib/auth";
import { ALERTS as DEMO_ALERTS, CLIENTS as DEMO_CLIENTS, LOANS as DEMO_LOANS, SEDES } from "@/lib/mock";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { fetchAlerts, searchLive, type AlertItem, type SearchHit } from "@/lib/data/shell";
import { navFor, hrefOf } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { PanelContext, usePanel } from "./PanelContext";
import { fieldClass } from "./ui";

// Con Supabase no se muestran datos ficticios (ver DataSourceNotice).
const CLIENTS = isSupabaseConfigured ? [] : DEMO_CLIENTS;
const LOANS = isSupabaseConfigured ? [] : DEMO_LOANS;

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = usePanel();
  return (
    <div className="flex h-full w-full flex-col bg-card">
      <div className="px-6 pb-2 pt-7">
        <Link href="/dashboard" className="text-[22px] font-extrabold tracking-[0.18em] text-foreground focus-visible:outline-2 focus-visible:outline-mint-500">
          LROMERO
        </Link>
      </div>
      <nav aria-label="Principal" className="flex-1 overflow-y-auto px-3 pb-4">
        {navFor(user.roleKey).map((g) => (
          <div key={g.group}>
            <p className="px-3 pb-1 pt-5 text-xs font-medium text-muted-foreground">{g.group}</p>
            {g.items.map(({ id, label, icon: Icon }) => {
              const href = id === "dashboard" ? "/dashboard" : hrefOf(id);
              const active = pathname === href;
              return (
                <Link
                  key={id}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-mint-500",
                    active ? "bg-mint-100 font-medium text-foreground" : "text-muted-foreground hover:bg-mint-50 hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute left-0 top-2.5 h-6 w-[3px] rounded-r-full bg-mint-500" />}
                  <Icon className={cn("size-[18px]", active ? "text-mint-600" : "text-muted-foreground group-hover:text-mint-600")} />
                  {label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <div className="flex items-center gap-3 rounded-xl p-2">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mint-100 text-sm font-semibold text-mint-600">
            {user.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.role}</p>
          </div>
          <button type="button" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión" className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-mint-50 hover:text-foreground">
            <LogOut className="size-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [liveHits, setLiveHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const t = setTimeout(() => { searchLive(q).then(setLiveHits).catch(() => setLiveHits([])); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const demoResults = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const clients = CLIENTS.filter((c) => String(c.name).toLowerCase().includes(s) || String(c.dni).includes(s))
      .slice(0, 4).map((c) => ({ key: `c${c.dni}`, type: "Cliente", title: String(c.name), sub: `DNI ${c.dni}`, href: "/clientes" }));
    const loans = LOANS.filter((l) => String(l.id).toLowerCase().includes(s) || String(l.client).toLowerCase().includes(s))
      .slice(0, 4).map((l) => ({ key: `l${l.id}`, type: "Préstamo", title: String(l.id), sub: String(l.client), href: "/prestamos" }));
    return [...clients, ...loans];
  }, [q]);
  const results = isSupabaseConfigured ? liveHits : demoResults;
  const show = open && q.trim().length >= 2;

  return (
    <div className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        placeholder="Buscar cliente, DNI o préstamo"
        aria-label="Buscador global"
        className={cn(fieldClass, "pl-10")}
      />
      {show && (
        <ul className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.35)]">
          {results.length ? results.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); setQ(""); setOpen(false); router.push(r.href); }}
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-mint-100"
              >
                <span className="min-w-0"><span className="block truncate text-foreground">{r.title}</span><span className="block truncate text-xs text-muted-foreground">{r.sub}</span></span>
                <span className="shrink-0 rounded-full bg-mint-100 px-2 py-0.5 text-xs text-mint-600">{r.type}</span>
              </button>
            </li>
          )) : <li className="px-3 py-4 text-sm text-muted-foreground">Sin resultados para “{q}”.</li>}
        </ul>
      )}
    </div>
  );
}

function AlertsMenu() {
  const { user } = usePanel();
  const [ALERTS, setAlerts] = useState<AlertItem[]>(isSupabaseConfigured ? [] : (DEMO_ALERTS as AlertItem[]));
  useEffect(() => { if (isSupabaseConfigured) fetchAlerts(user.roleKey === "admin").then(setAlerts).catch(() => setAlerts([])); }, [user.roleKey]);
  const dot: Record<string, string> = { danger: "bg-destructive", warn: "bg-amber-500", info: "bg-sky-500" };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Alertas (${ALERTS.length})`} className="relative flex size-10 items-center justify-center rounded-full border border-border bg-raised text-muted-foreground transition-all duration-200 ease-out-expo hover:border-mint-400 hover:text-foreground active:scale-95">
          <Bell className="size-[18px]" />
          {ALERTS.length > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-[18px] items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-background">{ALERTS.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(340px,calc(100vw-2rem))] rounded-2xl p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.35)]">
        <p className="px-3 py-2 text-sm font-semibold text-foreground">Alertas</p>
        {ALERTS.length === 0 && <p className="px-3 pb-3 text-sm text-muted-foreground">Sin alertas.</p>}
        {ALERTS.map((a) => (
          <div key={a.id} className="flex gap-3 rounded-xl px-3 py-2.5 hover:bg-mint-50">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[a.tone])} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{a.title}</p>
              <p className="text-xs text-muted-foreground">{a.detail}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/80">{a.time}</p>
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function SedeSelect() {
  const { sede, setSede } = usePanel();
  if (isSupabaseConfigured) return null; // las sedes reales llegarán con la tabla de rutas/sedes
  return (
    <label className="relative hidden sm:block">
      <span className="sr-only">Sede o ruta</span>
      <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <select value={sede} onChange={(e) => setSede(e.target.value)} className={cn(fieldClass, "h-10 w-[220px] bg-raised pl-9")}>
        {SEDES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </label>
  );
}

export function PanelShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sede, setSede] = useState("all");
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    void getSession().then((s) => {
      if (!s) router.replace("/");
      else setUser(s);
    });
  }, [router]);
  useEffect(() => setNavOpen(false), [pathname]);

  if (!user) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="Cargando">
        <Loader2 className="size-6 animate-spin text-mint-600" />
      </div>
    );
  }

  const logout = () => { void clearSession().then(() => router.replace("/")); };

  return (
    <MotionConfig reducedMotion="user">
    <PanelContext.Provider value={{ user, sede, setSede, logout }}>
      <div className="min-h-dvh bg-background">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-border lg:block">
          <SidebarNav />
        </aside>

        <AnimatePresence>
          {navOpen && (
            <>
              <motion.div className="fixed inset-0 z-40 bg-black/50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setNavOpen(false)} />
              <motion.aside
                className="fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] border-r border-border lg:hidden"
                initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }} transition={{ duration: 0.28, ease: EASE }}
              >
                <button type="button" onClick={() => setNavOpen(false)} aria-label="Cerrar menú" className="absolute right-3 top-4 z-10 flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-mint-50"><X className="size-5" /></button>
                <SidebarNav onNavigate={() => setNavOpen(false)} />
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <div className="lg:pl-[264px]">
          <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6 lg:px-8">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Abrir menú" className="flex size-10 items-center justify-center rounded-full border border-border bg-raised text-foreground lg:hidden"><Menu className="size-5" /></button>
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2">
              <SedeSelect />
              <AlertsMenu />
              <ThemeToggle className="size-10" />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
        </div>
      </div>
    </PanelContext.Provider>
    </MotionConfig>
  );
}
