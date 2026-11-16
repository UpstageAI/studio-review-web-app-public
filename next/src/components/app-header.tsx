import { useTranslations } from "next-intl";
import { HeaderSlotTarget } from "@/components/showcase/header-slot";
import { PAGE_CONTAINER } from "@/components/page-container";
import { LeaveGuardLink } from "@/components/leave-guard-link";
import { SettingsMenu } from "@/components/showcase/settings-menu";

/**
 * 모든 페이지 맨 위의 공통 상단 바. 왼쪽은 앱 이름(처음 화면 링크), 오른쪽 끝은 설정 메뉴(언어, 검수
 * 큐, 부가 기능)이고, 그 사이는 화면이 채우는 자리다(검수 화면은 검수 큐의 이전, 다음 Job). 안쪽 폭은
 * 모든 화면과 같은 가로 틀(`PAGE_CONTAINER`)을 써서, 어느 화면에서든 설정 메뉴와 화면 왼쪽 끝이 같은
 * 자리에 있게 한다. 검수 화면에 저장하지 않은 변경이 있으면 앱 이름 링크와 언어 바꾸기가 떠날지 먼저 묻는다.
 */
export function AppHeader() {
  const t = useTranslations("appHeader");
  return (
    <header className="h-14 shrink-0 border-b border-border bg-subtle">
      <div className={`${PAGE_CONTAINER} flex h-full items-center gap-6`}>
        <LeaveGuardLink
          href="/"
          aria-label={t("homeLabel")}
          className="shrink-0 rounded-sm text-[15px] font-semibold tracking-tight text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
          data-testid="app-header-link-home"
        >
          {t("home")}
        </LeaveGuardLink>
        {/* 화면이 보이는 내용을 채우면 설정 메뉴와의 사이에 세로 구분선이 생긴다. 비어 있는 안내(예: 완료
            안내의 status 자리)만 있을 때는 생기지 않는다. */}
        <HeaderSlotTarget className="flex min-w-0 flex-1 items-center justify-end gap-4 has-[>:not(:empty)]:border-r has-[>:not(:empty)]:border-border has-[>:not(:empty)]:pr-6" />
        <SettingsMenu />
      </div>
    </header>
  );
}
