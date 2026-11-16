import { use } from "react";
import {
  FilePenLineIcon,
  FolderSearchIcon,
  ListChecksIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { HomeActivity } from "@/components/showcase/home/home-activity";
import {
  CollectionsPreview,
  JobsPreview,
  ReviewPreview,
} from "@/components/showcase/home/previews";
import { StepCard } from "@/components/showcase/home/step-card";
import { StepStrip } from "@/components/showcase/home/step-strip";
import { PAGE_CONTAINER } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { Link } from "@/i18n/navigation";

export default function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  setRequestLocale(locale as Locale);

  const t = useTranslations("home");

  const steps = [
    {
      key: "collections",
      icon: <FolderSearchIcon />,
      preview: <CollectionsPreview />,
    },
    { key: "detail", icon: <ListChecksIcon />, preview: <JobsPreview /> },
    { key: "job", icon: <FilePenLineIcon />, preview: <ReviewPreview /> },
  ] as const;

  // 일본어는 띄어쓰기가 드물어 `keep-all` 아래에서 긴 구절이 카드 밖으로 넘치므로, 넘칠 때만 아무 곳에서나 줄바꿈한다.
  // 대시보드가 보이면(`data-home-dashboard`) 한 화면에 들어가도록 소개 아래 간격과 아래 여백만 줄인다.
  // 소개의 위치는 그대로 둬 대시보드가 나타나도 제목이 움직이지 않는다.
  return (
    <main
      className={`${PAGE_CONTAINER} flex flex-1 flex-col gap-12 py-12 wrap-anywhere md:py-16 has-[[data-home-dashboard]]:gap-6 has-[[data-home-dashboard]]:pb-8`}
    >
      <section className="flex flex-col items-start gap-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {t("title")}
        </h1>
        {/* 설명은 폭 제한 없이 두어 데스크톱 폭에서는 한 줄로 보인다(좁은 화면에서만 줄바꿈). */}
        <p className="text-lg text-muted-foreground">{t("description")}</p>
        <Button asChild size="lg">
          <Link href="/collections" data-testid="home-link-collections">
            {t("cta")}
          </Link>
        </Button>
      </section>

      <HomeActivity
        steps={
          <ol className="grid gap-6 md:grid-cols-3">
            {steps.map((step, index) => (
              <StepCard
                key={step.key}
                stepLabel={t("stepLabel", { step: index + 1 })}
                icon={step.icon}
                title={t(`steps.${step.key}.title`)}
                description={t(`steps.${step.key}.description`)}
                items={[
                  t(`steps.${step.key}.items.0`),
                  t(`steps.${step.key}.items.1`),
                  t(`steps.${step.key}.items.2`),
                  t(`steps.${step.key}.items.3`),
                ]}
                preview={step.preview}
              />
            ))}
          </ol>
        }
        compactSteps={
          <StepStrip
            label={t("stepsLabel")}
            steps={steps.map((step, index) => ({
              key: step.key,
              stepLabel: t("stepLabel", { step: index + 1 }),
              icon: step.icon,
              title: t(`steps.${step.key}.title`),
              description: t(`steps.${step.key}.description`),
            }))}
          />
        }
      />
    </main>
  );
}
