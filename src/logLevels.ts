export const LOG_LEVELS = ["V", "D", "I", "W", "E", "F"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

