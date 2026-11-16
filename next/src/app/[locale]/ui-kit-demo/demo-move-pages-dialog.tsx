"use client";

import { useState } from "react";
import {
  MovePagesDialog,
  type MovePagesDialogLabels,
  type MovePagesRequest,
  type MovePagesResult,
  type MovePagesSource,
} from "@/components/studio-ui-kit/move-pages-dialog";
import { Button } from "@/components/ui/button";
import { LABEL_CHOICES, MOVE_TARGETS } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

const MOVE_LABELS: MovePagesDialogLabels = {
  title: "Move pages",
  description:
    'Choose pages of this document and where to put them. Pick "New document" to split them into a new document with a label.',
  selectionDescription:
    'Choose where to put the selected pages. Pick "New document" to split them into a new document with a label.',
  from: "From page",
  to: "To page",
  target: "Target document",
  documentOption: (index, label) =>
    `Document ${index} · ${label ?? "(no label)"}`,
  newDocument: "New document (right after the source)",
  onlyNewDocument:
    "No other document in this file group, so the pages are split into a new document.",
  newDocumentLabel: "New document label",
  noLabel: "(no label)",
  position: "Position",
  positions: {
    end: "At the end",
    start: "At the start",
    before: "Before a page",
  },
  beforePage: max => `Position in the target document (1–${max})`,
  invalidRange: total => `Enter a range from 1 to ${total}.`,
  invalidBefore: total => `Enter a page from 1 to ${total}.`,
  targetMissing: "The target document is gone. Pick another one.",
  cancel: "Cancel",
  move: "Move",
};

const RANGE_SOURCE: MovePagesSource = {
  kind: "range",
  pageCount: 4,
  currentIndex: 1,
};

const SELECTION_SOURCE: MovePagesSource = {
  kind: "selection",
  count: 3,
  summary: "3 pages selected: invoices.pdf p1, p2 and p5",
};

const FAILURE_MESSAGE = "The move was rejected (demo failure response).";

export function MovePagesDialogDemo() {
  const [source, setSource] = useState<MovePagesSource | null>(null);
  const [fail, setFail] = useState(false);
  const [request, setRequest] = useState<MovePagesRequest | null>(null);

  // 데모 구조는 바꾸지 않고 마지막 요청만 보인다. "실패 응답" 이면 대화 상자가 message 를 보이고 닫히지 않는다.
  const onMove = (next: MovePagesRequest): MovePagesResult => {
    setRequest(next);
    return fail ? { ok: false, message: FAILURE_MESSAGE } : { ok: true };
  };

  return (
    <Section
      title="move-pages-dialog"
      description="Move a page range (or a selection) to another document or into a new labelled document. The demo does not change any structure: it shows the last request, and the failure toggle makes the dialog show the returned message instead of closing."
      testId={`${TEST_ID}-move-pages-section`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => setSource(RANGE_SOURCE)}
          data-testid={`${TEST_ID}-move-pages-open-range`}
        >
          Open with a range
        </Button>
        <Button
          variant="outline"
          onClick={() => setSource(SELECTION_SOURCE)}
          data-testid={`${TEST_ID}-move-pages-open-selection`}
        >
          Open with a selection
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fail}
            onChange={event => setFail(event.target.checked)}
            className="accent-primary"
            data-testid={`${TEST_ID}-move-pages-fail`}
          />
          Answer with a failure
        </label>
      </div>
      <StateLine testId={`${TEST_ID}-move-pages-request`}>
        {request ? JSON.stringify(request) : "No request yet."}
      </StateLine>
      <MovePagesDialog
        open={source !== null}
        onOpenChange={open => {
          if (!open) setSource(null);
        }}
        targets={MOVE_TARGETS}
        labelChoices={LABEL_CHOICES}
        defaultLabel={source?.kind === "selection" ? null : "Memo"}
        source={source ?? RANGE_SOURCE}
        onMove={onMove}
        labels={MOVE_LABELS}
        testId={`${TEST_ID}-move-pages-dialog`}
      />
    </Section>
  );
}
