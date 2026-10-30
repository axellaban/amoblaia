import { notFound } from "next/navigation";
import { PublicDemo, publicDemoMetadata } from "../../public-demo";

// The agency's link: /demo/<token>/presentacion, or /demo/<token>/presentacion/<codigo>
// (with its invitation), /ficha after the code to see the buyers' page and
// /precios to open its plans inside the agency's demo.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ token: string; rest?: string[] }>;
};

/** The invitation code and the view, from the path after /presentacion. */
function viewOf(rest: string[] = []) {
  if (rest.length === 0) return { code: null, ficha: false, prices: false };
  if (rest.length === 1) return { code: rest[0], ficha: false, prices: false };
  if (rest.length === 2 && rest[1] === "ficha") return { code: rest[0], ficha: true, prices: false };
  if (rest.length === 2 && rest[1] === "precios") return { code: rest[0], ficha: false, prices: true };
  return null;
}

export async function generateMetadata({ params }: Props) {
  const { token } = await params;
  return publicDemoMetadata(token, true);
}

export default async function PresentationPage({ params }: Props) {
  const { token, rest } = await params;
  const view = viewOf(rest);
  if (!view) notFound();
  return <PublicDemo token={token} presentation code={view.code} ficha={view.ficha} prices={view.prices} />;
}
