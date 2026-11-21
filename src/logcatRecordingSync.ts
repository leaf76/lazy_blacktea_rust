export type LogcatRecordingSyncSession = {
  serial: string;
  startedAtMs: number;
  endedAtMs: number | null;
  startLineId: number;
  endLineId: number | null;
};

export type LogcatIndexedLine = {
  id: number;
  text: string;
};

export const createLogcatRecordingSyncSession = (
  serial: string,
  lines: LogcatIndexedLine[],
  nowMs = Date.now(),
): LogcatRecordingSyncSession => {
  const lastId = lines.length > 0 ? lines[lines.length - 1].id : 0;
  return {
    serial,
    startedAtMs: nowMs,
    endedAtMs: null,
    startLineId: lastId + 1,
    endLineId: null,
  };
};

export const finalizeLogcatRecordingSyncSession = (
  session: LogcatRecordingSyncSession,
  lines: LogcatIndexedLine[],
  nowMs = Date.now(),
): LogcatRecordingSyncSession => {
  const lastId = lines.length > 0 ? lines[lines.length - 1].id : session.startLineId - 1;
  return {
    ...session,
    endedAtMs: nowMs,
    endLineId: Math.max(session.startLineId - 1, lastId),
  };
};

export const sliceLogcatLinesForRecording = (
  lines: LogcatIndexedLine[],
  session: LogcatRecordingSyncSession,
): string[] => {
  const endId = session.endLineId ?? Number.POSITIVE_INFINITY;
  return lines
    .filter((entry) => entry.id >= session.startLineId && entry.id <= endId)
    .map((entry) => entry.text);
};
