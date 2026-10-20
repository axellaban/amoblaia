import { createHash } from "node:crypto";
import { validOrigin } from "@/lib/session";
import { failure, HttpError, rpc } from "@/lib/commerce/http";
const kinds = [
  "soporte",
  "reembolso",
  "arrepentimiento",
  "afiliados",
  "marca-blanca",
  "api",
  "empleo",
  "newsletter",
];
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    if (Number(request.headers.get("content-length") || 0) > 8192)
      throw new HttpError(413, "La consulta es demasiado larga.");
    const { kind, email, message, consent } = await request.json();
    if (
      !kinds.includes(kind) ||
      typeof email !== "string" ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      consent !== true ||
      (kind !== "newsletter" &&
        (typeof message !== "string" ||
          message.trim().length < 10 ||
          message.length > 2000))
    )
      throw new HttpError(
        400,
        "Revisá el email y completá la consulta y el consentimiento.",
      );
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const rateKey = createHash("sha256")
      .update(
        `${process.env.CRON_SECRET || process.env.SUPABASE_SECRET_KEY}:${ip}`,
      )
      .digest("hex");
    // Only the backend can submit/read requests; rate decisions are serialized in SQL.
    const id = await rpc<string>("amobla_contact", {
      p_kind: kind,
      p_email: email.trim().toLowerCase(),
      p_message:
        kind === "newsletter"
          ? "Suscripción voluntaria al newsletter"
          : message.trim(),
      p_rate_key: rateKey,
    });
    return Response.json(
      { id },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function GET() {
  return Response.json({ error: "Método no disponible" }, { status: 405 });
}
