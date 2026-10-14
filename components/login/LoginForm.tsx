"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, useAnimationControls, useReducedMotion, type Variants } from "framer-motion";
import { CheckCircle2, CircleHelp, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getSession, loginRequest } from "@/lib/auth";
import type { SupportTopicId } from "@/lib/support-info";
import { MAX_SAVED_EMAILS, getSavedEmails, removeEmail, saveEmail } from "@/lib/saved-emails";
import { EASE } from "./field-styles";
import { PasswordInput } from "./PasswordInput";
import { SavedEmailsDropdown } from "./SavedEmailsDropdown";
import { SupportDialog } from "./SupportDialog";
import { ThemeToggle } from "./ThemeToggle";

const schema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Ingresa tu correo electrónico.")
    .email("Ingresa un correo válido, por ejemplo nombre@correo.com."),
  password: z
    .string()
    .min(1, "Ingresa tu contraseña.")
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
  remember: z.boolean(),
});
type LoginValues = z.infer<typeof schema>;

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

export function LoginForm() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const shake = useAnimationControls();
  const [savedEmails, setSavedEmails] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [support, setSupport] = useState<SupportTopicId | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: false },
    mode: "onTouched",
  });

  useEffect(() => {
    setSavedEmails(getSavedEmails());
    void getSession().then((u) => { if (u) router.replace("/dashboard"); });
  }, [router]);

  const emailValue = watch("email").trim().toLowerCase();
  const rememberOn = watch("remember");
  const listFull = savedEmails.length >= MAX_SAVED_EMAILS && !savedEmails.includes(emailValue);

  const onValid = async ({ email, password, remember }: LoginValues) => {
    setFormError(null);
    setSuccess(false);
    try {
      await loginRequest(email, password);
      if (remember) setSavedEmails(saveEmail(email));
      setSuccess(true);
      router.push("/dashboard");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      setFormError(
        code === "AUTH_NOT_CONFIGURED"
          ? "El acceso aún no está configurado: falta conectar Supabase (ver .env.example)."
          : code === "NO_PROFILE"
            ? "Tu usuario no tiene un perfil activo. Contacta al administrador."
            : "Correo o contraseña incorrectos. Revisa tus datos e inténtalo de nuevo.",
      );
      if (!reduce) void shake.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.4 } });
    }
  };

  const onInvalid = () => {
    if (!reduce) void shake.start({ x: [0, -7, 7, -4, 4, 0], transition: { duration: 0.4 } });
  };

  return (
    <div className="relative z-10 flex flex-col justify-center px-6 py-10 sm:px-10 lg:px-14 lg:py-8">
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <form noValidate onSubmit={handleSubmit(onValid, onInvalid)} className="mx-auto w-full max-w-[460px]">
        <motion.div variants={container} initial="hidden" animate="show">
          {/* Logo solo en móvil / tablet chica (sobre fondo oscuro porque el logo es blanco) */}
          <motion.div variants={item} className="mb-9 lg:hidden">
            <span className="inline-flex rounded-2xl bg-ink px-4 py-3">
              <Image src="/logo.png" alt="LRomero Préstamos y Soluciones" width={150} height={50} priority className="h-auto w-[150px]" />
            </span>
          </motion.div>

          <motion.h1 variants={item} className="font-display text-[42px] leading-[1.02] tracking-[-0.01em] text-foreground sm:text-[56px]">
            Bienvenido de nuevo
          </motion.h1>
          <motion.p variants={item} className="mt-3 text-[15px] text-muted-foreground">
            Ingresa tus datos para acceder a tu cuenta.
          </motion.p>

          <motion.div variants={item} className="mt-9">
            <motion.div animate={shake}>
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <SavedEmailsDropdown
                    label="Correo electrónico"
                    name={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    emails={savedEmails}
                    onRemove={(e) => setSavedEmails(removeEmail(e))}
                    onPick={() => setValue("remember", true)}
                    error={errors.email?.message}
                  />
                )}
              />
            </motion.div>
            <Controller
              name="remember"
              control={control}
              render={({ field }) => (
                <label htmlFor="remember" className="-mt-1 flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-[13px] text-muted-foreground">
                  <Checkbox
                    id="remember"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    className="size-[18px] rounded-md border-border data-[state=checked]:border-mint-500 data-[state=checked]:bg-mint-400 data-[state=checked]:text-primary-foreground"
                  />
                  Recordar mi correo
                </label>
              )}
            />
            {rememberOn && listFull && (
              <p className="-mt-1 mb-1 text-xs text-muted-foreground">
                Ya hay {MAX_SAVED_EMAILS} correos guardados. Olvida uno para guardar este.
              </p>
            )}
          </motion.div>

          <motion.div variants={item} className="mt-2">
            <motion.div animate={shake}>
              <PasswordInput label="Contraseña" error={errors.password?.message} {...register("password")} />
            </motion.div>
          </motion.div>

          <motion.div variants={item} className="-mt-1 flex justify-end">
            <button
              type="button"
              onClick={() => setSupport("forgot")}
              className="inline-flex min-h-11 items-center rounded-md text-[13px] font-medium text-mint-600 underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-mint-500"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </motion.div>

          <motion.div variants={item} className="mt-2">
            <div aria-live="polite">
              {formError && <p className="mb-3 text-[13px] text-destructive">{formError}</p>}
              {success && (
                <p role="status" className="mb-3 flex items-center gap-2 text-[13px] text-mint-600">
                  <CheckCircle2 className="size-4" /> Acceso correcto. Entrando al panel…
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-12 w-full rounded-xl bg-mint-400 text-[15px] font-semibold text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.5)_inset] transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:bg-mint-500 hover:shadow-[0_10px_22px_-10px_var(--glow)] active:translate-y-0 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-70"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Iniciando sesión…
                </>
              ) : (
                "Iniciar sesión"
              )}
            </Button>
          </motion.div>

          <motion.div variants={item} className="mt-7 flex items-center gap-4" role="separator">
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">¿Necesitas ayuda?</span>
            <span className="h-px flex-1 bg-border" />
          </motion.div>

          <motion.div variants={item} className="mt-5 grid grid-cols-2 gap-3">
            {[
              { topic: "contact" as const, label: "Contáctanos", Icon: MessageCircle },
              { topic: "help" as const, label: "Ayuda", Icon: CircleHelp },
            ].map(({ topic, label, Icon }) => (
              <Button
                key={label}
                type="button"
                onClick={() => setSupport(topic)}
                variant="outline"
                className="h-12 rounded-xl border-border bg-raised text-[14px] font-medium text-foreground transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:border-mint-400 hover:bg-mint-50 hover:shadow-[0_8px_18px_-12px_rgba(38,48,44,0.35)] active:translate-y-0 active:scale-[0.97]"
              >
                <Icon className="size-[18px] text-mint-600" />
                {label}
              </Button>
            ))}
          </motion.div>
        </motion.div>
      </form>
      <SupportDialog topic={support} onClose={() => setSupport(null)} />
    </div>
  );
}
