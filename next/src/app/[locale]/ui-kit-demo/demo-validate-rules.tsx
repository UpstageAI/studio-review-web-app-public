"use client";

import {
  ValidateRules,
  type ValidateRulesLabels,
} from "@/components/studio-ui-kit/validate-rules";
import { VALIDATE_RULES } from "./demo-data";
import { Section, TEST_ID } from "./demo-section";

const RULE_LABELS: ValidateRulesLabels = {
  empty: "This step has no rules.",
  severity: { error: "Error → red", warning: "Warning → yellow" },
  logic: { and: "All of", or: "Any of" },
  operator: {
    filled: left => <>{left} is filled</>,
    empty: left => <>{left} is empty</>,
    contains: (left, right) => (
      <>
        {left} contains {right}
      </>
    ),
    matches: (left, right) => (
      <>
        {left} matches {right}
      </>
    ),
  },
  agg: {
    sum: target => <>sum {target}</>,
    count: target => <>count {target}</>,
    min: target => <>min {target}</>,
    max: target => <>max {target}</>,
  },
  attr: {
    confidence: target => <>confidence of {target}</>,
    length: target => <>length of {target}</>,
  },
  scope: {
    all: target => <>every {target}</>,
    any: target => <>any {target}</>,
  },
};

const formatConstant = (value: unknown) => JSON.stringify(value);

export function ValidateRulesDemo() {
  return (
    <Section
      title="validate-rules"
      description="Rules configured for a Validate step: comparison symbols, word operators, aggregates, attributes, scopes and nested groups. An unknown operator keeps its raw name, and a rule whose condition could not be read shows only its name and severity."
      testId={`${TEST_ID}-validate-rules-section`}
    >
      <ValidateRules
        className="max-w-xl"
        rules={VALIDATE_RULES}
        formatConstant={formatConstant}
        labels={RULE_LABELS}
        testId={`${TEST_ID}-validate-rules`}
      />
    </Section>
  );
}
