// Argentina has no daylight saving time since 2009: UTC-3 all year.
export const TZ = "America/Argentina/Buenos_Aires";
const DAY = 86_400_000;

/** YYYY-MM-DD of an instant, in Buenos Aires. */
export function artDate(iso: string | number | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
/** Start of a Buenos Aires day (YYYY-MM-DD) as an instant. */
export const dayStart = (date: string) => Date.parse(`${date}T00:00:00-03:00`);
export const dayEnd = (date: string) => dayStart(date) + DAY;
export const days = (n: number) => n * DAY;
export const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dayStart(s));

/** "27/10/2026" or "27/10/2026 14:05", in Buenos Aires, keeping day precision visible. */
export function formatWhen(iso: string | null | undefined, precision: "time" | "day" = "time") {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
  if (precision === "day") return `${date} (sin hora)`;
  return `${date} ${d.toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })}`;
}
