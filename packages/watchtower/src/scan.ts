/**
 * Watchtower: watches Ethereum mainnet for new EIP-7702 delegations (type-4 txs).
 *
 * For each new block:
 * 1. getBlock({ includeTransactions: true }) and keep type "eip7702" txs.
 * 2. For each authorization: delegate address (+ recover authority).
 * 3. Allowlisted? -> count as trusted. Unknown -> count as unknown.
 * 4. Burst rule: a contract unseen before receiving N delegations in M minutes -> Alert.
 * 5. Write Alert entities to Arkiv with a short expiry (7 days).
 *
 * Only real numbers. "Unknown" != "malicious" (our allowlist is small).
 */
async function main() {
  console.log("TODO: watchtower scan");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
