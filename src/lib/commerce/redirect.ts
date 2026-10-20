export function safeNext(value: string | null, fallback = "/cuenta") {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return fallback;
  try {
    const url = new URL(value, "https://amoblaia.invalid");
    return url.origin === "https://amoblaia.invalid"
      ? `${url.pathname}${url.search}`
      : fallback;
  } catch {
    return fallback;
  }
}
