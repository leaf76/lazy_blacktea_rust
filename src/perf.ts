export const formatBytes = (bytes?: number | null) => {
  const value = bytes ?? null;
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  const abs = Math.max(0, value);
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let unitIndex = 0;
  let current = abs;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex === 0 ? 0 : current >= 100 ? 0 : current >= 10 ? 1 : 2;
  return `${current.toFixed(decimals)} ${units[unitIndex]}`;
};

export const formatBps = (bytesPerSecond?: number | null) => {
  const value = bytesPerSecond ?? null;
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return `${formatBytes(value)}/s`;
};

export const buildSparklinePoints = (
  values: number[],
  width: number,
  height: number,
) => {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2 || width <= 0 || height <= 0) {
    return "";
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min;
  const n = clean.length;
  const stepX = width / (n - 1);
  const baseline = height / 2;

  return clean
    .map((value, index) => {
      const x = index * stepX;
      const normalized = span === 0 ? 0 : (value - min) / span;
      const y = span === 0 ? baseline : height - normalized * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

