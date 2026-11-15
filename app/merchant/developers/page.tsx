import type { Metadata } from "next";
import { ApiKeysView } from "@/components/merchant/developers";

export const metadata: Metadata = { title: "API keys" };

export default function DevelopersPage() {
  return <ApiKeysView />;
}
