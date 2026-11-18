// Launch-day Twitch CCU forecaster (make.fun gta6-twitch-ccu-forecast-01).
//
// Idea: a launch day has a characteristic shape. For dozens of past big
// launches we know the whole release day, so for each UTC hour h of the day
// we know the distribution of the log ratio
//
//     lr_h = ln( (viewers in hour h) / (viewers in hour 1) )
//
// across those launches. The case at hand gives us its own hour-1 print p1,
// so the forecast for hour h is p1 * exp(quantile of lr_h).
//
// Not all launches are alike, so each comparable is weighted by how similar
// it is to the case at hand:
//   - regime: a comparable whose hour 1 already held a large share of its
//     day's peak behaves like a rolling-midnight launch; one whose hour 1
//     was nearly empty is a single global unlock later in the UTC day. The
//     case's notes say which regime the target launch is in, which sets the
//     share the weights aim at;
//   - platform overlap between the comparable's platforms and the platforms
//     the case's notes name.
// The empirical weighted quantiles are then shrunk a little in log space:
// the median toward flat (ratio 1) and the spread by a fixed factor, both
// calibrated by leave-one-out backtests over the comparable set.
//
// Everything is computed from the case file itself: no network, no
// randomness, no clock, so two runs agree byte for byte.

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

/**
 * Calibration constants, chosen by leave-one-out backtests over the
 * comparable launches (see SUBMIT-RESUME.md). Kept on one line so the
 * tuning harness can substitute variants.
 */
