import dayjs from "dayjs";

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatAiu(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return (n / 1000).toFixed(2) + "K";
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return dayjs(iso).format("MMM D, YYYY HH:mm");
}

export function formatDay(iso: string): string {
  return dayjs(iso).format("MMM D");
}

export function modelLabel(model: string): string {
  if (!model || model === "unknown") return "Unknown";
  return model
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/Gpt/i, "GPT");
}

export function sourceLabel(source: string): string {
  return source === "cli" ? "copilot-cli" : "VSCode Copilot";
}

export function isoDaysAgo(days: number): string {
  return dayjs().subtract(days, "day").format("YYYY-MM-DD");
}

export function today(): string {
  return dayjs().format("YYYY-MM-DD");
}
