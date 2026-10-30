import { createHash } from "node:crypto";
import { failure, HttpError, requireUser } from "@/lib/commerce/http";
import { agencyCredits } from "@/lib/agency/panel";
import { membershipFor } from "@/lib/agency/server";
import { invitationOf } from "@/lib/agency/invitation";
import { assistantInstructions, type AssistantContext } from "@/lib/assistant/prompt";
import { assistantInput, AssistantInputError, type AssistantInput } from "@/lib/assistant/shared";
import { logExchange, type ConversationOwner } from "@/lib/assistant/log";
import { allowQuestion } from "@/lib/assistant/rate";
import { publishedDemo } from "@/lib/demos/server";
import { cloudConfigured } from "@/lib/supabase/config";
import { validOrigin } from "@/lib/session";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The configured model first, then fast ones: a help chat needs its first
 * words within a second or two, which a reasoning model does not guarantee.
 */
const MODELS = () => [...new Set([process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4.1-mini", "gpt-4o-mini"])];
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Who asks and from where: a signed-in account in its panel, or an agency in
 * its demo with a live invitation for that same agency. The demo token alone,
 * the buyers' link, never opens the chat.
 */
async function contextOf(request: Request, input: AssistantInput): Promise<{ who: ConversationOwner; context: AssistantContext }> {
  if (input.place.kind === "panel") {
    const user = await requireUser(request);
    const membership = await membershipFor(user).catch(() => null);
    const credits = membership && !membership.support ? await agencyCredits(membership.agency.owner_id) : null;
    return {
      who: {
        owner: `user:${user.id}`,
        place: "panel",
        userId: user.id,
        email: user.email ?? null,
        agencyId: membership?.agency.id ?? null,
        agencyName: membership?.agency.name ?? null,
        demoId: null,
        demoTitle: null,
        support: Boolean(membership?.support),
      },
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
    who: {
      owner: `demo:${createHash("sha256").update(code).digest("hex")}`,
      place: "demo",
      userId: null,
      email: null,
      agencyId: demo.agencyId,
      agencyName: demo.agencyName,
      demoId: demo.id,
      demoTitle: demo.title,
      support: false,
    },
    context: { kind: "demo", path: input.path, agencyName: demo.agencyName, title: demo.title, freeCredits: invitation.freeCredits },
  };
}

/**
 * Only the text of OpenAI's event stream, as plain text for the chat. When it
 * ends, `done` receives the whole answer (and why it failed, if it did) before
 * the response closes, so the function lives until the history is saved.
 */
function textStream(body: ReadableStream<Uint8Array>, done: (answer: string, error: string | null) => Promise<unknown>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let wrote = false;
  let answer = "";
  let error: string | null = null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        // A pull that enqueues nothing is not called again, and the chat would wait
        // forever: OpenAI's first events (created, in progress) carry no text. So
        // it keeps reading until some text goes out or the answer ends.
        for (let sent = false; !sent; ) {
          const { done: finished, value } = await reader.read();
          if (finished) {
            if (!wrote) {
              error ??= "respuesta vacía";
              controller.enqueue(encoder.encode("Se me secó el pincel. Probá de nuevo en un momento."));
            }
            await done(answer, error);
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
                wrote = sent = true;
                answer += parsed.delta;
                controller.enqueue(encoder.encode(parsed.delta));
              } else if (parsed.type === "error" || parsed.type === "response.failed") {
                console.error("assistant_stream_failed");
                error = "OpenAI cortó la respuesta";
                controller.enqueue(encoder.encode(wrote ? "\n\n(Se cortó la respuesta. Probá de nuevo.)" : "No pude responder ahora. Probá de nuevo en un momento."));
                wrote = sent = true;
              }
            }
        }
      } catch {
        console.error("assistant_stream_interrupted");
        controller.enqueue(encoder.encode("\n\n(Se cortó la respuesta. Probá de nuevo.)"));
        await done(answer, "respuesta interrumpida");
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}

/** OpenAI's reason for a refusal, short and without secrets, for the logs. */
async function providerReason(response: Response) {
  const data = (await response.json().catch(() => null)) as { error?: { code?: string; type?: string; message?: string } } | null;
  const e = data?.error;
  return [e?.code, e?.type, e?.message?.slice(0, 160)].filter(Boolean).join(" · ") || "sin detalle";
}

/**
 * The streamed answer from OpenAI. A refusal of the model itself (not
 * enabled for the account, unknown or a parameter it does not take) tries
 * the next one; anything else is reported with its status, so it can be fixed.
 */
async function ask(context: AssistantContext, input: AssistantInput) {
  let status = 0;
  for (const model of MODELS()) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        instructions: assistantInstructions(context),
        input: input.messages.map((m) => ({ role: m.role, content: m.content })),
        max_output_tokens: 1200,
        // A reasoning model, if configured, answers a help question faster with the least reasoning.
        ...(/^(gpt-5|o\d)/.test(model) ? { reasoning: { effort: "minimal" } } : {}),
        store: false,
        stream: true,
      }),
      signal: AbortSignal.timeout(55_000),
    });
    if (response.ok && response.body) return { response, model };
    status = response.status;
    console.error("assistant_provider_error", model, status, await providerReason(response));
    if (![400, 403, 404].includes(status)) break;
  }
  // 503, not 502: a gateway may replace a 502's body, and the chat would lose the reason.
  throw new HttpError(
    503,
    status === 401
      ? "El asistente no está configurado (clave de OpenAI inválida)."
      : status === 429
        ? "El asistente está muy ocupado o sin saldo en OpenAI. Probá en un rato."
        : `No pude responder ahora (OpenAI ${status || "sin respuesta"}). Probá de nuevo en un momento.`,
  );
}

/** One question to Miguel Ángel: { messages, place, path } → the answer, streamed as plain text. */
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
    const { who, context } = await contextOf(request, input);
    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "El asistente todavía no está disponible.");
    if (!allowQuestion(who.owner)) throw new HttpError(429, "Hiciste muchas preguntas seguidas. Esperá unos minutos y volvé a intentar.");
    const question = input.messages[input.messages.length - 1].content;
    const exchange = { conversation: input.conversation, path: input.path, question };
    let asked: Awaited<ReturnType<typeof ask>>;
    try {
      asked = await ask(context, input);
    } catch (e) {
      // A question that got no answer is kept too, with the reason, for the team.
      const reason = e instanceof HttpError ? e.message : e instanceof Error && e.name === "TimeoutError" ? "OpenAI tardó demasiado" : "error inesperado";
      await logExchange(who, { ...exchange, answer: null, model: null, error: reason });
      throw e;
    }
    const { response, model } = asked;
    const stream = textStream(response.body!, (answer, error) => logExchange(who, { ...exchange, answer, model, error }));
    return new Response(stream, {
      // No proxy may hold the words back until the answer is complete.
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Accel-Buffering": "no", ...NO_STORE },
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
      return Response.json({ error: "La respuesta tardó demasiado. Probá de nuevo." }, { status: 503 });
    return failure(e);
  }
}

export async function GET() {
  return Response.json({ error: "Método no disponible" }, { status: 405 });
}
