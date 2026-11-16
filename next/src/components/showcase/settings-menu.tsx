"use client";

import { SettingsIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useTransition } from "react";
import { useQueueAdvance } from "@/components/showcase/review-queue/use-review-queue";
import { confirmAppLeave } from "@/components/leave-guard-store";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { localeNames, type Locale } from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import {
  REVIEW_FEATURE_GROUPS,
  useReviewFeatures,
} from "@/lib/review-policy/review-features";
import {
  READ_ONLY_STEP_TYPES,
  REVIEW_STEP_TYPES,
  useReviewSteps,
} from "@/lib/review-policy/review-steps";

/** 체크 항목 안의 이름과 한 줄 설명. */
function ItemText({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </span>
  );
}

/**
 * 공통 상단 바 오른쪽의 설정 메뉴. 언어, 검수할 단계(모든 Job 에 같이 적용되는 전체 설정, 기본은 보기
 * 전용 Parse 와 Instruct 를 뺀 단계), 검수 큐("완료하면 다음 Job 열기"), 검수 화면 부가 기능(페이지 편집
 * 묶음과 고급 묶음, 기본 꺼짐)을 한곳에서 바꾼다. 체크 항목은 눌러도 메뉴가 닫히지 않아 여러 개를 이어서 바꿀 수 있다.
 * 언어를 고르면 같은 화면·같은 query 의 그 언어 주소로 옮긴다(검수 화면에 저장하지 않은 변경이 있으면 먼저 묻는다).
 */
export function SettingsMenu() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [advance, setAdvance] = useQueueAdvance();
  const [features, setFeature] = useReviewFeatures();
  const [steps, setStep] = useReviewSteps();
  const tt = useTranslations("review.stepTypes");
  // 같은 화면의 다른 언어 주소로 옮긴다(예: /ko/collections?order=asc → /ja/collections?order=asc). 주소
  // query(목록의 정렬·필터·페이지, 검수 화면의 ?doc&page)는 그대로 둔다. 화면을 새로 그려 편집 내용이
  // 사라지므로, 검수 화면에 저장하지 않은 변경이 있으면 먼저 묻는다. routing 에 pathnames 가 없어
  // usePathname 은 locale 을 뺀 실제 경로를 준다.
  // 같은 root layout(`[locale]`) 안의 클라이언트 이동이라 `beforeunload` 는 다시 뜨지 않는다. 묻는
  // 동안 다른 언어를 또 고르면 앞 확인은 "머무르기" 로 닫히고 뒤 것만 남는다.
  const changeLocale = async (next: Locale) => {
    if (next === locale) return;
    const search = window.location.search;
    if (!(await confirmAppLeave())) return;
    startTransition(() => {
      router.replace(pathname + search, { locale: next });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="default"
          className="cursor-pointer text-muted-dark"
          data-testid="app-header-button-settings"
        >
          <SettingsIcon aria-hidden="true" />
          {t("label")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>{t("language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={value => void changeLocale(value as Locale)}
        >
          {routing.locales.map(item => (
            <DropdownMenuRadioItem
              key={item}
              value={item}
              disabled={isPending}
              data-testid={`settings-menu-radio-locale-${item}`}
            >
              {localeNames[item]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span>{t("stepsPick")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("stepsHint")}
          </span>
        </DropdownMenuLabel>
        {/* 모든 Job 에 똑같이 적용되는 전체 설정이라 종류를 늘 모두 나열한다(세 칸 격자). */}
        <div className="grid grid-cols-3" data-testid="settings-menu-steps">
          {REVIEW_STEP_TYPES.map(type => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={steps[type]}
              onCheckedChange={value => setStep(type, value === true)}
              onSelect={event => event.preventDefault()}
              title={READ_ONLY_STEP_TYPES.has(type) ? t("readOnly") : undefined}
              data-testid={`settings-menu-checkbox-step-${type}`}
            >
              {tt(type)}
            </DropdownMenuCheckboxItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("queue")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={advance}
          onCheckedChange={value => setAdvance(value === true)}
          onSelect={event => event.preventDefault()}
          data-testid="settings-menu-checkbox-advance"
        >
          <ItemText label={t("advance")} hint={t("advanceHint")} />
        </DropdownMenuCheckboxItem>
        {REVIEW_FEATURE_GROUPS.map(group => (
          <Fragment key={group.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span>{t(`groups.${group.id}`)}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {t(`groupHints.${group.id}`)}
              </span>
            </DropdownMenuLabel>
            {group.features.map(feature => (
              <DropdownMenuCheckboxItem
                key={feature}
                checked={features[feature]}
                onCheckedChange={value => setFeature(feature, value === true)}
                onSelect={event => event.preventDefault()}
                data-testid={`settings-menu-checkbox-${feature}`}
              >
                <ItemText
                  label={t(`feature.${feature}`)}
                  hint={t(`featureHint.${feature}`)}
                />
              </DropdownMenuCheckboxItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
