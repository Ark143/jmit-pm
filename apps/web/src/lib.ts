import type { Priority, StatusCategory, User } from "./types";

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  URGENT: { label: "Urgent", color: "#e5484d" },
  HIGH: { label: "High", color: "#f5734a" },
  MEDIUM: { label: "Medium", color: "#d4a017" },
  LOW: { label: "Low", color: "#22b07d" },
};

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  DONE: "Done",
};

export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function avatarColor(user: Pick<User, "color" | "name">) {
  return user.color || "#4f8cff";
}

/**
 * Picks black or white initials for a background colour. Avatars are user
 * coloured, so a fixed white would fail contrast on light tones like red.
 * 0.179 is the luminance where either choice scores the same (~4.6:1).
 */
export function readableInk(background: string) {
  const hex = background.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return "#ffffff";

  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.179 ? "#0b0d11" : "#ffffff";
}

const DAY = 24 * 60 * 60 * 1000;

export function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function daysUntil(iso: string | null) {
  if (!iso) return null;
  const target = startOfDay(new Date(iso)).getTime();
  const today = startOfDay(new Date()).getTime();
  return Math.round((target - today) / DAY);
}

export function dueLabel(iso: string | null) {
  const diff = daysUntil(iso);
  if (diff === null) return null;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `In ${diff}d`;

  return new Date(iso as string).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function isOverdue(iso: string | null, category?: StatusCategory) {
  if (!iso || category === "DONE") return false;
  const diff = daysUntil(iso);
  return diff !== null && diff < 0;
}

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function toDateInput(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

export function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtMinutes(total: number | null | undefined) {
  if (total === null || total === undefined) return "—";
  if (total <= 0) return "0m";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export function timeLabel(planned: number | null, logged: number) {
  const loggedText = logged > 0 ? `${fmtMinutes(logged)} logged` : "No time logged";
  if (!planned) return loggedText;
  return `${loggedText} of ${fmtMinutes(planned)}`;
}

export function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function dayDiff(from: Date, to: Date) {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY);
}

export function monthMatrix(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday-first grid
  const start = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getTime() + index * DAY));
}
