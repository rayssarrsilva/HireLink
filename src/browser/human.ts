/** Human pace: FlashHire never rushes a page, so sites see a normal person filling a form. */
export const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface Pace {
  betweenFields: [number, number];
  typingDelay: [number, number];
  afterClick: [number, number];
  betweenJobs: [number, number];
}

export const NORMAL_PACE: Pace = {
  betweenFields: [600, 2000],
  typingDelay: [30, 90],
  afterClick: [1500, 3500],
  betweenJobs: [20_000, 60_000],
};

/** Used by the automated tests against local pages. */
export const TEST_PACE: Pace = {
  betweenFields: [0, 5],
  typingDelay: [0, 1],
  afterClick: [50, 100],
  betweenJobs: [0, 0],
};

export const pause = (range: [number, number]) => sleep(rand(range[0], range[1]));
