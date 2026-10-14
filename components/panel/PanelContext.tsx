"use client";

import { createContext, useContext } from "react";
import type { SessionUser } from "@/lib/auth";

interface PanelCtx {
  user: SessionUser;
  sede: string;
  setSede: (id: string) => void;
  logout: () => void;
}

export const PanelContext = createContext<PanelCtx | null>(null);

export function usePanel() {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error("usePanel debe usarse dentro de PanelShell");
  return ctx;
}
