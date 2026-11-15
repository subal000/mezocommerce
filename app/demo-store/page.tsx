import { Storefront } from "@/components/storefront/storefront";
import { DEMO_STORE_PRODUCTS, STORE_NAME } from "@/components/storefront/catalog";

export default function DemoStorePage() {
  return <Storefront storeName={STORE_NAME} products={DEMO_STORE_PRODUCTS} />;
}
