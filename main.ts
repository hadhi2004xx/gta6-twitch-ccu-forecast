// Launch-day Twitch CCU forecaster (make.fun gta6-twitch-ccu-forecast-01).
//
// Idea: a launch day has a characteristic shape. For dozens of past big
// launches we know the whole release day, so for each UTC hour h of the day
// we know the empirical distribution of the ratio
//
//     r_h = (viewers in hour h) / (viewers in hour 1)
//
// across those launches. The case at hand gives us its own hour-1 print p1,
// so the forecast for hour h is p1 times the empirical quantiles of r_h at
// the five scored levels. Everything is computed from the case file itself:
// no network, no randomness, no clock, so two runs agree byte for byte.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The five quantile levels the contest scores, in row order. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** A forecast value must lie in (0, MAX_Q]. */
const MAX_Q = 1_000_000_000;
/** Smallest positive value we ever emit, keeps logs and ratios finite. */
const FLOOR_Q = 0.01;

interface HourlyPoint {
  from: string;
  viewers: number;
  channels: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  unlock: string;
  platforms: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  id: string;
  game: { name: string; twitch_id: string };
  day_start: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables: Comparable[];
}

/**
 * Release-day viewers of one comparable, indexed by UTC hour 1..24 of its
 * release day, or null when the comparable cannot anchor ratios: hour 1
 * missing or zero, or too few of the day's hours sampled. (The Grand Theft
 * Auto VI category's own pre-release history fails this on purpose: its
 * "day" is a trailer premiere, not a launch.)
 */
function releaseDayCurve(comp: Comparable): (number | null)[] | null {
  const start = Date.parse(comp.day_start);
  if (!Number.isFinite(start)) return null;
  const curve: (number | null)[] = new Array(25).fill(null);
  for (const point of comp.hourly) {
    const t = Date.parse(point.from);
    if (!Number.isFinite(t)) continue;
    const hour = Math.floor((t - start) / 3_600_000) + 1;
    if (hour < 1 || hour > 24) continue;
    if (typeof point.viewers === 'number' && point.viewers > 0) {
      curve[hour] = point.viewers;
    }
  }
  if (curve[1] === null) return null;
  let present = 0;
  for (let h = 1; h <= 24; h++) if (curve[h] !== null) present++;
  if (present < 22) return null;
  return curve;
}

/** Linear-interpolation quantile of an ascending-sorted sample. */
function quantileOfSorted(sorted: number[], tau: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = tau * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Ratio samples r_h for every hour 2..24: one entry per usable comparable,
 * the ratio of its hour-h viewers to its own hour-1 viewers. A comparable
 * whose name matches the case's game is skipped (a launch never trains on
 * itself, and the case game's pre-release category history is not a launch).
 */
function ratioSamples(c: CaseFile): Map<number, number[]> {
  const samples = new Map<number, number[]>();
  for (let h = 2; h <= 24; h++) samples.set(h, []);
  const gameName = c.game.name.toLowerCase();
  for (const comp of c.comparables) {
    if (comp.name.toLowerCase().includes(gameName)) continue;
    const curve = releaseDayCurve(comp);
    if (curve === null) continue;
    const base = curve[1] as number;
    for (let h = 2; h <= 24; h++) {
      const v = curve[h];
      if (v !== null) samples.get(h)?.push(v / base);
    }
  }
  return samples;
}

/** Pooled ratios over all hours: the fallback for an hour with no samples. */
function pooledRatios(samples: Map<number, number[]>): number[] {
  const all: number[] = [];
  for (const list of samples.values()) all.push(...list);
  all.sort((a, b) => a - b);
  return all;
}

/** Round to 2 decimals so output bytes are stable and compact. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Clamp into (0, MAX_Q] and force the five values non-decreasing. */
function shapeRow(raw: number[]): number[] {
  const out: number[] = [];
  let prev = FLOOR_Q;
  for (const value of raw) {
    const clamped = Math.min(MAX_Q, Math.max(FLOOR_Q, value));
    const monotone = Math.max(prev, clamped);
    out.push(round2(monotone));
    prev = monotone;
  }
  return out;
}

/** Forecast one case: 23 rows of five quantiles for hours 2..24. */
function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  const p1 = Math.max(1, first?.viewers ?? 1);
  const samples = ratioSamples(c);
  const pooled = pooledRatios(samples);
  return c.forecast.map(({ hour }) => {
    const own = (samples.get(hour) ?? []).slice().sort((a, b) => a - b);
    const source = own.length >= 5 ? own : pooled;
    const q = LEVELS.map((tau) => p1 * quantileOfSorted(source, tau));
    return { hour, q: shapeRow(q) };
  });
}

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const inputs = readdirSync(INPUT_DIR)
    .filter((f) => f.endsWith('.in'))
    .sort();
  for (const file of inputs) {
    const id = file.slice(0, -'.in'.length);
    const parsed = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
    if (
      parsed.levels.length !== LEVELS.length ||
      parsed.levels.some((t, j) => t !== LEVELS[j])
    ) {
      throw new Error(`${file}: unexpected levels ${JSON.stringify(parsed.levels)}`);
    }
    const hours = forecastCase(parsed);
    writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
  }
}

main();
