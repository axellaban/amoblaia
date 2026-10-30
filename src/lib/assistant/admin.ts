import "server-only";
import { adminClient } from "@/lib/supabase/server";

export type ConversationRow = {
  id: string;
  place: "panel" | "demo";
  user_email: string | null;
  agency_id: string | null;
  agency_name: string | null;
  demo_id: string | null;
  demo_title: string | null;
  support: boolean;
  path: string | null;
  questions: number;
  failures: number;
  last_question: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  error: string | null;
  created_at: string;
};

export type ConversationFilter = { place: "panel" | "demo" | null; q: string; agency: string | null; page: number };

export const PER_PAGE = 30;
const FIELDS = "id,place,user_email,agency_id,agency_name,demo_id,demo_title,support,path,questions,failures,last_question,created_at,updated_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The page's filters, from its URL. */
export function conversationFilter(params: Record<string, string | string[] | undefined>): ConversationFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const place = one(params.lugar);
  const agency = one(params.inmobiliaria);
  return {
    place: place === "panel" || place === "demo" ? place : null,
    // Characters that would change the meaning of the search filter are dropped.
    q: one(params.q).replace(/[,()*%\\]/g, " ").trim().slice(0, 80),
    agency: UUID.test(agency) ? agency : null,
    page: Math.max(1, Math.min(1000, Number.parseInt(one(params.pagina), 10) || 1)),
  };
}

/** Thrown when the history's tables do not exist yet: the migration is pending. */
export class MissingHistory extends Error {}
const missing = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /assistant_/.test(error.message ?? "")));

/** The latest conversations, filtered, with totals for the header. */
export async function conversations(filter: ConversationFilter) {
  const db = adminClient();
  let query = db.from("assistant_conversations").select(FIELDS, { count: "exact" }).order("updated_at", { ascending: false });
  if (filter.place) query = query.eq("place", filter.place);
  if (filter.agency) query = query.eq("agency_id", filter.agency);
  if (filter.q) {
    const like = `%${filter.q}%`;
    query = query.or(`agency_name.ilike.${like},user_email.ilike.${like},demo_title.ilike.${like},last_question.ilike.${like}`);
  }
  const from = (filter.page - 1) * PER_PAGE;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const [list, week] = await Promise.all([
    query.range(from, from + PER_PAGE - 1),
    db.from("assistant_conversations").select("questions,failures").gte("updated_at", since).limit(5000),
  ]);
  if (missing(list.error)) throw new MissingHistory();
  if (list.error) throw new Error("ASSISTANT_HISTORY_FAILED");
  const recent = (week.data ?? []) as { questions: number; failures: number }[];
  return {
    items: (list.data ?? []) as ConversationRow[],
    total: list.count ?? 0,
    week: {
      conversations: recent.length,
      questions: recent.reduce((n, r) => n + r.questions, 0),
      failures: recent.reduce((n, r) => n + r.failures, 0),
    },
  };
}

/** One conversation and all its messages, or null. */
export async function conversation(id: string) {
  if (!UUID.test(id)) return null;
  const db = adminClient();
  const [head, messages] = await Promise.all([
    db.from("assistant_conversations").select(FIELDS).eq("id", id).maybeSingle(),
    db.from("assistant_messages").select("id,role,content,model,error,created_at").eq("conversation_id", id).order("id").limit(1000),
  ]);
  if (missing(head.error)) throw new MissingHistory();
  if (head.error || messages.error) throw new Error("ASSISTANT_HISTORY_FAILED");
  if (!head.data) return null;
  return { conversation: head.data as ConversationRow, messages: (messages.data ?? []) as ConversationMessage[] };
}
