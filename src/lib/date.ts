export function getLocalDateKey(timezone?: string | null, now = new Date()): string {
  const resolvedTimezone = timezone || "America/Toronto";

  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: resolvedTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to UTC if the device stored an invalid timezone.
  }

  return now.toISOString().slice(0, 10);
}
