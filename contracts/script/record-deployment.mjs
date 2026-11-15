// Fills deployments/<chainId>.json with the processor's real deploy block and tx hash from the forge broadcast
// receipts. Run from contracts/ after `forge script script/Deploy.s.sol ... --broadcast`:
//   node script/record-deployment.mjs <chainId>
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const chainId = process.argv[2];
if (!chainId) {
  console.error("usage: node script/record-deployment.mjs <chainId>");
  process.exit(1);
}
const depPath = `deployments/${chainId}.json`;
const runPath = `broadcast/Deploy.s.sol/${chainId}/run-latest.json`;
if (!existsSync(depPath) || !existsSync(runPath)) {
  console.error(`missing ${depPath} or ${runPath}`);
  process.exit(1);
}
const dep = JSON.parse(readFileSync(depPath, "utf8"));
const run = JSON.parse(readFileSync(runPath, "utf8"));
const receipts = new Map((run.receipts ?? []).map((r) => [r.transactionHash.toLowerCase(), r]));
const tx = run.transactions.find((t) => t.contractName === "MerchantPaymentProcessor" && t.transactionType === "CREATE");
const receipt = tx?.hash && receipts.get(tx.hash.toLowerCase());
if (!tx || !receipt || Number(BigInt(receipt.status)) !== 1) {
  console.error("no successful MerchantPaymentProcessor CREATE receipt in", runPath);
  process.exit(1);
}
if (tx.contractAddress.toLowerCase() !== dep.processor.toLowerCase()) {
  console.error(`address mismatch: broadcast ${tx.contractAddress} vs ${dep.processor}`);
  process.exit(1);
}
dep.deployBlock = Number(BigInt(receipt.blockNumber));
dep.txHash = tx.hash;
writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
console.log(`updated ${depPath}: deployBlock=${dep.deployBlock}, txHash=${dep.txHash}`);
