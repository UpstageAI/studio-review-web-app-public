"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getLeaveConfirmRequest,
  registerLeaveConfirmHost,
  settleLeaveConfirm,
  subscribeLeaveConfirm,
} from "@/lib/leave-confirm";

/**
 * 앱 안 이동 전 "떠날까요?" 확인 창. 앱에 한 번 마운트해 `@/lib/leave-confirm` 의 요청을 그린다.
 * 처음 포커스는 "머무르기"(첫 버튼)에 간다. Esc·바깥 클릭·"머무르기" 는 떠나지 않음(`false`), "나가기" 만
 * `true`. 마운트되지 않은 화면에서는 저장소가 브라우저 기본 확인 창으로 답한다.
 */
export function LeaveConfirmDialog() {
  const t = useTranslations("common.leaveConfirm");
  const request = useSyncExternalStore(
    subscribeLeaveConfirm,
    getLeaveConfirmRequest,
    () => null,
  );
  useEffect(() => registerLeaveConfirmHost(), []);

  return (
    <Dialog
      open={request !== null}
      onOpenChange={open => {
        if (!open && request) settleLeaveConfirm(request.id, false);
      }}
    >
      {request ? (
        <DialogContent
          showCloseButton={false}
          className="sm:max-w-md"
          data-testid="leave-confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle>{request.title ?? t("title")}</DialogTitle>
            <DialogDescription>{request.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => settleLeaveConfirm(request.id, false)}
              data-testid="leave-confirm-button-stay"
            >
              {t("stay")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => settleLeaveConfirm(request.id, true)}
              data-testid="leave-confirm-button-leave"
            >
              {request.confirmLabel ?? t("leave")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
