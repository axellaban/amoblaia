import type { Metadata } from "next";
import {
  ShowcasePage,
  showcaseMetadata,
} from "@/components/showcase-page";
// Always read live: a link turned off must stop working right away.
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ token: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return showcaseMetadata((await params).token);
}
export default async function SharedShowcase({ params }: Props) {
  return <ShowcasePage token={(await params).token} origin="enlace" />;
}
