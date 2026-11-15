# Resolution — Pashov solidity-auditor scan, 2026-11-12

Scan: `solidity-auditor` v4.1 (github.com/pashov/skills), 2 passes × 12 agents on Claude Haiku, commit `93392c4`.
Report: `2026-11-12-pashov-solidity-auditor.md`. AI review, not a firm audit.

| # | Item | Status | Change |
|---|---|---|---|
| F1 | A registered merchant can mark another merchant's paymentId as paid | **Fixed** | Intent state and `PaymentRecord` keyed by `(merchantId, paymentId)`. `intentState`, `payment`, `refund` take `merchantId`; `isCancelledBy` removed. Option B in the report (bind id to first merchant) would not fix it: the squatter would still be first. Tests: `AuditFixes.t.sol` |
| L | Token contract as payout | **Fixed** | `_checkPayout` rejects supported tokens; `pay`/`checkPayment` reject `payout == token` |
| L | intentState shows Cancelled / Paid for another merchant | **Fixed** | Same root cause as F1 |
| L | Any paymentId accepted without merchant binding | **Fixed** | Same root cause as F1 |
| L | Permit replaces a larger standing allowance | **Fixed** | `payWithPermit` skips the permit when allowance already covers the amount |
| L | Deploy script uses testnet MUSD on any chain | **Fixed** | Default only on chain 31611; elsewhere `MUSD_ADDRESS` is required |
| L | Script falls back to forge's default sender | **Fixed** | `Deploy` and `RegisterMerchant` revert on the keyless default sender |
| (pass 2, rejected as admin-only) | Owner can renounce ownership | **Fixed anyway** | `renounceOwnership` reverts `RenounceDisabled` |
| L | Observer pays an open intent first | Accepted | Merchant is paid in full; customer's tx reverts, no funds lost. Open intents are needed because the payer wallet is unknown when the link is made |
| L | Intent with no expiry cap | Accepted | Backend sets `expiresAt` (default 30 min); merchants can cancel or revoke the signer |
| L | Old payout loses refund rights after `setPayout` | Accepted | Owner can always refund |
| L | Token blocklist on payer blocks refunds | Accepted | MUSD has no blocklist we know of; refund off-chain if needed |
| L | Anyone can register a merchant | Accepted | By design; the backend signs only for merchants in its own DB |
