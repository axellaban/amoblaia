import { cookies } from "next/headers";
import {
  configured,
  configurationIssues,
  COOKIE_NAME,
  createSession,
  sameSecret,
  SESSION_SECONDS,
  validOrigin,
  verifySession,
} from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const jar = await cookies();
  return Response.json(
    {
      configured: configured(),
      configurationIssues: configurationIssues(),
      revision: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      authenticated: verifySession(
        jar.get(COOKIE_NAME)?.value,
        process.env.STUDIO_ACCESS_PASSWORD,
      ),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  if (!validOrigin(request))
    return Response.json({ error: "Origen inválido." }, { status: 403 });
  if (!configured())
    return Response.json(
      {
        error:
          "El estudio está en modo demo. Falta configurar el acceso y la API en Vercel.",
      },
      { status: 503 },
    );
  if (Number(request.headers.get("content-length") ?? 0) > 2048)
    return Response.json({ error: "Solicitud inválida." }, { status: 413 });
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return Response.json({ error: "Solicitud inválida." }, { status: 400 });
  }
  if (
    typeof password !== "string" ||
    password.length > 256 ||
    !sameSecret(password, process.env.STUDIO_ACCESS_PASSWORD!)
  )
    return Response.json(
      { error: "La clave de acceso no es correcta." },
      { status: 401 },
    );
  const jar = await cookies();
  jar.set(COOKIE_NAME, createSession(process.env.STUDIO_ACCESS_PASSWORD!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return Response.json({ authenticated: true });
}
export async function DELETE(request: Request) {
  if (!validOrigin(request))
    return Response.json({ error: "Origen inválido." }, { status: 403 });
  (await cookies()).delete(COOKIE_NAME);
  return Response.json({ authenticated: false });
}
