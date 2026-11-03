// Photo upload limits shared by the server (commerce/images, routes) and the panel's
// selection, which must say the same. Client-safe: no server imports.
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const UPLOAD_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
