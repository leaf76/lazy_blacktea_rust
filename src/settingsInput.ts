export type IntegerSettingInputOptions = {
  min?: number;
};

export const parseIntegerSettingInput = (
  value: string,
  currentValue: number,
  options: IntegerSettingInputOptions = {},
): number => {
  const trimmed = value.trim();
  if (!trimmed) {
    return currentValue;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return currentValue;
  }

  const integer = Math.trunc(parsed);
  return options.min == null ? integer : Math.max(options.min, integer);
};
