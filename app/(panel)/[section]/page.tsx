import { notFound } from "next/navigation";
import { SectionView } from "@/components/panel/SectionView";
import { NAV_IDS } from "@/lib/nav";

export const dynamicParams = false;

export function generateStaticParams() {
  return NAV_IDS.filter((id) => id !== "dashboard").map((section) => ({ section }));
}

export default async function Page({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!NAV_IDS.includes(section) || section === "dashboard") notFound();
  return <SectionView id={section} />;
}
