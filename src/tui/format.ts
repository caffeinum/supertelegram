import { RGBA } from "@opentui/core";

// indexed ansi colors only: the user's terminal theme decides how they look on dark or light
export const C = {
  accent: RGBA.fromIndex(6),
  green: RGBA.fromIndex(2),
  yellow: RGBA.fromIndex(3),
  red: RGBA.fromIndex(1),
  gray: RGBA.fromIndex(8),
  blue: RGBA.fromIndex(4),
  magenta: RGBA.fromIndex(5),
};

const SENDER_COLORS = [6, 2, 3, 4, 5, 14, 12, 10].map((i) => RGBA.fromIndex(i));

export function senderColor(id: string | undefined): RGBA {
  let h = 0;
  for (const ch of id ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return SENDER_COLORS[h % SENDER_COLORS.length]!;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function width(s: string): number {
  return Bun.stringWidth(s);
}

// cut to a display width (emoji/cjk count as 2), ending in … when cut
export function fit(s: string, max: number): string {
  if (max <= 0) return "";
  const oneLine = s.replace(/\s+/g, " ");
  if (width(oneLine) <= max) return oneLine;
  let out = "";
  for (const { segment } of segmenter.segment(oneLine)) {
    if (width(out + segment) > max - 1) break;
    out += segment;
  }
  return `${out}…`;
}

export function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - width(s)));
}

export function padStart(s: string, w: number): string {
  return " ".repeat(Math.max(0, w - width(s))) + s;
}

const DAY = 86_400_000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function hhmm(unix: number): string {
  const d = new Date(unix * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// list column: 14:02 today, Tue this week, 28 Sep this year, 28/09/25 older
export function shortTime(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000);
  const days = (startOfDay(now) - startOfDay(d)) / DAY;
  if (days <= 0) return hhmm(unix);
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

export function dayLabel(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000);
  const days = (startOfDay(now) - startOfDay(d)) / DAY;
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts).toLowerCase();
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a * 1000)) === startOfDay(new Date(b * 1000));
}
