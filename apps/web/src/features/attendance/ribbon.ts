/** What the day ribbon needs from a record: local "HH:MM" times and the minutes of a closed record. */
export interface RibbonRecord {
  startTime: string;
  endTime: string | null;
  open: boolean;
  minutes: number | null;
}

export interface RibbonBlock {
  /** Minutes after midnight (local). */
  from: number;
  to: number;
  open: boolean;
}

export interface DayRibbon {
  /** Whole hours shown, at least 07–19 and widened to fit the records. */
  startHour: number;
  endHour: number;
  blocks: RibbonBlock[];
  /** Minutes without work between the first and the last block. */
  breakMinutes: number;
  /** Local minute the open record has reached ("now"), or null when nothing is open. */
  now: number | null;
  /**
   * Local minute at which the target is or was reached: inside a block when it happened, after "now" while still
   * working (if they keep going), null when the day ended short or there is no target.
   */
  targetAt: number | null;
  /** True when `targetAt` lies in the future (projected from an open record). */
  targetProjected: boolean;
}

const DEFAULT_START = 7;
const DEFAULT_END = 19;
const DAY = 24 * 60;

const toMinutes = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "HH:MM" of a minute of the day (wraps past midnight). */
export const clockTime = (minute: number): string => {
  const m = ((Math.round(minute) % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * Lays one person's day out on a clock: blocks where they worked, the breaks between, "now" for an open record and
 * when the target is reached. An open record runs to `totalMinutes` minus the closed records (the server's total
 * includes the open part). A record ending after midnight is cut at 24:00. Pure and informational.
 */
export function dayRibbon(
  records: readonly RibbonRecord[],
  totalMinutes: number,
  target: number,
): DayRibbon {
  const closed = records.filter((r) => !r.open).reduce((sum, r) => sum + (r.minutes ?? 0), 0);
  const blocks = records
    .map((r): RibbonBlock => {
      const from = toMinutes(r.startTime);
      let to: number;
      if (r.open || r.endTime === null) to = from + Math.max(0, totalMinutes - closed);
      else {
        to = toMinutes(r.endTime);
        if (to <= from) to += DAY;
      }
      return { from, to: Math.min(to, DAY), open: r.open };
    })
    .sort((a, b) => a.from - b.from);

  let breakMinutes = 0;
  for (let i = 1; i < blocks.length; i += 1) {
    breakMinutes += Math.max(0, blocks[i]!.from - blocks[i - 1]!.to);
  }

  const openBlock = blocks.find((b) => b.open) ?? null;
  let targetAt: number | null = null;
  let targetProjected = false;
  if (target > 0) {
    let sum = 0;
    for (const block of blocks) {
      const length = block.to - block.from;
      if (sum + length >= target) {
        targetAt = block.from + (target - sum);
        break;
      }
      sum += length;
    }
    if (targetAt === null && openBlock) {
      targetAt = openBlock.to + (target - sum);
      targetProjected = true;
    }
    if (targetAt !== null && targetAt > DAY) targetAt = null;
  }

  const first = blocks[0]?.from ?? DEFAULT_START * 60;
  const last = Math.max(...blocks.map((b) => b.to), targetAt ?? 0, DEFAULT_END * 60);
  return {
    startHour: Math.min(DEFAULT_START, Math.floor(first / 60)),
    endHour: Math.min(24, Math.max(DEFAULT_END, Math.ceil(last / 60))),
    blocks,
    breakMinutes,
    now: openBlock ? openBlock.to : null,
    targetAt,
    targetProjected,
  };
}
