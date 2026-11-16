"use client";

import { useState } from "react";
import {
  VerdictSegment,
  type Verdict,
  type VerdictSegmentLabels,
} from "@/components/studio-ui-kit/verdict-segment";
import { VERDICT_CHECKS } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

const VERDICT_LABELS: VerdictSegmentLabels = {
  group: "Verdict",
  verdicts: { green: "Green", yellow: "Yellow", red: "Red" },
  checks: "Original checks",
  passed: "Passed",
  failed: "Failed",
};

const INITIAL_VERDICT: Verdict = "yellow";

export function VerdictSegmentDemo() {
  const [value, setValue] = useState<Verdict>(INITIAL_VERDICT);
  const changed = value !== INITIAL_VERDICT;
  return (
    <Section
      title="verdict-segment"
      description="Three verdict cells with the original checks. Arrow keys move the choice; picking the chosen cell again does nothing. In this demo the checks disappear once the verdict differs from the original."
      testId={`${TEST_ID}-verdict-section`}
    >
      <VerdictSegment
        className="max-w-md"
        value={value}
        onValueChange={setValue}
        checks={changed ? null : VERDICT_CHECKS}
        notice={
          changed
            ? "You changed the verdict. The original checks no longer apply."
            : "Changing the verdict clears these original checks."
        }
        labels={VERDICT_LABELS}
        testId={`${TEST_ID}-verdict`}
      />
      <StateLine testId={`${TEST_ID}-verdict-value`}>
        {JSON.stringify(value)}
      </StateLine>
    </Section>
  );
}
