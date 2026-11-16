"use client";

import { ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { stepTypeKey, type StepTypeKey } from "@/lib/review-model";
import { cn } from "@/lib/utils";
import { useJobReview } from "./job-review-context";
import { useStepTabLabel } from "./use-step-tab-label";

/** Studio 워크플로우 노드 색(`globals.css` 의 `--node-*`). 모르는 타입은 `--node-other`. */
const NODE_COLOR: Record<StepTypeKey, string> = {
  parse: "var(--node-parse)",
  classify: "var(--node-classify)",
  split: "var(--node-split)",
  extract: "var(--node-extract)",
  instruct: "var(--node-instruct)",
  validate: "var(--node-validate)",
  match: "var(--node-match)",
  merge: "var(--node-merge)",
  export: "var(--node-export)",
};

function nodeColor(type: string): string {
  const key = stepTypeKey(type);
  return key ? NODE_COLOR[key] : "var(--node-other)";
}

/**
 * 검수 화면 Step 탭. Studio 워크플로우 화면의 단계 트랙과 같은 모양이다: 회색 둥근 트랙 안에 실행
 * 순서대로 번호 배지와 타입 이름(같은 타입이 여럿이면 Step 이름도)을 가진 알약 탭이 놓이고, 탭 사이는
 * 꺾쇠로 잇는다.
 * 고른 탭은 흰 바탕에 그 노드 색 테두리, 배지, 글자다. 번호는 Job 전체 Step 순서라 문서에 따라 일부
 * 탭이 숨어도 같은 Step 은 같은 번호다.
 * 트랙 폭이 모자라면 탭이 줄어들어 이름이 말줄임된다(Step 이름이 붙은 탭이 먼저 크게 줄고, 한 탭
 * 안에서는 Step 이름이 타입 이름보다 먼저 잘리며, 바닥은 번호 배지만 남는 폭). 전체 이름은 `title` 과 텍스트 노드에 그대로 있고, 고른 탭은
 * 줄지 않아 키보드로 옮긴 탭의 이름도 다 보인다. 그래도 안 들어가면 트랙이 가로로 스크롤된다.
 *
 * 트랙은 `header` 로 넘겨 화면 머리 가운데에 두고(Studio 와 같은 자리), 고른 탭의 화면(`children`)은
 * 그 아래에 그린다. Job 의 탭이 하나 이하면 트랙 없이(`header(null)`) 화면만 그린다(선택 문서 때문에
 * 탭이 하나만 남은 때는 트랙을 유지해 문서를 바꿀 때 화면이 뛰지 않게 한다). 저장 중에는 탭을
 * 바꿀 수 없다.
 */
export function StepTabs({
  header,
  children,
}: {
  header: (track: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("review.stepTabs");
  const {
    dispatch,
    stepTabs,
    allStepTabs,
    jobStepTabCount,
    activeStepTab,
    saving,
  } = useJobReview();
  const labelOf = useStepTabLabel();
  // Job 의 단계가 하나뿐이면 탭 줄을 두지 않는다. 설정으로 하나만 남긴 경우는 어느 단계인지 보이도록 둔다.
  if (jobStepTabCount <= 1 || !activeStepTab) {
    return (
      <>
        {header(null)}
        {children}
      </>
    );
  }

  // Studio 처럼 탭에는 타입 이름만 두고, 같은 타입 Step 이 여럿일 때만 구분하려고 Step 이름을 붙인다
  // (전체 이름은 title).
  const typeCounts = new Map<string, number>();
  for (const tab of allStepTabs) {
    const key = stepTypeKey(tab.type) ?? tab.type;
    typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
  }
  const showName = (type: string) =>
    (typeCounts.get(stepTypeKey(type) ?? type) ?? 0) > 1;

  const track = (
    // 트리거는 mousedown 에서 직접 focus() 를 부르는데, 그러면 roving-focus 그룹의 "클릭으로
    // 포커스" 플래그가 리셋되지 않아 다음 Tab 진입 때 tablist 자체가 정지가 된다. 기본 동작을
    // 막으면 그룹 핸들러가 건너뛰어 플래그가 서지 않고 트리거의 focus() 는 그대로 동작한다
    // (radix tabs 1.2.1).
    <TabsList
      aria-label={t("label")}
      onMouseDown={event => event.preventDefault()}
      className="h-12 max-w-full justify-start gap-0 overflow-x-auto overflow-y-hidden rounded-full bg-border/60 p-[5px] group-data-horizontal/tabs:h-12"
    >
      {stepTabs.map((tab, index) => {
        const label = labelOf(tab);
        // 설정에서 숨긴 단계가 있어도 원래 순서 번호를 쓴다.
        const order =
          tab.order ?? allStepTabs.findIndex(item => item.id === tab.id) + 1;
        const style = { "--node": nodeColor(tab.type) } as CSSProperties;
        const named =
          label.name !== null && (label.badge === null || showName(tab.type));
        return (
          <Fragment key={tab.id}>
            {index > 0 ? (
              <ChevronRightIcon
                aria-hidden="true"
                className="mx-1 size-4 shrink-0 text-muted-foreground/50"
              />
            ) : null}
            <TabsTrigger
              value={tab.id}
              disabled={saving}
              title={
                tab.editable ? label.full : `${label.full} (${t("readOnly")})`
              }
              style={style}
              // 폭이 모자라면 Step 이름이 붙은 탭이 먼저 줄고(탭 안에서도 이름이 타입보다 먼저), 그래도
              // 모자라면 나머지 탭도 줄며, 고른 탭은 줄지 않는다. flex 에는 "먼저 다 줄인 뒤" 순서가 없어
              // 줄임 비율을 아주 크게 두어 흉내 낸다(작은 값이면 다른 탭도 1~2px 줄어 글자가 말줄임된다).
              // 바닥(min-w-12)에서는 번호 배지만 보이도록 왼쪽부터 채운다.
              className={cn(
                "group/step h-[38px] min-w-12 flex-[0_1_auto] justify-start gap-2 overflow-hidden rounded-full border-2 border-transparent px-3 py-0 text-sm font-medium text-muted-dark shadow-none after:hidden hover:bg-foreground/5 data-active:border-[var(--node)] data-active:bg-background data-active:text-[var(--node)] data-active:shadow-none data-[state=active]:border-[var(--node)] data-[state=active]:bg-background data-[state=active]:text-[var(--node)] data-[state=active]:shadow-none",
                named ? "shrink-[100000]" : "shrink",
                "data-active:shrink-0 data-[state=active]:shrink-0",
              )}
              data-testid={`job-review-step-tab-${tab.id}`}
            >
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted-medium text-xs font-medium text-primary-foreground group-data-active/step:bg-[var(--node)] group-data-[state=active]/step:bg-[var(--node)]"
              >
                {order}
              </span>
              {label.badge !== null ? (
                <span className="min-w-0 truncate">{label.badge}</span>
              ) : null}
              {named ? (
                <span className="min-w-0 max-w-40 shrink-[100000] truncate font-normal text-muted-foreground">
                  {label.name}
                </span>
              ) : null}
              {!tab.editable ? (
                <span className="sr-only">{t("readOnly")}</span>
              ) : null}
            </TabsTrigger>
          </Fragment>
        );
      })}
    </TabsList>
  );

  return (
    <Tabs
      value={activeStepTab.id}
      onValueChange={value => {
        const tab = stepTabs.find(item => item.id === value);
        if (tab) dispatch({ type: "SET_STEP_TAB", tab });
      }}
      className="min-w-0 gap-3 xl:fit:min-h-0 xl:fit:flex-1"
    >
      {header(track)}
      {/* 패널 바로 아래에 포커스 가능한 요소(라벨 검색 등)가 이어지므로 패널 자체는 Tab 정지가
          아니어도 된다(WAI-ARIA APG Tabs). 프로그램 포커스는 여전히 가능하다. */}
      <TabsContent
        value={activeStepTab.id}
        tabIndex={-1}
        className="min-w-0 xl:fit:flex xl:fit:min-h-0 xl:fit:flex-col"
      >
        {children}
      </TabsContent>
    </Tabs>
  );
}
