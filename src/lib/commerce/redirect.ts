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
/**
 * Set by the browser that asks for a sign-up or recovery email. Only that
 * browser hands its free trial over when the link is confirmed: a link
 * forwarded by someone else must not move the visitor's photos into the
 * sender's account.
 */
export const EMAIL_FLOW_COOKIE = "amoblaia-email-flow";
