import { createHash } from "node:crypto";
import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { agencyCredits } from "@/lib/agency/panel";
import { membershipFor } from "@/lib/agency/server";
import { invitationOf } from "@/lib/agency/invitation";
import { assistantInstructions, type AssistantContext } from "@/lib/assistant/prompt";
import { assistantInput, AssistantInputError, type AssistantInput } from "@/lib/assistant/shared";
import { allowQuestion } from "@/lib/assistant/rate";
import { publishedDemo } from "@/lib/demos/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { validOrigin } from "@/lib/session";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = () => process.env.OPENAI_CHAT_MODEL || "gpt-5-mini";
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Who asks and from where: a signed-in account in its panel, or an agency in
 * its demo with a live invitation for that same agency. The demo token alone,
 * the buyers' link, never opens the chat.
 */
async function contextOf(request: Request, input: AssistantInput): Promise<{ key: string; context: AssistantContext }> {
  if (input.place.kind === "panel") {
    const user = await requireUser(request);
    const membership = await membershipFor(user).catch(() => null);
    const credits = membership && !membership.support ? await agencyCredits(membership.agency.owner_id) : null;
    return {
      key: `user:${user.id}`,
      context: {
        kind: "panel",
        path: input.path,
        agencyName: membership?.agency.name ?? null,
        role: membership?.role ?? null,
        credits,
        support: Boolean(membership?.support),
      },
    };
  }
  if (!cloudConfigured()) throw new HttpError(503, "El asistente todavía no está disponible.");
  const { token, code } = input.place;
  const [demo, invitation] = await Promise.all([publishedDemo(token).catch(() => null), invitationOf(code).catch(() => null)]);
  if (!demo || !invitation || invitation.agencyId !== demo.agencyId) throw new HttpError(403, "Este enlace ya no permite usar el asistente.");
  return {
    key: `demo:${createHash("sha256").update(code).digest("hex")}`,
    context: { kind: "demo", path: input.path, agencyName: demo.agencyName, title: demo.title, freeCredits: invitation.freeCredits },
  };
}

/** Only the text of OpenAI's event stream, as plain text for the chat. */
function textStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let wrote = false;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (!wrote) controller.enqueue(encoder.encode("Se me secó el pincel. Probá de nuevo en un momento."));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events)
          for (const line of event.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let parsed: { type?: string; delta?: unknown };
            try {
              parsed = JSON.parse(data);
            } catch {
              continue;
            }
            if (parsed.type === "response.output_text.delta" && typeof parsed.delta === "string") {
              wrote = true;
              controller.enqueue(encoder.encode(parsed.delta));
            } else if (parsed.type === "error" || parsed.type === "response.failed") {
              console.error("assistant_stream_failed");
              controller.enqueue(encoder.encode(wrote ? "\n\n(Se cortó la respuesta. Probá de nuevo.)" : "No pude responder ahora. Probá de nuevo en un momento."));
              wrote = true;
            }
          }
      } catch {
        console.error("assistant_stream_interrupted");
        controller.enqueue(encoder.encode("\n\n(Se cortó la respuesta. Probá de nuevo.)"));
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}

/** One question to Pablo: { messages, place, path } → the answer, streamed as plain text. */
export async function POST(request: Request) {
  try {
    if (!validOrigin(request)) throw new HttpError(403, "Origen inválido.");
    if (Number(request.headers.get("content-length") || 0) > 32768) throw new HttpError(413, "La conversación es demasiado larga.");
    let input: AssistantInput;
    try {
      input = assistantInput(await request.json());
    } catch (e) {
      throw new HttpError(400, e instanceof AssistantInputError ? e.message : "La consulta no es válida.");
    }
    const { key, context } = await contextOf(request, input);
    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "El asistente todavía no está disponible.");
    if (!allowQuestion(key)) throw new HttpError(429, "Hiciste muchas preguntas seguidas. Esperá unos minutos y volvé a intentar.");
    const model = MODEL();
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: assistantInstructions(context),
        input: input.messages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: 1200,
        // Reasoning models answer a help question faster with little reasoning.
        ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "low" } } : {}),
        store: false,
        stream: true,
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (!response.ok || !response.body) {
      console.error("assistant_provider_error", response.status);
      throw new HttpError(502, "No pude responder ahora. Probá de nuevo en un momento.");
    }
    return new Response(textStream(response.body), {
      headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
      return Response.json({ error: "La respuesta tardó demasiado. Probá de nuevo." }, { status: 504 });
    return failure(e);
  }
}

export async function GET() {
  return Response.json({ error: "Método no disponible" }, { status: 405 });
}
