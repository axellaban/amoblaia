import "server-only";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { adminClient } from "@/lib/supabase/server";
import { cloudConfigured, cloudEnabled } from "@/lib/supabase/config";
import {
  DISCLOSURE_LABEL_PNG,
  DISCLOSURE_LABEL_SIZE,
} from "@/lib/commerce/disclosure-label";
import {
  TOKEN_PATTERN,
  type ImageRef,
  type PublicShowcase,
} from "./showcase-shared";

/** 24 random bytes: an unguessable link, the only key to a showcase. */
export function newShowcaseToken() {
  return randomBytes(24).toString("base64url");
}

/**
 * The public data of an active showcase, or null for an unknown, inactive or
 * deleted one. The database function decides what is public.
 */
export async function loadPublicShowcase(
  token: string,
): Promise<PublicShowcase | null> {
  if (!TOKEN_PATTERN.test(token) || !cloudEnabled() || !cloudConfigured())
    return null;
  const { data, error } = await adminClient().rpc("amobla_public_showcase", {
    p_token: token,
  });
  if (error) throw new Error("SHOWCASE_LOOKUP_FAILED");
  return (data as PublicShowcase | null) ?? null;
}

/** Storage path of one image of an active showcase, or null. */
export async function publicAssetPath(token: string, ref: ImageRef) {
  if (!TOKEN_PATTERN.test(token) || !cloudEnabled() || !cloudConfigured())
    return null;
  const { data, error } = await adminClient().rpc(
    "amobla_public_showcase_asset",
    {
      p_token: token,
      p_kind: ref.kind,
      p_id:
        ref.kind === "logo" ? "00000000-0000-0000-0000-000000000000" : ref.id,
    },
  );
  if (error) throw new Error("SHOWCASE_ASSET_LOOKUP_FAILED");
  return typeof data === "string" && data ? data : null;
}

/**
 * Burns the disclosure into a proposal served to buyers, so a saved or
 * forwarded copy keeps it. Half the width, in the bottom-left corner; the
 * page shows a larger, sharper label over the same corner.
 */
export async function stampDisclosure(image: Buffer) {
  const { width = 1024, height = 768 } = await sharp(image).metadata();
  const labelWidth = Math.min(
    width - 2,
    Math.max(160, Math.round(width * 0.5)),
  );
  const labelHeight = Math.round(
    (labelWidth * DISCLOSURE_LABEL_SIZE.height) / DISCLOSURE_LABEL_SIZE.width,
  );
  const margin = Math.round(width * 0.025);
  const label = await sharp(DISCLOSURE_LABEL_PNG)
    .resize({ width: labelWidth })
    .toBuffer();
  return sharp(image)
    .composite([
      {
        input: label,
        left: margin,
        top: Math.max(0, height - margin - labelHeight),
      },
    ])
    .jpeg({ quality: 88 })
    .toBuffer();
}
