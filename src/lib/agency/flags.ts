// Feature flags of the panel (spec §0.5): sections released gradually.
// NEXT_PUBLIC_* values are inlined at build time, so server and client agree.

/** Video: on in previews and development; in production only once enabled with NEXT_PUBLIC_HABITA_VIDEO=1. */
export const videoEnabled = () => process.env.NEXT_PUBLIC_HABITA_VIDEO === "1" || process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";
