import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RockShowBot — seu próximo show começa aqui",
  description: "Seu radar pessoal de shows. Conecte o Apple Music e acompanhe anúncios e possíveis datas no Brasil e exterior.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
