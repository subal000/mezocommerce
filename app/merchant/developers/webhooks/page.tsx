import type { Metadata } from "next";
import { WebhooksView } from "@/components/merchant/webhooks-view";

export const metadata: Metadata = { title: "Webhooks" };

export default function WebhooksPage() {
  return <WebhooksView />;
}
