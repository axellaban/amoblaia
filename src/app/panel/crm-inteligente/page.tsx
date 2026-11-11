import type { Metadata } from "next";
import { requirePanelPage } from "@/lib/agency/page";
import { ProductPrototype } from "@/components/habita-product-prototype";
export const metadata: Metadata = { title: "CRM Inteligente", robots: { index: false, follow: false } };
export default async function Page() { await requirePanelPage("/panel/crm-inteligente"); return <ProductPrototype product="crm" />; }
