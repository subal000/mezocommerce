# Contracts notes (MerchantPaymentProcessor)

> **Not audited.** Internal review + tests only. Testnet use.

Source: `contracts/src/MerchantPaymentProcessor.sol` implements the frozen
`contracts/src/interfaces/IMerchantPaymentProcessor.sol` (Ownable2Step, Pausable, ReentrancyGuard,
EIP712("MezoCommerce", "1"), SafeERC20, ECDSA). Merchant ids start at 1. The contract never holds tokens.

## Build, test, ABI

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge build
forge test              # 104 tests: unit, table, fuzz (512 runs), invariant (128 runs x depth 128)
forge test --gas-report
forge fmt --check
cd .. && node scripts/export-abi.mjs   # = npm run abi; regenerates lib/chain/abis.ts (processorAbi + erc20Abi)
```

`export-abi.mjs` fails if the implementation is missing any frozen-interface function/event/error (same
signature, indexing, mutability, return types). The exported `processorAbi` is the implementation ABI, a superset
of the interface: it also has `owner`, `pendingOwner`, `transferOwnership`, `acceptOwnership`, `renounceOwnership`,
`paused`, `eip712Domain`, `INTENT_TYPEHASH` and OZ errors
(`EnforcedPause`, `OwnableUnauthorizedAccount`, `ReentrancyGuardReentrantCall`, `SafeERC20FailedOperation`, …)
plus `InvalidPayout()` and `RenounceDisabled()`.

## Deploy (Mezo testnet, chain 31611)

`contracts/.env` (copy `contracts/.env.example`; forge loads it automatically — leave unused vars commented out,
an empty `VAR=` fails to parse). The deployer becomes the Ownable2Step owner unless `OWNER_ADDRESS` is set.

With a raw key (`DEPLOYER_PRIVATE_KEY` in `contracts/.env`):

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy --slow
node script/record-deployment.mjs 31611
```

With the `deployer` keystore (no key in `.env`):

```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy --slow \
  --account deployer --sender 0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2
node script/record-deployment.mjs 31611
```

The script requires code at `MUSD_ADDRESS` (default `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`), deploys the
processor with MUSD supported and writes `contracts/deployments/31611.json`
`{chainId, processor, musd, owner, deployer, deployBlock}`. `record-deployment.mjs` then replaces `deployBlock` with
the receipt block of the processor CREATE and adds `txHash`. Copy into the app env:
`NEXT_PUBLIC_PROCESSOR_ADDRESS=<processor>`, `NEXT_PUBLIC_DEPLOY_BLOCK=<deployBlock>`.

Optional helper — register a merchant from a script (owner = broadcaster):

```bash
INITIAL_SIGNER=<platform signer address> PAYOUT_ADDRESS=<payout> \
forge script script/RegisterMerchant.s.sol --rpc-url mezo_testnet --broadcast --legacy \
  --account <merchant keystore> --sender <merchant address>
```

Local anvil: `DEPLOY_MOCK_MUSD=true` deploys a `MockMUSD` (chain 31337 only). Both scripts were dry-run against a
throwaway local anvil; nothing was sent to testnet.

## Gas (forge gas-report, optimizer 200 runs)

| Call | Gas |
|---|---|
| `pay` (first payment to a fresh payout wallet) | 218,018 |
| `pay` (median across the suite, warm payout wallet) | ~195,000 |
| `payWithPermit` (no prior allowance, permit + pay) | 252,083 |
| `refund` (partial) | 64,242 |
| `cancelPayment` | 71,139 |
| `registerMerchant` (with initial signer) | 115,074 |
| `checkPayment` (view) | 3k–32k |
| Deployment | 2,195,664 (11,128 bytes) |

Most of `pay` is storage: the `PaymentRecord` (frozen 5-slot layout, 4 fresh slots), the state slot and the
token's balance/allowance writes.

## Behaviour decisions (interface ambiguities resolved)

- **All intent state is scoped per merchant.** Paid/cancelled state and the `PaymentRecord` are keyed by
  `(merchantId, paymentId)`: `intentState(merchantId, id)`, `payment(merchantId, id)`,
  `refund(merchantId, id, amount)`, `cancelPayment(merchantId, id)`. Reason: `registerMerchant` is open to anyone and
  paymentIds are public (checkout URL, mempool). With a global key, anyone could register a merchant for gas and pay
  (for 1 wei, to themselves) or cancel a customer's paymentId first, so the real payment reverted forever. This was
  the one finding of the 2026-11-12 Pashov solidity-auditor scan (`docs/audits/`). Consequences:
  - Another merchant's pay or cancel of the same id never changes this merchant's state.
  - The indexer must still apply `PaymentCompleted` / `PaymentCancelled` only when `merchantId` equals the intent's
    merchant (it is indexed).
  - Cancelling an id that is already `Paid` reverts `IntentAlreadyPaid`; a second cancel reverts `IntentCancelled`.
