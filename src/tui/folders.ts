import type { ChatSummary, Folder } from "./types";

export const ALL_CHATS: Folder = { id: 0, title: "All chats", all: true, include: [], exclude: [], pinned: [] };

// telegram's folder rules: excluded wins, then pinned/included chats, then the category flags minus muted/read/archived
export function inFolder(c: ChatSummary, f: Folder): boolean {
  if (f.all) return !c.archived;
  if (f.exclude.includes(c.id)) return false;
  if (f.pinned.includes(c.id) || f.include.includes(c.id)) return true;
  const category =
    c.kind === "bot"
      ? f.bots
      : c.kind === "user"
        ? c.contact
          ? f.contacts
          : f.nonContacts
        : c.kind === "channel"
          ? f.broadcasts
          : f.groups;
  if (!category) return false;
  if (f.excludeMuted && c.muted) return false;
  if (f.excludeRead && c.unread === 0) return false;
  if (f.excludeArchived && c.archived) return false;
  return true;
}

// a folder's chats in telegram order: its pinned chats first (in the folder's order), then by latest message
export function folderChats(chats: ChatSummary[], f: Folder): ChatSummary[] {
  const members = chats.filter((c) => inFolder(c, f));
  if (f.all) return members; // already in telegram's order, pinned first
  const pinned = f.pinned.map((id) => members.find((c) => c.id === id)).filter((c): c is ChatSummary => Boolean(c));
  const rest = members.filter((c) => !f.pinned.includes(c.id)).sort((a, b) => (b.last?.date ?? 0) - (a.last?.date ?? 0));
  return [...pinned, ...rest];
}

// the badge telegram shows on a folder tab: chats with unread messages, muted ones not counted
export function unreadChats(chats: ChatSummary[], f: Folder): number {
  return chats.filter((c) => c.unread > 0 && !c.muted && inFolder(c, f)).length;
}
