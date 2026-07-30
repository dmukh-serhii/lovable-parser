import type { Metadata } from "next";
import { SitesTable } from "@/components/sites-table";
import { getImageDomain } from "@/lib/img";

export const metadata: Metadata = { title: "Domains — lovable-parser" };
export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const imgDomain = await getImageDomain();
  return <SitesTable imgDomain={imgDomain} />;
}
