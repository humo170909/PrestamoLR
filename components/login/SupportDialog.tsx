"use client";

import { CircleHelp, KeyRound, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { supportTopics, type SupportTopicId } from "@/lib/support-info";
import { SUPPORT_CONTACT } from "@/lib/config";

const ICON = { forgot: KeyRound, contact: MessageCircle, help: CircleHelp } as const;

/** Información de ayuda del login (contraseña olvidada, contacto, ayuda). Sin recuperación por correo todavía: ver lib/support-info.ts. */
export function SupportDialog({ topic, onClose }: { topic: SupportTopicId | null; onClose: () => void }) {
  const t = topic ? supportTopics(SUPPORT_CONTACT)[topic] : null;
  return (
    <Modal
      open={topic !== null}
      icon={topic ? ICON[topic] : undefined}
      title={t?.title ?? ""}
      onClose={onClose}
      footer={<Button type="button" data-autofocus onClick={onClose} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">Entendido</Button>}
    >
      <div className="space-y-3 text-[14px] leading-relaxed text-foreground">
        {t?.paragraphs.map((p) => <p key={p}>{p}</p>)}
      </div>
    </Modal>
  );
}
