import "server-only";
import { rpc } from "@/lib/commerce/http";

/** Who is talking with Miguel Ángel, as the team's history keeps it. */
export type ConversationOwner = {
  /** The account or the demo invitation (hashed): only it keeps writing to its conversation. */
  owner: string;
  place: "panel" | "demo";
  userId: string | null;
  email: string | null;
  agencyId: string | null;
  agencyName: string | null;
  demoId: string | null;
  demoTitle: string | null;
  support: boolean;
};

export type Exchange = {
  conversation: string | null;
  path: string;
  question: string;
  answer: string | null;
  model: string | null;
  error: string | null;
};

/**
 * Keeps one question and its answer for /admin/asistente. Best effort: the
 * chat never fails because its history could not be saved (for example,
 * before the migration is applied).
 */
export async function logExchange(who: ConversationOwner, exchange: Exchange) {
  try {
    return await rpc<string>("habita_assistant_log", {
      p_conversation: exchange.conversation,
      p_owner: who.owner,
      p_place: who.place,
      p_user: who.userId,
      p_email: who.email,
      p_agency: who.agencyId,
      p_agency_name: who.agencyName,
      p_demo: who.demoId,
      p_demo_title: who.demoTitle,
      p_support: who.support,
      p_path: exchange.path,
      p_question: exchange.question,
      p_answer: exchange.answer,
      p_model: exchange.model,
      p_error: exchange.error,
    });
  } catch {
    console.error("assistant_log_failed");
    return null;
  }
}
