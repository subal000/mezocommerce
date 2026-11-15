import type { Metadata } from "next";
import { PaymentDetail } from "@/components/merchant/payment-detail";

export const metadata: Metadata = { title: "Payment" };

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentDetail id={decodeURIComponent(id)} />;
}
