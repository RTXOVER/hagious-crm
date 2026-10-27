import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import { readPreferencesCookie } from "@/lib/preferences-server";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "latin-ext"],
});

export const metadata: Metadata = {
  title: { default: "CRM Hagious", template: "%s · CRM Hagious" },
  description: "Central de relacionamento e operação contábil da Hagious",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Tema e tamanho da letra já no HTML enviado (sem "piscar" ao carregar)
  const prefs = await readPreferencesCookie();
  return (
    // suppressHydrationWarning: extensões (ex.: Dark Reader) alteram atributos do <html>/<body>
    <html
      lang={prefs?.language ?? "pt-BR"}
      data-theme={prefs && prefs.theme !== "system" ? prefs.theme : undefined}
      data-font={prefs && prefs.font_scale !== "md" ? prefs.font_scale : undefined}
      className={`${manrope.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full font-sans" suppressHydrationWarning>{children}</body>
    </html>
  );
}
