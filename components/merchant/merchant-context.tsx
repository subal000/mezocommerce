"use client";

import { createContext, useContext } from "react";
import type { MerchantDTO, PublicConfigDTO } from "@/lib/api-types";

export interface MerchantCtx {
  merchant: MerchantDTO;
  config: PublicConfigDTO | null;
  deployed: boolean;
}

const Ctx = createContext<MerchantCtx | null>(null);
export const MerchantProvider = Ctx.Provider;

/** The signed-in merchant. Only available inside the dashboard shell. */
export function useMerchantCtx(): MerchantCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMerchantCtx must be used inside the merchant dashboard");
  return v;
}
