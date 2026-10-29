// Shapes of habita_prospect_dataset() (see the prospecting migration). The
// server reads them with requireAdmin; nothing here is public.

export type Channel = "whatsapp" | "email" | "phone" | "instagram" | "web" | "other";
export type AttemptChannel = Channel | "unknown";
export type Stage = "pending" | "sent" | "conversation" | "interested" | "activated" | "customer" | "lost" | "discarded";
export type AttemptStatus = "prepared" | "opened" | "sent" | "uncertain" | "failed" | "bounced" | "invalid_endpoint" | "cancelled";
export type Precision = "time" | "day";

export type ProspectContact = {
  id: string;
  channel: Channel;
  address: string | null;
  address_original: string | null;
  person_name: string | null;
  is_decision_maker: boolean;
  confidence: string | null;
  source: string | null;
  needs_review: boolean;
  review_reason: string | null;
  verified: boolean;
  invalid: boolean;
  is_primary: boolean;
  /** Widest active suppression for this contact: account, channel or contact. */
  blocked: "account" | "channel" | "contact" | null;
};

/** Demo steps of an agency: created, sent (published link), and the highest visitor step (1 visit, 2 interaction, 3 own panel). */
export type DemoProgress = { created: boolean; sent: boolean; level: 0 | 1 | 2 | 3 };

export type ProspectAccount = {
  id: string;
  agency_id: string;
  name: string;
  website: string | null;
  /** The agency has accounts linked by itself or by a claim code (verified). */
  linked: boolean;
  campaign: string | null;
  sdr: string | null;
  priority: string | null;
  score: number | null;
  score_components: Record<string, unknown>;
  scoring_version: string | null;
  zone: string | null;
  decision_maker: string | null;
  decision_maker_role: string | null;
  stage: Stage;
  lost_reason: string | null;
  next_action: string | null;
  due_at: string | null;
  due_precision: Precision;
  version: number;
  created_at: string;
  imported: boolean;
  demos: number;
  /** Activity of the agency's demos: the highest step reached by any of them. Filled by the server, not by the database function. */
  demo?: DemoProgress;
  suppressed: boolean;
  contacts: ProspectContact[];
};

export type OutreachAttempt = {
  id: string;
  account_id: string;
  contact_id: string | null;
  campaign: string;
  step: number;
  ordinal: number | null;
  template_version_id: string | null;
  template_id: string | null;
  is_custom: boolean;
  variant_label: string | null;
  channel: AttemptChannel;
  recipient: string | null;
  sender: string | null;
  subject: string | null;
  body: string | null;
  status: AttemptStatus;
  status_reason: string | null;
  prepared_at: string;
  opened_at: string | null;
  lock_holder: string | null;
  lock_expires_at: string | null;
  sent_at: string | null;
  sent_precision: Precision | null;
  verification_method: "channel_observed" | "manual" | "imported" | null;
  legacy: boolean;
  version: number;
};

export type ProspectEventType = "reply" | "auto_reply" | "interest" | "not_interested" | "meeting" | "lost" | "activated" | "purchased" | "refunded";

export type ProspectEvent = {
  id: string;
  account_id: string;
  attempt_id: string | null;
  type: ProspectEventType;
  occurred_at: string;
  precision: Precision;
  channel: string | null;
  human: boolean | null;
  source: "manual" | "import" | "server";
  details: Record<string, unknown>;
  /** A later correction voided it: kept in history, left out of metrics. */
  corrected: boolean;
};

export type TemplateVersion = { id: string; version: number; subject: string | null; body: string; created_at: string };
export type OutreachTemplate = {
  id: string;
  name: string;
  purpose: string | null;
  step: number;
  channel: "whatsapp" | "email";
  archived: boolean;
  versions: TemplateVersion[];
};

export type MetricSettings = { version: number; message_window_days: number; account_window_days: number; small_sample: number };

export type Dataset = {
  now: string;
  settings: MetricSettings;
  accounts: ProspectAccount[];
  attempts: OutreachAttempt[];
  events: ProspectEvent[];
  templates: OutreachTemplate[];
  last_import: { id: string; source: string; file_name: string | null; applied_at: string; report: Record<string, unknown> } | null;
};

export const STAGE_LABEL: Record<Stage, string> = {
  pending: "Pendiente",
  sent: "Enviado",
  conversation: "En conversación",
  interested: "Interesado",
  activated: "Activado",
  customer: "Cliente",
  lost: "Perdido",
  discarded: "Descartado",
};

export const CHANNEL_LABEL: Record<AttemptChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  phone: "Teléfono",
  instagram: "Instagram",
  web: "Web",
  other: "Otro",
  unknown: "Canal desconocido",
};

export const STEP_LABEL: Record<number, string> = {
  0: "Conversación",
  1: "Primer mensaje",
  2: "Seguimiento 1",
  3: "Seguimiento 2",
};

export const ATTEMPT_STATUS_LABEL: Record<AttemptStatus, string> = {
  prepared: "Preparado · sin enviar",
  opened: "Canal abierto · envío sin confirmar",
  sent: "Envío confirmado",
  uncertain: "Resultado incierto · conciliar antes de reintentar",
  failed: "Envío fallido",
  bounced: "Rebotado",
  invalid_endpoint: "Destino inválido",
  cancelled: "Cancelado",
};
