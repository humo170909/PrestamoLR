import { PanelShell } from "@/components/panel/PanelShell";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