const TUNE = { shareStarRolling: 0.45, shareStarGlobal: 0.02, shareStarOther: 0.3, shareSigma: 2.0, platformMatch: 1.6, medShrink: 0.78, spreadScale: 0.9 };

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
  history_hourly?: HourlyPoint[];
  comparables: Comparable[];
  notes: string;
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
  for (const point of comp.hourly ?? []) {
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

/** The launch regime a free-text unlock/notes field describes. */
type Regime = 'rolling' | 'global' | 'other';

function regimeOf(text: string): Regime {
  const t = text.toLowerCase();
  // Rolling wins ties: several mixed launches (consoles rolling at midnight
  // local, one platform unlocking globally the evening before) still shape
  // their UTC day like a rolling launch, because the console waves land
  // inside it. Only a text with no rolling pattern at all reads as global.
  if (/midnight local|rolling/.test(t)) return 'rolling';
  if (/single global|simultaneous|global unlock|one global/.test(t)) return 'global';
  return 'other';
}

/**
 * Regime fallback from the case's own data when its notes name no regime:
 * if the hours just before the release day already carried a large
 * audience, the unlock wave was already rolling through them.
 */
function regimeFromHistory(c: CaseFile, p1: number): Regime {
  const start = Date.parse(c.day_start);
  let prePeak = 0;
  for (const point of c.history_hourly ?? []) {
    const t = Date.parse(point.from);
    if (t >= start - 6 * 3_600_000 && t < start && typeof point.viewers === 'number') {
      prePeak = Math.max(prePeak, point.viewers);
    }
  }
  return prePeak >= 0.4 * p1 ? 'rolling' : 'other';
}

/** Platform tokens mentioned in a text, from a fixed vocabulary. */
function platformTokens(text: string): Set<string> {
  const t = text.toLowerCase();
  const tokens = new Set<string>();
  if (/ps5|playstation 5/.test(t)) tokens.add('ps5');
  if (/ps4|playstation 4/.test(t)) tokens.add('ps4');
  if (/\bps\b|playstation/.test(t)) tokens.add('ps');
  if (/xbox/.test(t)) tokens.add('xbox');
  if (/\bpc\b|steam/.test(t)) tokens.add('pc');
  if (/switch/.test(t)) tokens.add('switch');
  if (/stadia/.test(t)) tokens.add('stadia');
  return tokens;
}

/** A usable comparable, pre-digested once per case. */
interface CompDay {
  /** ln(viewers_h / viewers_1) per UTC hour 1..24, null where unsampled. */
  logRatios: (number | null)[];
  /** Hour-1 viewers as a share of the day's peak, in (0, 1]. */
  share: number;
  platforms: Set<string>;
}

function digestComparable(comp: Comparable): CompDay | null {
  const curve = releaseDayCurve(comp);
  if (curve === null) return null;
  const base = curve[1] as number;
  let peak = 0;
  for (let h = 1; h <= 24; h++) peak = Math.max(peak, curve[h] ?? 0);
  const logRatios = curve.map((v) => (v === null ? null : Math.log(v / base)));
  return { logRatios, share: base / peak, platforms: platformTokens(comp.platforms ?? '') };
}

/** The weighted training pool for one case. */
interface Pool {
  days: CompDay[];
  weights: number[];
}

function buildPool(c: CaseFile, p1: number): Pool {
  let regime = regimeOf(c.notes ?? '');
  if (regime === 'other') regime = regimeFromHistory(c, p1);
  const shareStar =
    regime === 'rolling' ? TUNE.shareStarRolling : regime === 'global' ? TUNE.shareStarGlobal : TUNE.shareStarOther;
  const casePlatforms = platformTokens(c.notes ?? '');
  const gameName = c.game.name.toLowerCase();
  const days: CompDay[] = [];
  const weights: number[] = [];
  for (const comp of c.comparables ?? []) {
    // A launch never trains on itself; the case game's own pre-release
    // category history is not a launch either.
    if (comp.name.toLowerCase().includes(gameName)) continue;
    const day = digestComparable(comp);
    if (day === null) continue;
    const dLog = Math.log(day.share) - Math.log(shareStar);
    let w = Math.exp(-(dLog * dLog) / (2 * TUNE.shareSigma * TUNE.shareSigma));
    if (casePlatforms.size > 0 && day.platforms.size > 0) {
      for (const token of day.platforms) {
        if (casePlatforms.has(token)) {
          w *= TUNE.platformMatch;
          break;
        }
      }
    }
    days.push(day);
    weights.push(w);
  }
  return { days, weights };
}

/** Weighted quantile: value at cumulative-weight fraction tau. */
function weightedQuantile(values: number[], weights: number[], tau: number): number {
  const order = values.map((v, i) => [v, weights[i]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const total = order.reduce((s, [, w]) => s + w, 0);
  const target = tau * total;
  let acc = 0;
  for (let i = 0; i < order.length; i++) {
    acc += order[i][1];
    if (acc >= target) {
      if (i === 0) return order[0][0];
      const prevAcc = acc - order[i][1];
      const frac = (target - prevAcc) / order[i][1];
      return order[i - 1][0] + frac * (order[i][0] - order[i - 1][0]);
    }
  }
  return order[order.length - 1][0];
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

/** Forecast one case: one row of five quantiles per forecast hour. */
function forecastCase(c: CaseFile): Array<{ hour: number; q: number[] }> {
  const first = c.known.find((k) => k.hour === 1);
  const p1 = Math.max(1, first?.viewers ?? 1);
  const pool = buildPool(c, p1);
  return c.forecast.map(({ hour }) => {
    const logRatios: number[] = [];
    const ws: number[] = [];
    pool.days.forEach((day, i) => {
      const lr = day.logRatios[hour];
      if (lr !== null && lr !== undefined) {
        logRatios.push(lr);
        ws.push(pool.weights[i]);
      }
    });
    if (logRatios.length === 0) {
      return { hour, q: shapeRow(LEVELS.map(() => p1)) };
    }
    const logQ = LEVELS.map((tau) => weightedQuantile(logRatios, ws, tau));
    const median = logQ[2];
    const adjusted = logQ.map((lq) => TUNE.medShrink * median + TUNE.spreadScale * (lq - median));
    return { hour, q: shapeRow(adjusted.map((lq) => p1 * Math.exp(lq))) };
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
