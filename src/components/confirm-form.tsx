"use client";
import { useState } from "react";
import { LoaderCircle } from "lucide-react";
// Sent once: the link's token is single-use, so a second click would cancel
// the first sign-in and fail with an expired-link error.
export function ConfirmForm({
  tokenHash,
  type,
  next,
}: {
  tokenHash: string;
  type: string;
  next: string;
}) {
  const [sent, setSent] = useState(false);
  return (
    <form
      method="post"
      action="/auth/confirm"
      onSubmit={(e) => {
        if (sent) e.preventDefault();
        else setSent(true);
      }}
    >
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="next" value={next} />
      <button
        className="button button-primary"
        type="submit"
        disabled={sent}
        aria-busy={sent}
      >
        {sent ? <LoaderCircle size={18} className="spin" /> : null} Continuar
      </button>
    </form>
  );
}
