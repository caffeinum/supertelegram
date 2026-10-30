import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { CliError, EXIT } from "../cli/errors";

const VIDEO_EXT = new Set([".mp4", ".m4v", ".mov", ".webm", ".mkv"]);

export function looksLikeVideo(path: string): boolean {
  return VIDEO_EXT.has(extname(path).toLowerCase());
}

export interface VideoInfo {
  duration: number; // seconds
  w: number;
  h: number;
  thumb: string; // jpg, ≤320px wide, telegram shows it before the video loads
}

function run(cmd: string[]): string {
  let proc;
  try {
    proc = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new CliError(`${cmd[0]} not found: sending a video needs ffmpeg to read its size and length. install it (brew install ffmpeg) or send it as a plain file with --document`, EXIT.runtime);
  }
  if (proc.exitCode !== 0) throw new CliError(`${cmd[0]} failed on the video: ${proc.stderr.toString().trim().split("\n").pop()}`, EXIT.runtime);
  return proc.stdout.toString();
}

export function probeVideo(path: string): VideoInfo {
  const raw = JSON.parse(run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration", "-of", "json", path]));
  const stream = raw.streams?.[0];
  if (!stream?.width || !stream?.height) throw new CliError(`no video stream in ${path}. send it as a plain file with --document`, EXIT.usage);
  // webm/mkv streams report "N/A"; the container knows
  const duration = [stream.duration, raw.format?.duration].map(Number).find(Number.isFinite);
  if (duration === undefined) throw new CliError(`ffprobe reported no duration for ${path}. send it as a plain file with --document`, EXIT.runtime);
  const rotation = Math.abs(Number(stream.tags?.rotate ?? stream.side_data_list?.find((d: { rotation?: number }) => d.rotation !== undefined)?.rotation ?? 0));
  const sideways = rotation === 90 || rotation === 270;
  const thumb = join(mkdtempSync(join(tmpdir(), "supertelegram-thumb-")), "thumb.jpg");
  run(["ffmpeg", "-v", "error", "-y", "-ss", String(Math.min(1, duration / 2)), "-i", path, "-frames:v", "1", "-vf", "scale='min(320,iw)':-2", "-q:v", "4", thumb]);
  return { duration, w: sideways ? stream.height : stream.width, h: sideways ? stream.width : stream.height, thumb };
}
