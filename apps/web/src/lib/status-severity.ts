import type { MonitorState } from "@uptick/db";

/**
 * Ordering used to summarise many components into one headline state.
 *
 * DOWN outranks everything so a single failed component is never hidden behind
 * a majority of healthy ones — the summary exists to surface bad news.
 * PAUSED ranks lowest: an operator silenced it deliberately, so it should not
 * dominate the headline.
 */
const STATE_RANK: Record<MonitorState, number> = {
  DOWN: 4,
  DEGRADED: 3,
  PENDING: 2,
  PAUSED: 1,
  UP: 0,
};

/** Worst state across components. An empty list reads as UP. */
export function worstState(states: readonly MonitorState[]): MonitorState {
  return states.reduce<MonitorState>(
    (worst, s) => (STATE_RANK[s] > STATE_RANK[worst] ? s : worst),
    "UP",
  );
}
