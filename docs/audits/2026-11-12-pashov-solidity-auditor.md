# 🔐 Security Review — mezocommerce

---

## Scope

|  |  |
| --- | --- |
| **Mode** | default |
| **Files reviewed** | `./contracts/script/RegisterMerchant.s.sol` · `./contracts/script/Deploy.s.sol` · `./contracts/src/MerchantPaymentProcessor.sol` |
| **Confidence threshold (1-100)** | 75 |
| **Passes** | 2 |
| **Memory** | 0 records before this scan · 13 after · `93392c4` |

---

## Findings

[85] **1. A registered merchant can mark another merchant's paymentId as paid**

`MerchantPaymentProcessor._pay` · Confidence: 85 · seen in 2/2 runs · NEW

**Description**
Any caller can register a merchant and pay a 1 wei intent with the paymentId of another merchant, so the real customer payment for that paymentId reverts with `IntentAlreadyPaid`.

**Fix (Option A — restrict: key all intent state by merchant and paymentId)**:

```diff
-    mapping(bytes32 paymentId => IntentState) private _states;
-    mapping(bytes32 paymentId => PaymentRecord) private _payments;
+    mapping(uint256 merchantId => mapping(bytes32 paymentId => IntentState)) private _states;
+    mapping(uint256 merchantId => mapping(bytes32 paymentId => PaymentRecord)) private _payments;
 ...
-        if (_states[intent.paymentId] == IntentState.Paid) revert IntentAlreadyPaid();
+        if (_states[intent.merchantId][intent.paymentId] == IntentState.Paid) revert IntentAlreadyPaid();
```

**Fix (Option B — restrict: bind each paymentId to the first merchant that uses it)**:

```diff
+    mapping(bytes32 paymentId => uint256 merchantId) private _owner;
 ...
+        uint256 o = _owner[intent.paymentId];
+        if (o != 0 && o != intent.merchantId) revert IntentAlreadyPaid();
```

---

Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [85] | A registered merchant can mark another merchant's paymentId as paid |

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass. These are not false positives — they are high-signal leads for manual review. Not scored._

- **The deploy script uses the testnet MUSD address on any chain** — `Deploy.run` · seen in 1/2 runs · NEW — Code smells: no `block.chainid` check on the default; `musd.code.length > 0` is the only guard. — `Deploy.run` falls back to a hardcoded testnet MUSD address and checks only that code exists there, so a deploy on another chain allowlists an unintended token.
- **Without a key or --sender, the script uses the Foundry default sender as owner or payout** — `Deploy.run` · seen in 1/2 runs · NEW — Code smells: `deployer = msg.sender` fallback; `owner` and `payout` default to it. — When `DEPLOYER_PRIVATE_KEY` and `--sender` are both missing, the owner (and in `RegisterMerchant`, the payout) is Foundry's default sender, which nobody controls.
- **A merchant can set the token contract as the payout** — `MerchantPaymentProcessor._checkPayout` · seen in 2/2 runs · NEW — Code smells: no check against supported token addresses. — `_checkPayout` rejects only the zero address and the processor, so a merchant can set the MUSD token as payout and payments to it are locked. The payer must still choose to pay that merchant.
- **An observer can pay an open intent before the customer** — `MerchantPaymentProcessor._pay` · seen in 2/2 runs · NEW — Code smells: `intent.payer == address(0)` skips the payer check; the record stores `msg.sender` as payer. — When `intent.payer` is zero, any caller can pay the intent first, so the customer payment reverts and a later refund goes to that caller. The caller pays the full amount, and we found no profit path.
- **A signer can sign an intent that does not expire** — `MerchantPaymentProcessor._validSignature` · seen in 2/2 runs · NEW — Code smells: `block.timestamp > intent.expiresAt` with no maximum window. — `expiresAt` has no upper bound, so a merchant signer can issue an intent that stays payable at an old price. The check sits in `_pay`; only `cancelPayment` or signer removal stops it.
- **A merchant can make intentState show Cancelled for another merchant's paymentId** — `MerchantPaymentProcessor.cancelPayment` · seen in 2/2 runs · NEW — Code smells: `cancelPayment` writes the global `_states`; no `m.active` check; `setSigner` does not touch `_cancelledBy`. — Any registered merchant can set the global `_states[paymentId]` to `Cancelled`, while the other merchant can still pay it. Signer revocation does not clear an earlier cancel, and an inactive merchant's signer can still cancel.
- **intentState returns Paid without the merchant that paid** — `MerchantPaymentProcessor.intentState` · seen in 2/2 runs · NEW — Code smells: `intentState(bytes32)` takes no `merchantId`. — A consumer that checks only `intentState(paymentId) == Paid` can credit an order that another merchant paid for 1 wei. The in-repo verifier matches `merchantId` (`lib/server/verify.ts`).
- **The contract accepts any paymentId without a binding to the merchant** — `MerchantPaymentProcessor.pay` · seen in 2/2 runs · NEW — Code smells: `paymentId` is any `bytes32`; no merchant prefix binds it. — An attacker who sees a paymentId in a checkout link or in the mempool can pay it first. The backend uses `randomBytes(32)`, so prediction is not possible; exposure is.
- **The permit replaces an earlier, larger allowance** — `MerchantPaymentProcessor.payWithPermit` · seen in 1/2 runs · NEW — Code smells: permit is called even when the current allowance is already enough. — `payWithPermit` sets the allowance to `intent.amount`, so an approval the customer gave earlier for another intent is lowered. The effect is a failed later payment, not a loss of tokens.
- **A token blocklist on the payer makes every refund revert** — `MerchantPaymentProcessor.refund` · seen in 2/2 runs · NEW — Code smells: `safeTransferFrom(msg.sender, rec.payer, amount)` with no alternate recipient. — `refund` sends tokens straight to `rec.payer`, so a token that blocks that address makes the refund fail. We did not confirm that MUSD has a blocklist.
- **After setPayout, the old payout wallet cannot refund** — `MerchantPaymentProcessor.refund` · seen in 2/2 runs · NEW — Code smells: `msg.sender != m.owner && msg.sender != m.payout`. — `refund` checks the current `m.payout`, so the wallet that received the payment loses refund rights after a payout change. The owner can still refund.
- **Anyone can register a merchant with any payout and any signer** — `MerchantPaymentProcessor.registerMerchant` · seen in 2/2 runs · NEW — Code smells: no consent from `initialSigner`; no identity data on-chain. — `registerMerchant` accepts any payout and any `initialSigner`, so an attacker gets a merchant id for the paymentId collision above. The contract stores no merchant identity.

---

> ⚠️ This review was performed by an AI assistant. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended. For a consultation regarding your projects' security, visit [https://www.pashov.com](https://www.pashov.com)
