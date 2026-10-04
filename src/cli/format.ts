import { Api } from "telegram";
import { duration } from "./duration";
import { utils } from "telegram";
import type { Entity } from "../client/telegram";

export function peerId(e: Entity): string {
  return utils.getPeerId(e).toString();
}

export function chatType(e: Entity): "user" | "bot" | "group" | "supergroup" | "channel" {
  if (e instanceof Api.User) return e.bot ? "bot" : "user";
  if (e instanceof Api.Chat) return "group";
  return e.megagroup ? "supergroup" : "channel";
}

export function displayName(e: Entity): string {
  if (e instanceof Api.User) {
    const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
    return name || (e.deleted ? "deleted account" : `user ${e.id.toString()}`);
  }
  return e.title;
}

export function username(e: Entity): string | undefined {
  if (e instanceof Api.Chat) return undefined;
  return e.username ?? e.usernames?.find((u) => u.active)?.username;
}

export function label(e: Entity): string {
  const u = username(e);
  return `${displayName(e)}${u ? ` (@${u})` : ""}`;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function mediaLabel(msg: Api.Message): string | undefined {
  const m = msg.media;
  if (!m) return undefined;
  if (m instanceof Api.MessageMediaPhoto) return "photo";
  if (m instanceof Api.MessageMediaWebPage) {
    const page = m.webpage;
    if (page instanceof Api.WebPage) return `link: ${page.siteName ?? hostname(page.url)}`;
    if ("url" in page && typeof page.url === "string") return `link: ${hostname(page.url)}`;
    return "link";
  }
  if (m instanceof Api.MessageMediaPoll) return `poll: ${m.poll.question.text}`;
  if (m instanceof Api.MessageMediaGeo || m instanceof Api.MessageMediaGeoLive || m instanceof Api.MessageMediaVenue) return "location";
  if (m instanceof Api.MessageMediaContact) return `contact: ${[m.firstName, m.lastName].filter(Boolean).join(" ")}`;
  if (m instanceof Api.MessageMediaDice) return `dice: ${m.emoticon} ${m.value}`;
  if (m instanceof Api.MessageMediaDocument && m.document instanceof Api.Document) {
    const attrs = m.document.attributes;
    const fileName = attrs.find((a): a is Api.DocumentAttributeFilename => a instanceof Api.DocumentAttributeFilename)?.fileName;
    const named = (kind: string) => (fileName ? `${kind}: ${fileName}` : kind);
    if (attrs.some((a) => a instanceof Api.DocumentAttributeSticker)) return "sticker";
    if (attrs.some((a) => a instanceof Api.DocumentAttributeAnimated)) return "gif";
    const audio = attrs.find((a): a is Api.DocumentAttributeAudio => a instanceof Api.DocumentAttributeAudio);
    const video = attrs.find((a): a is Api.DocumentAttributeVideo => a instanceof Api.DocumentAttributeVideo);
    if (audio?.voice) return `voice ${duration(audio.duration)}`;
    if (video?.roundMessage) return `video note ${duration(video.duration)}`;
    if (video) return named(`video ${duration(video.duration)}`);
    if (audio) return named(`audio ${duration(audio.duration)}`);
    return named("file");
  }
  return "media";
}

export function isoDate(unix: number | undefined): string | null {
  return unix ? new Date(unix * 1000).toISOString().replace(".000Z", "Z") : null;
}
