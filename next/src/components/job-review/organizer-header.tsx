"use client";

import { Grid2x2Icon, Grid3x3Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useOrganizer } from "./organizer-context";
import { SegmentedIcons } from "./segmented-icons";

/**
 * 페이지 정리 화면의 머리 줄: 제목, 썸네일 크기(작게, 크게 아이콘 묶음), 완료. 정리 화면은 작업 패널
 * 자리에 들어가는 모드라 제목과 닫는 단추를 패널 안에 둔다. 완료로 닫으면 포커스를 뷰어 툴바의 페이지
 * 정리 토글로 돌려준다(이 단추는 닫히면서 사라진다).
 */
export function OrganizerHeader({ headingId }: { headingId: string }) {
  const t = useTranslations("review.organizer");
  const { size, setSize, setOpen, toggleId } = useOrganizer();
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      <h2
        id={headingId}
        className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground"
      >
        {t("title")}
      </h2>
      <SegmentedIcons
        label={t("size")}
        value={size}
        onChange={setSize}
        options={[
          {
            value: "s",
            label: t("sizeSmall"),
            icon: Grid3x3Icon,
            testId: "job-review-organizer-size-s",
          },
          {
            value: "m",
            label: t("sizeMedium"),
            icon: Grid2x2Icon,
            testId: "job-review-organizer-size-m",
          },
        ]}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="cursor-pointer"
        onClick={() => {
          setOpen(false);
          document.getElementById(toggleId)?.focus();
        }}
        data-testid="job-review-organizer-button-done"
      >
        {t("done")}
      </Button>
    </div>
  );
}
