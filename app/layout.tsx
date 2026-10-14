import type { Metadata } from "next";
import { Instrument_Serif, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Iniciar sesión | LRomero Préstamos y Soluciones",
  description: "Accede a tu cuenta de LRomero Préstamos y Soluciones.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${manrope.variable} ${instrument.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("lromero:theme")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
