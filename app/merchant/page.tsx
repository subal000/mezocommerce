import type { Metadata } from "next";
import { Overview } from "@/components/merchant/overview";

export const metadata: Metadata = { title: "Overview" };

export default function MerchantOverviewPage() {
  return <Overview />;
}
