import { failure, requireAdmin } from "@/lib/commerce/http";
import { compactStoredImages } from "@/lib/commerce/compact";

export const maxDuration = 300;

/**
 * Recompresses a slice of the stored photos (about four minutes) and says how many are left.
 * The daily cron does the same; this runs it now. Call it again until `left` is 0.
 */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await compactStoredImages(Date.now() + (maxDuration - 20) * 1000));
  } catch (error) {
    return failure(error);
  }
}
