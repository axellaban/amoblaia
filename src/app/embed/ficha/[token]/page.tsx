import type { Metadata } from "next";
import {
  ShowcasePage,
  showcaseMetadata,
} from "@/components/showcase-page";
// The only framable route (see next.config.ts); always read live.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return showcaseMetadata((await params).token);
}
export default async function EmbeddedShowcase({ params }: Props) {
  return <ShowcasePage token={(await params).token} origin="embed" />;
}
