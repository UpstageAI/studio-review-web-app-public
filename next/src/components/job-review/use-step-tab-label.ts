"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { stepTypeKey } from "@/lib/review-model";
import { NO_LAYOUT_STEP_TAB_ID, type StepTab } from "./step-tabs-model";

export type StepTabLabel = {
  /** 타입 배지 글자. 분류 없는 보기는 `null`. */
  badge: string | null;
  /** 이름(같은 타입·이름이 여럿이면 뒤에 순번, 이름이 없으면 순번만). 둘 다 없으면 `null`(배지만). */
  name: string | null;
  /** 배지 + 이름을 이어 붙인 글자(`title`·요약 문구용). */
  full: string;
};

/** Step 탭의 배지·이름 글자를 만든다. */
export function useStepTabLabel(): (tab: StepTab) => StepTabLabel {
  const t = useTranslations("review.stepTabs");
  const tt = useTranslations("review.stepTypes");
  return useCallback(
    (tab: StepTab) => {
      if (tab.id === NO_LAYOUT_STEP_TAB_ID) {
        const name = t("noLayout");
        return { badge: null, name, full: name };
      }
      const key = stepTypeKey(tab.type);
      const badge = key ? tt(key) : tab.type || null;
      const name = tab.ordinal
        ? tab.name !== null
          ? `${tab.name} ${tab.ordinal}`
          : String(tab.ordinal)
        : tab.name;
      const full = [badge, name].filter(Boolean).join(" ") || tab.id;
      return { badge, name, full };
    },
    [t, tt],
  );
}
