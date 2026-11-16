"use client";

import { useState } from "react";
import {
  DocumentLabelField,
  type DocumentLabelFieldLabels,
  type DocumentLabelFieldProps,
} from "@/components/studio-ui-kit/document-label-field";
import { LABEL_CHOICES } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

const LABEL_LABELS: DocumentLabelFieldLabels = {
  noLabel: "(no label)",
  notInConfigOption: label => `${label} (not in config)`,
};

interface LabelCase {
  id: string;
  title: string;
  initial: string | null;
  field: Pick<
    DocumentLabelFieldProps,
    "choices" | "commit" | "noLabelOption" | "outsideOption"
  >;
}

const LABEL_CASES: readonly LabelCase[] = [
  {
    id: "select-annotated",
    title: 'Select · "no label" when empty · outside label annotated',
    initial: "Memo",
    field: {
      choices: LABEL_CHOICES,
      noLabelOption: "when-empty",
      outsideOption: "annotated",
    },
  },
  {
    id: "select-always",
    title: 'Select · "no label" always · outside label hidden',
    initial: "Invoice",
    field: {
      choices: LABEL_CHOICES,
      noLabelOption: "always",
      outsideOption: "none",
    },
  },
  {
    id: "input-blur",
    title: "Free input · commits on blur or Enter (Esc restores)",
    initial: "Memo",
    field: { choices: null, commit: "blur" },
  },
  {
    id: "input-change",
    title: "Free input · reports every keystroke",
    initial: null,
    field: { choices: null, commit: "change" },
  },
];

export function DocumentLabelFieldDemo() {
  return (
    <Section
      title="document-label-field"
      description="One document label control: a select when the configuration lists labels, a free input otherwise. Props keep the rules that differ between screens — when the “no label” item shows, whether a label outside the list is offered, and whether free input commits on blur or on every keystroke. The line under each control shows the value the caller received."
      testId={`${TEST_ID}-document-label-section`}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {LABEL_CASES.map(item => (
          <LabelCaseDemo key={item.id} item={item} />
        ))}
      </div>
    </Section>
  );
}

function LabelCaseDemo({ item }: { item: LabelCase }) {
  const [value, setValue] = useState<string | null>(item.initial);
  const testId = `${TEST_ID}-label-${item.id}`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={testId} className="text-sm font-medium">
        {item.title}
      </label>
      <DocumentLabelField
        {...item.field}
        id={testId}
        value={value}
        onValueChange={setValue}
        maxLength={40}
        labels={LABEL_LABELS}
        testId={testId}
        classNames={{ trigger: "w-full" }}
      />
      <StateLine testId={`${testId}-value`}>{JSON.stringify(value)}</StateLine>
    </div>
  );
}
