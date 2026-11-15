import type { Metadata } from "next";
import { OrderStatus } from "@/components/storefront/order-status";
import { StoreHeader } from "@/components/storefront/storefront";
import { STORE_NAME } from "@/components/storefront/catalog";

export const metadata: Metadata = { title: "Order" };

export default async function DemoOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <StoreHeader name={STORE_NAME} />
      <main id="main" className="mx-auto w-full max-w-xl px-4 pt-6 pb-20 sm:px-6">
        <OrderStatus orderId={decodeURIComponent(id)} />
      </main>
    </>
  );
}
