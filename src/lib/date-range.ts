import type { DatePreset } from "@/lib/types";

export type TimeWindow = {
  label: string;
  from: string;
  to: string;
};

export type ComparisonBundle = {
  current: TimeWindow;
  comparison: TimeWindow;
};

const DAY_MS = 86_400_000;

function startOfDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY_MS);
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 3_600_000);
}

export function resolveComparison(input: {
  preset: DatePreset;
  comparePreset: DatePreset;
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
}): ComparisonBundle {
  const { preset, comparePreset } = input;

  if (preset === "24h") {
    const curEnd = new Date();
    const curStart = hoursAgo(24);
    const cmpHours = comparePreset === "7d" ? 168 : comparePreset === "30d" ? 720 : 24;
    const cmpEnd = curStart;
    const cmpStart = new Date(cmpEnd.getTime() - cmpHours * 3_600_000);
    return {
      current: { label: "Last 24 hours", from: curStart.toISOString(), to: curEnd.toISOString() },
      comparison: {
        label: `Previous ${comparePreset === "24h" ? "24 hours" : comparePreset === "7d" ? "7 days" : comparePreset === "30d" ? "30 days" : "24 hours"}`,
        from: cmpStart.toISOString(),
        to: cmpEnd.toISOString(),
      },
    };
  }

  if (preset === "custom" && input.from && input.to) {
    const curStart = startOfDay(new Date(input.from));
    const curEnd = startOfDay(addDays(new Date(input.to), 1));
    const dayLen = Math.max(1, Math.round((curEnd.getTime() - curStart.getTime()) / DAY_MS));
    const cmpDays = comparePreset === "24h" ? 1 : comparePreset === "30d" ? 30 : comparePreset === "7d" ? 7 : dayLen;
    const cmpStart = input.compareFrom ? startOfDay(new Date(input.compareFrom)) : addDays(curStart, -cmpDays);
    const cmpEnd = input.compareTo ? startOfDay(addDays(new Date(input.compareTo), 1)) : curStart;
    return {
      current: { label: `${isoDate(curStart)} to ${isoDate(addDays(curEnd, -1))}`, from: curStart.toISOString(), to: curEnd.toISOString() },
      comparison: { label: `${isoDate(cmpStart)} to ${isoDate(addDays(cmpEnd, -1))}`, from: cmpStart.toISOString(), to: cmpEnd.toISOString() },
    };
  }

  const days = preset === "30d" ? 30 : 7;
  const curEnd = startOfDay(addDays(new Date(), 1));
  const curStart = addDays(curEnd, -days);
  const cmpDays = comparePreset === "24h" ? 1 : comparePreset === "30d" ? 30 : comparePreset === "7d" ? 7 : days;
  const cmpEnd = curStart;
  const cmpStart = addDays(cmpEnd, -cmpDays);
  return {
    current: { label: `Last ${days} days`, from: curStart.toISOString(), to: curEnd.toISOString() },
    comparison: { label: `Previous ${cmpDays} days`, from: cmpStart.toISOString(), to: cmpEnd.toISOString() },
  };
}

export function calculateDelta(current: number, comparison: number) {
  if (comparison === 0) return current === 0 ? 0 : 100;
  return ((current - comparison) / comparison) * 100;
}
