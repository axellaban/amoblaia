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
    // Dot segments normalize "/.//evil.com" into "//evil.com", which a
    // browser reads as another site: check the result, not just the input.
    if (
      url.origin !== "https://amoblaia.invalid" ||
      url.pathname.startsWith("//")
    )
      return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}
