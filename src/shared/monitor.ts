// Turning a device's console output into something readable.
//
// Pure on purpose: parsing what a line MEANS is where the bugs live, and this
// way the tests can drive it without a serial port.

export interface MonitorLine {
  t: number;
  line: string;
  partial?: boolean;
}

export interface Series {
  name: string;
  points: { t: number; value: number }[];
}

/**
 * `name=value` pairs anywhere in a line, which is how embedded code logs
 * numbers when nobody has imposed a format ("temp=21.5 rh=48").
 *
 * Deliberately narrow. Matching bare numbers too would turn every timestamp,
 * address and error code into a chart, and a chart of nothing in particular is
 * worse than no chart.
 */
const PAIR = /([A-Za-z_][A-Za-z0-9_.]*)\s*[=:]\s*(-?\d+(?:\.\d+)?)/g;

export function extractPoints(entry: MonitorLine): { name: string; value: number }[] {
  const found: { name: string; value: number }[] = [];
  for (const match of entry.line.matchAll(PAIR)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) {
      found.push({ name: match[1], value });
    }
  }
  return found;
}

/** Fold lines into one series per name, newest last, capped so a device that
 *  talks for an hour does not grow the panel without bound. */
export function collectSeries(lines: MonitorLine[], cap = 240): Series[] {
  const byName = new Map<string, { t: number; value: number }[]>();
  for (const entry of lines) {
    for (const { name, value } of extractPoints(entry)) {
      const points = byName.get(name) ?? [];
      points.push({ t: entry.t, value });
      byName.set(name, points.slice(-cap));
    }
  }
  return [...byName.entries()]
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Milliseconds since the link opened, as something readable at a glance. */
export function stamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    + `.${String(Math.floor(ms % 1000)).padStart(3, "0")}`;
}

/** Case-insensitive substring, or a regex when the filter looks like one
 *  (`/re/`). An invalid regex filters nothing rather than throwing at the user
 *  mid-keystroke. */
export function matches(line: string, filter: string): boolean {
  const query = filter.trim();
  if (!query) {
    return true;
  }
  if (query.length > 2 && query.startsWith("/") && query.endsWith("/")) {
    try {
      return new RegExp(query.slice(1, -1), "i").test(line);
    } catch {
      return true;
    }
  }
  return line.toLowerCase().includes(query.toLowerCase());
}

/** A sparkline for one series, as an SVG path in a 0..1 box. */
export function sparkPath(points: { value: number }[], width: number,
                          height: number): string {
  if (points.length < 2) {
    return "";
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = height - ((p.value - min) / span) * height;
    return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}
