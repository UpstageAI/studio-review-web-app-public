import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AppHeader } from "@/components/app-header";
import { LeaveConfirmDialog } from "@/components/leave-confirm-dialog";
import { MockGate } from "@/components/pages-demo/mock-gate";
import { HeaderSlotProvider } from "@/components/showcase/header-slot";
import { routing } from "@/i18n/routing";
import { PAGES_DEMO } from "@/lib/pages-demo";
import "../globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map(locale => ({ locale }));
}

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};

  const t = await getTranslations({ locale, namespace: "metadata" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      languages: Object.fromEntries(routing.locales.map(l => [l, `/${l}`])),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // 정적 렌더링(SSG) 활성화
  setRequestLocale(locale);

  const app = (
    <HeaderSlotProvider>
      <AppHeader />
      {children}
      <LeaveConfirmDialog />
    </HeaderSlotProvider>
  );

  return (
    <html lang={locale} className={`${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>
          {/* Pages 데모는 mock API(서비스 워커)가 준비된 뒤에 화면을 그린다. */}
          {PAGES_DEMO ? <MockGate>{app}</MockGate> : app}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
