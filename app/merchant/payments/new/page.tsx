import type { Metadata } from "next";
import { CreatePayment } from "@/components/merchant/create-payment";

export const metadata: Metadata = { title: "Create payment" };

export default function CreatePaymentPage() {
  return <CreatePayment />;
}
