// A light brake on the chat, per account or demo invitation: at most 20
// questions in 10 minutes and 120 a day. It lives in each server instance's
// memory, so it is best effort; the account or invitation check is the gate.

const WINDOW = 10 * 60_000;
const DAY = 24 * 60 * 60_000;
const PER_WINDOW = 20;
const PER_DAY = 120;
const asked = new Map<string, number[]>();

export function allowQuestion(key: string, now = Date.now()) {
  const recent = (asked.get(key) ?? []).filter((t) => now - t < DAY);
  if (recent.length >= PER_DAY || recent.filter((t) => now - t < WINDOW).length >= PER_WINDOW) {
    asked.set(key, recent);
    return false;
  }
  recent.push(now);
  asked.set(key, recent);
  // Forget idle keys so the map does not grow without bound.
  if (asked.size > 5000)
    for (const [k, times] of asked) if (!times.some((t) => now - t < DAY)) asked.delete(k);
  return true;
}
