import { currentUser, adminClient } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import { validOrigin } from "@/lib/session";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function requireUser(request?: Request, allowGuest = false) {
  if (!cloudEnabled() || !cloudConfigured())
    throw new HttpError(503, "Las cuentas todavía no están habilitadas.");
  if (request && !validOrigin(request))
    throw new HttpError(403, "Origen inválido.");
  let user = await currentUser();
  if (!user && allowGuest) {
    const { guestId } = await import("./guest");
    const id = await guestId();
    if (id) {
      const result = await adminClient().auth.admin.getUserById(id);
      if (result.data.user?.is_anonymous) user = result.data.user;
    }
  }
  if (!user || (!user.email_confirmed_at && !(allowGuest && user.is_anonymous)))
    throw new HttpError(401, "Ingresá a tu cuenta y verificá tu email.");
  return user;
}
export function isAdmin(email?: string) {
  return Boolean(
    email &&
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase()),
  );
}
export async function requireAdmin(request?: Request) {
  const user = await requireUser(request);
  if (!isAdmin(user.email))
    throw new HttpError(403, "Acceso reservado al equipo.");
  return user;
}
export function failure(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  // Internal messages are short codes (e.g. MERCADOPAGO_400), never secrets.
  console.error(
    "commerce_error",
    error instanceof Error ? error.message.slice(0, 120) : "unknown",
  );
  return Response.json(
    { error: "No pudimos completar la operación. Intentá nuevamente." },
    { status: 500 },
  );
}
export async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await adminClient().rpc(name, args);
  if (error) {
    // Matched by substring in order: the per-account codes must come before
    // DAILY_LIMIT and STORAGE_LIMIT, which they contain.
    const messages: Record<string, [number, string]> = {
      DEMO_PHOTO_NOT_FOUND: [404, "No encontramos la foto de la demo."],
      INVALID_DEMO_MODE: [400, "Elegí Amoblar o Rediseñar."],
      USER_DAILY_LIMIT: [
        429,
        "Llegaste al máximo de diseños por hoy. Mañana podés seguir.",
      ],
      USER_STORAGE_LIMIT: [
        409,
        "Tu cuenta llegó a su espacio máximo. Vaciá la papelera para seguir creando.",
      ],
      GUEST_REQUIRED: [403, "Recargá la página para empezar la prueba gratis."],
      GUEST_LIMIT: [
        429,
        "Alcanzaste el límite de la prueba gratuita. Elegí un plan para continuar.",
      ],
      CONTACT_LIMIT: [
        429,
        "Ya recibimos varias consultas. Esperá un rato antes de enviar otra.",
      ],
      PROJECT_NOT_FOUND: [
        404,
        "No encontramos la foto. Revisá también la papelera.",
      ],
      FOLDER_NOT_FOUND: [404, "No encontramos esa carpeta."],
      PRODUCT_UNAVAILABLE: [409, "Este plan todavía no está disponible."],
      PURCHASE_LIMIT: [409, "Esta promoción es una por cuenta y ya la usaste."],
      SUBSCRIPTION_EXISTS: [
        409,
        "Ya tenés una suscripción o un alta pendiente. Revisala desde Mi cuenta.",
      ],
      ORDER_MISMATCH: [409, "La solicitud no corresponde a esta compra."],
      STORAGE_LIMIT: [
        503,
        "El almacenamiento está al límite de capacidad. Contactá al equipo antes de continuar.",
      ],
      NO_CREDITS: [402, "No te quedan fotos disponibles. Elegí un plan."],
      BUSY: [409, "Ya tenés una generación en curso. Esperá su resultado."],
      ENTITLEMENT_EXPIRED: [
        402,
        "El período pago venció. Elegí un plan para crear más propuestas de esta foto.",
      ],
      FREE_LIMIT: [
        402,
        "Llegaste al límite de la prueba gratis. Elegí un plan para seguir creando.",
      ],
      FREE_FEATURE_LOCKED: [
        403,
        "Este ambiente o función está incluido en los planes pagos.",
      ],
      VERSION_LIMIT: [409, "Esta foto ya usó sus tres variantes incluidas."],
      DAILY_LIMIT: [
        429,
        "Llegamos al cupo de generación de hoy. Probá más tarde.",
      ],
      ACCOUNT_BLOCKED: [
        403,
        "Tu cuenta necesita una revisión. Contactá al equipo.",
      ],
    };
    for (const [key, [status, message]] of Object.entries(messages))
      if (error.message.includes(key)) throw new HttpError(status, message);
    throw new Error(`DATABASE_${error.code}`);
  }
  return data as T;
}
