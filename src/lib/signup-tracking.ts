"use client";
import { useEffect, useRef } from "react";
import { registerSuperProperties, setPersonProperties, track, type EventProperties } from "@/lib/analytics";

/** The kind of field, never its value: "email", "new-password", "organization"… */
const fieldKind = (target: EventTarget) =>
  target instanceof HTMLInputElement ? (target.autocomplete || target.type || "text").slice(0, 30) : "other";

/**
 * The steps of a sign-up form, told apart: seen (signup_form_viewed), begun
 * (signup_form_started: the first character typed or autofilled, not the
 * autofocus), sent (signup_form_submitted) and refused (signup_form_error,
 * with a kind, never the message or what was typed). `flow` names the form.
 */
export function useSignupTracking(flow: string, context: EventProperties = {}, active = true) {
  const props = useRef({ flow, ...context });
  props.current = { flow, ...context };
  const started = useRef(false);
  // Once per form shown: re-running the effect (React's development checks) is not a new view.
  const viewed = useRef("");
  useEffect(() => {
    if (!active || viewed.current === flow) return;
    viewed.current = flow;
    started.current = false;
    track("signup_form_viewed", props.current);
  }, [flow, active]);
  return {
    /** For the form's onInputCapture. */
    onInput: (e: React.FormEvent) => {
      if (started.current || !active) return;
      started.current = true;
      track("signup_form_started", { ...props.current, first_field: fieldKind(e.target) });
    },
    submitted: (extra: EventProperties = {}) => track("signup_form_submitted", { ...props.current, ...extra }),
    failed: (errorKind: string, extra: EventProperties = {}) =>
      track("signup_form_error", { ...props.current, error_kind: errorKind.slice(0, 40), ...extra }),
    /** The account exists now (it may still need its e-mail confirmed). Sent at once: a redirect follows. */
    accountCreated: (method: string, extra: EventProperties = {}) =>
      track("account_created", { ...props.current, method, ...extra }, true, { account_created_at: new Date().toISOString() }),
  };
}

/** The agency every later event belongs to, on the events and on the person. */
export function registerAgency(agencyId: string) {
  registerSuperProperties({ agency_id: agencyId });
  setPersonProperties({ agency_id: agencyId }, { first_agency_id: agencyId });
}
