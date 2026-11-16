export const tid = (testId: string | undefined, suffix: string) =>
  testId ? `${testId}-${suffix}` : undefined;
