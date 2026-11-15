import type { Metadata } from "next";
import { ShopifyView } from "@/components/merchant/shopify-view";

export const metadata: Metadata = { title: "Shopify" };

export default function ShopifyPage() {
  return <ShopifyView />;
}