- **Payout cannot be a supported token** (`InvalidPayout`) at register/setPayout, and `pay` reverts if a token was
  allowlisted after a merchant set it as payout. Tokens sent to a token contract can't be recovered.
- **`payWithPermit` skips the permit** when the payer's allowance already covers the amount, so a larger standing
  approval is not overwritten.
- **`renounceOwnership` is disabled** (`RenounceDisabled`): without an owner, pause and the token allowlist would be
  gone for good.
- **Cancel authorisation:** merchant owner or a currently allowed signer of that merchant. The payout wallet and the
  admin cannot cancel. Works while paused and while the merchant is inactive.
- **Refund authorisation:** merchant owner or the merchant's *current* payout (after `setPayout`, the old payout
  can no longer refund). Recipient is always the recorded payer (`msg.sender` of the pay call). Works while paused
  and while the merchant is inactive. `amount == 0` → `InvalidAmount`; unpaid/cancelled id → `NotPaid`.
- **Payout validation:** `registerMerchant`/`setPayout` reject `address(0)` (`ZeroAddress`) and the processor itself
  (extra error `InvalidPayout()` — the contract would never hold tokens).
- **`registerMerchant` is not paused**; `pause` blocks only `pay`/`payWithPermit` as specified.
- **Signatures:** `ECDSA.tryRecover` (65-byte only; EIP-2098 64-byte sigs, high-s and bad v are rejected) and every
  failure maps to `BadSignature`, in both `pay` and `checkPayment`.
- **`payWithPermit`:** the permit is for exactly `intent.amount`, owner = `msg.sender`, wrapped in try/catch and only
  attempted for supported tokens (an unsupported token falls through to `UnsupportedToken`).
- **`checkPayment` order:** Paused, InvalidAmount, UnsupportedToken, UnknownMerchant, MerchantInactive,
  PayoutMismatch, AlreadyPaid, Cancelled, Expired, WrongPayer, BadSignature, InsufficientBalance,
  InsufficientAllowance. `pay` checks in the same order. Token reads use `staticcall` (a reverting/no-code token
  reads as 0 → `InsufficientBalance`; never reverts). The allowance check doesn't know about permit: a checkout that
  will call `payWithPermit` should treat `InsufficientAllowance` as Ok. `payerAddr = 0` with no wallet connected
  returns `InsufficientBalance` for an otherwise valid intent.
- **Expiry:** `block.timestamp == expiresAt` is payable; `expiresAt + 1` reverts `IntentExpired`.
- **Amount:** `0 < amount <= type(uint128).max`; transferred exactly (no fees). The event `amount` is the signed amount.

## Threats and how they are handled

