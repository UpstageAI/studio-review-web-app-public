"use client";

import { useState } from "react";
import {
  PageRangeEditor,
  type PageRangeEditorLabels,
  type PageRangeRow,
} from "@/components/studio-ui-kit/page-range-editor";
import { INITIAL_RANGES, RANGE_FILES, isRangeText } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

const RANGE_LABELS: PageRangeEditorLabels = {
  file: row => `File for range ${row}`,
  range: row => `Pages for range ${row}`,
  placeholder: "1-3, 5",
  removeRow: row => `Remove range ${row}`,
  addRow: "+ Add file range",
};

const validate = (text: string) =>
  isRangeText(text) ? null : 'Write the range like "1-3, 5".';

export function PageRangeEditorDemo() {
  const [rows, setRows] = useState<readonly PageRangeRow[]>(INITIAL_RANGES);
  return (
    <Section
      title="page-range-editor"
      description="Page ranges per file. Rows commit on Enter, blur, file change or removal when every row is valid; Esc restores the row. The line below shows the committed rows."
      testId={`${TEST_ID}-page-range-section`}
    >
      <PageRangeEditor
        className="max-w-md"
        rows={rows}
        fileOptions={RANGE_FILES}
        validate={validate}
        onCommit={setRows}
        labels={RANGE_LABELS}
        testId={`${TEST_ID}-page-range`}
      />
      <StateLine testId={`${TEST_ID}-page-range-committed`}>
        {JSON.stringify(rows)}
      </StateLine>
    </Section>
  );
}
