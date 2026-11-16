"use client";

import { useState } from "react";
import {
  ReviewActions,
  type ReviewActionsLabels,
  type ReviewActionsStatus,
} from "@/components/studio-ui-kit/review-actions";
import { Button } from "@/components/ui/button";
import { Section, StateLine, TEST_ID } from "./demo-section";

const ACTIONS_LABELS: ReviewActionsLabels = {
  tray: "Changes",
  save: "Save",
  saving: "Saving…",
};

/**
 * 저장·완료 버튼 줄. 저장 가능 판정과 저장·완료 동작은 호출자 몫이라 이 데모는 지역 state 로 흉내 낸다:
 * 저장하면 변경 수가 0 이 되고(충돌을 켜 두면 실패 문구), 변경이 남은 채 완료하면 먼저 저장한다.
 */
export function ReviewActionsDemo() {
  const [changeCount, setChangeCount] = useState(2);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [trayOpen, setTrayOpen] = useState(false);
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState<ReviewActionsStatus | null>(null);

  /** 저장해 보고 성공했는지 돌려준다. */
  const save = () => {
    if (conflict) {
      setStatus({
        text: "Save failed: someone else saved first.",
        tone: "error",
      });
      return false;
    }
    setChangeCount(0);
    setVersion(version + 1);
    setStatus({
      text: "Saved",
      tone: "muted",
      title: `Version ${version + 1}`,
    });
    return true;
  };

  const saveFirst = !completed && changeCount > 0;

  return (
    <Section
      title="review-actions"
      description="The save and complete row: save status, the changes button with a count badge, Save and the primary action. Whether saving is allowed and what saving does are up to the caller — here local toggles stand in for them. With the conflict toggle on, saving fails; completing with unsaved changes saves first."
      testId={`${TEST_ID}-review-actions-section`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => {
            setChangeCount(count => count + 1);
            setStatus(null);
          }}
          disabled={completed}
          data-testid={`${TEST_ID}-review-actions-add-change`}
        >
          Add a change
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saving}
            onChange={event => setSaving(event.target.checked)}
            className="accent-primary"
            data-testid={`${TEST_ID}-review-actions-saving`}
          />
          Saving in progress
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={conflict}
            onChange={event => setConflict(event.target.checked)}
            className="accent-primary"
            data-testid={`${TEST_ID}-review-actions-conflict`}
          />
          Answer saves with a conflict
        </label>
      </div>
      <ReviewActions
        status={status}
        changeCount={changeCount}
        trayOpen={trayOpen}
        onOpenTray={() => setTrayOpen(open => !open)}
        onSave={save}
        saveDisabled={saving || completed || changeCount === 0}
        saving={saving}
        saveEmphasized={changeCount > 0}
        primary={
          completed
            ? {
                label: "Reopen",
                variant: "outline",
                disabled: saving,
                onClick: () => {
                  setCompleted(false);
                  setStatus({ text: "Reopened", tone: "ok" });
                },
              }
            : {
                label: saveFirst ? "Save and complete" : "Complete review",
                disabled: saving,
                onClick: () => {
                  if (saveFirst && !save()) return;
                  setCompleted(true);
                  setStatus({ text: "Review completed", tone: "ok" });
                },
                buttonProps: saveFirst ? { "data-save-first": "" } : undefined,
              }
        }
        labels={ACTIONS_LABELS}
        testId={`${TEST_ID}-review-actions`}
      />
      {trayOpen ? (
        <p
          className="rounded-md border border-border p-3 text-sm text-muted-foreground"
          data-testid={`${TEST_ID}-review-actions-tray`}
        >
          {changeCount === 0
            ? "No unsaved changes."
            : `${changeCount} unsaved changes (the app opens a side sheet here).`}
        </p>
      ) : null}
      <StateLine testId={`${TEST_ID}-review-actions-state`}>
        {JSON.stringify({
          changeCount,
          saving,
          conflict,
          completed,
          trayOpen,
          version,
        })}
      </StateLine>
    </Section>
  );
}