| Threat | Handling | Test(s) |
|---|---|---|
| Double payment / replay of a paid intent | `intentState(merchantId, id)` set to `Paid` before the transfer (CEI) + `nonReentrant`; any later pay of the id for that merchant reverts `IntentAlreadyPaid` | `test_pay_duplicateId_reverts`, `test_pay_sameIdDifferentAmount_reverts` |
| Another merchant squats a public paymentId (pays or cancels it first) | State is keyed by `(merchantId, paymentId)`, so it only touches the squatter's own namespace | `test_crossMerchantSquat_doesNotBlock`, `test_crossMerchantCancel_doesNotBlock`, `test_refund_wrongMerchant_notPaid` |
| Payout set to a token contract (funds unrecoverable) | `_checkPayout` rejects supported tokens; `pay` rejects `payout == token` | `test_tokenAsPayout_rejected`, `test_tokenAllowlistedAfterPayoutSet_payReverts` |
| Cross-contract / cross-chain replay | EIP-712 domain binds chainId + verifyingContract | `test_pay_crossContractReplay_reverts`, `test_pay_crossChainReplay_reverts` |
| Tampering with amount / id / expiry / payer / merchant | All fields are in the signed struct; any change → `BadSignature` | `test_pay_tamperedAmount_badSignature`, `test_pay_tamperedFields_badSignature` |
| Stolen platform signer key redirects funds | `intent.payout` must equal the on-chain payout set only by the merchant owner | `test_pay_signedWrongPayout_reverts`, `test_pay_payoutMismatchAfterSetPayout_reverts` |
| Revoked / foreign signer | `isSigner(merchantId, recovered)` checked at pay time | `test_pay_revokedSigner_reverts`, `test_pay_otherMerchantsSigner_reverts`, `test_pay_nonSigner_reverts` |
| Signature malleability / malformed sigs | OZ `tryRecover` rejects high-s, bad v, wrong length | `test_pay_malformedSignatures_revert` |
| Expired intent paid late | `block.timestamp > expiresAt` → `IntentExpired` (validator skew of seconds accepted) | `test_pay_atExpiresAt_ok`, `test_pay_oneSecondAfterExpiry_reverts`, `testFuzz_pay_expiry` |
| Paying someone else's locked intent | `payer != 0 && payer != msg.sender` → `WrongPayer` | `test_pay_wrongPayer_reverts` |
| Reentrancy via a malicious token | `nonReentrant` on pay/payWithPermit/refund; state written before the external call | `test_pay_reentrancyIntoPay_blocked`, `test_refund_reentrancyIntoRefund_blocked` |
| Non-standard tokens (false return, fee-on-transfer) | SafeERC20 reverts on false; only allowlisted tokens (MUSD). Fee-on-transfer would debit the payer exactly `amount` but deliver less — such tokens must not be allowlisted | `test_pay_returnsFalseToken_reverts`, `test_pay_feeOnTransfer_exactDebitSemantics` |
| Permit front-run griefing | Permit in try/catch; the front-runner's permit already set the allowance | `test_payWithPermit_frontRunPermit_stillSucceeds` |
| Unlimited approvals | Permit/approve for the exact amount; allowance ends at 0 | `test_pay_movesExactAmountToPayout`, `test_payWithPermit_noPriorApproval` |
| Over-refund | Cumulative `refunded + amount <= amount` on-chain → `RefundExceedsPayment` | `test_refund_*`, `testFuzz_refund_neverExceedsPayment`, invariant |
| Refund redirected / by the wrong party | No recipient parameter (always the recorded payer); only owner or current payout | `test_refund_alwaysGoesToOriginalPayer`, `test_refund_wrongCaller_reverts` |
| Cancel griefing by another merchant | Cancel scoped per merchant (see above) | `test_pay_cancelByOtherMerchant_doesNotBlock`, `test_cancel_afterForeignCancel_stillPossible` |
| Admin abuse | Admin can only allowlist tokens and pause new payments; cannot move funds, edit merchants, cancel or refund; Ownable2Step | `test_adminCannotManageMerchants`, `test_admin_onlyOwner`, `test_ownable2Step`, `test_cancel_adminIsNotAuthorized` |
| Pause trapping users | Pause blocks only pay/payWithPermit; refunds, cancels and merchant management stay open | `test_pause_blocksPayButNotRefundOrCancel`, `test_register_allowedWhilePaused` |
| Funds stuck in the processor | Transfers go payer → payout and merchant → payer directly; payout cannot be the processor | invariant `processorNeverHoldsTokens`, `test_register_badPayout_reverts` |
| Preflight DoS (`checkPayment` reverting) | `staticcall` reads, `tryRecover`, no reverting paths | `test_checkPayment_neverRevertsOnHostileToken`, `test_checkPayment_table` |

Known limitations (accepted): direct ERC-20 transfers to a payout wallet that bypass the contract are not linked to
orders; a merchant who loses its owner key cannot rotate payout/signers (no merchant ownership transfer in the frozen
interface); a malicious *allowed* signer of a merchant can sign intents for that merchant's own payout only (funds
still go to the merchant), and can cancel that merchant's unpaid intents.

## Test inventory (97)

`test/Pay.t.sol` (36), `Permit.t.sol` (7), `Cancel.t.sol` (13), `Refund.t.sol` (12), `Admin.t.sol` (16),
`CheckPayment.t.sol` (5, incl. a table test covering every `PayCheck` value and the priority order),
`Fuzz.t.sol` (5), `invariant/Invariant.t.sol` (2 invariants + 1 handler sanity test). Mocks: `MockMUSD`
(ERC20 + permit, 18 dec), `ReturnsFalseToken`, `FeeOnTransferToken`, `ReentrantToken`, `RevertingViewsToken`.
