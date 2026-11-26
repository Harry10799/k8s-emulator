import type { RandomSource } from "./types";

/** Small, deterministic PRNG (Mulberry32). A seed makes simulations replayable. */
export interface SeededRandom extends RandomSource {
  snapshot(): number;
  restore(state: number): void;
}

export function createSeededRng(seed: number): SeededRandom {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    },
    snapshot() {
      return state;
    },
    restore(nextState: number) {
      state = nextState >>> 0;
    },
  };
}
