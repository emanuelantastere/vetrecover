import type { Metadata } from "next";
import "./globals.css";
import "./states.css";
import "./imports.css";
import "./intelligence.css";
import "./usability.css";

export const metadata: Metadata = {
  title: "VetRecover — Inteligência comercial veterinária",
  description: "Identifique oportunidades comerciais e acompanhe resultados da sua clínica veterinária.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
