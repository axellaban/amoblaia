import { redirect } from "next/navigation";
import { INVITE_PARAM, presentationPath } from "@/lib/agency/demo-invite";
import { PRESENTATION_PARAM } from "@/lib/demos/shared";
import { PublicDemo, publicDemoMetadata } from "./public-demo";

// Read on every request: unpublishing or rotating the link takes effect at once.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  return publicDemoMetadata(token, false);
}

export default async function PublicDemoPage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  // Links sent before the path format (?presentacion=1, ?codigo=, ?vista=ficha) move to it.
  if (query[PRESENTATION_PARAM] === "1") {
    const raw = query[INVITE_PARAM];
    const path = presentationPath(token, typeof raw === "string" ? raw : null);
    redirect(query.vista === "ficha" ? `${path}/ficha` : path);
  }
  return <PublicDemo token={token} presentation={false} code={null} ficha={false} />;
}
