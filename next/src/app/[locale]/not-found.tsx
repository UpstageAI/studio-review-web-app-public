import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("notFound");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-16 py-32">
      <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
      <Link href="/" className="underline">
        {t("backHome")}
      </Link>
    </main>
  );
}
