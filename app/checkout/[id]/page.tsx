import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";

export const metadata: Metadata = { title: "Checkout" };

/** Fetches nothing on the server: the client loads the public checkout + status (no secrets anywhere here). */
export default async function CheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const embed = sp.embed === "1";
  return <CheckoutView id={decodeURIComponent(id)} embed={embed} />;
}
