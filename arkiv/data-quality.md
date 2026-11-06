# Data quality

> Judged (25%). Complete, current, filterable the way people search?

TODO:
- Registry commit imported, counts (descriptors / deployments), coverage by chain.
- Fingerprint method (ERC-8176: includes resolved -> JCS -> keccak256) and attestation match rate.
- Delegate sources (sources/delegates.json), licenses, per-chain code verification, skipped chains.
- Known conflicts (e.g. eth-infinitism Simple7702Account has two published addresses; excluded).
- How the keeper keeps it fresh; how to filter (chainId + address).

## Verified so far

**Fingerprint check against auditor attestations** (`npm run verify:registry`, registry commit `ef582c2f03bfbd062b7e3889b55dd3b45c3d5494`, 2026-11-06):

- Snapshot: 1,957 files; 1,917 calldata deployments across 143 chains, from 614 descriptor files.
- 169 ERC-8176 attestation files. **All 169 signatures recover to Cyfrin's published key** (`0x3846…31f6`).
- **166 / 169 hashes match** our fingerprint (resolve `includes` with the registry's own rules, then JCS, then keccak256). This includes descriptors that use `includes`.
- 3 attestations no longer match their current descriptor. These files appear to have changed after they were attested, and the sig files weren't removed or listed in `auditors/dropped-attestations.md`:
  - `registry/safe/calldata-SafeMigration-1.5.0.json`
  - `registry/safe/eip712-Safe-Multisig.json`
  - `registry/walletconnect/calldata-wct.json`

  PreSign imports these with `attested = false`. Stale trust is exactly what we're built to catch.

**EIP-7702 delegate allowlist** (`npm run import:delegates`, 2026-11-06): 41 entities, 6 vendors, 7 chains (1, 10, 56, 137, 8453, 42161, 11155111).

- Each vendor's address is **proven present** in its official source file at the file's latest commit (GitHub API + raw file), not assumed.
- **Stale source caught:** OKX changed its published `SmartWalletEntry` on 2026-10-09 (`okxlabs/okx-smart-wallet-evm@455dba8`). The importer refused our old address (`0xe40c…6fA4`) as "no longer listed"; after review we switched to the current `0xcEF0…4743`.
- **Same contract across chains:** a chain is accepted only if its code equals mainnet's, or differs only in chain-specific immutables (same length, ≤64 differing bytes). MetaMask's and ZeroDev's delegators differ per chain in exactly 35 bytes: the chain id and the cached EIP-712 domain separator. Each chain stores its own exact `codeHash`, and `check()` compares live code against it.
- OKX has no deployment on Sepolia, so it has 6 chains, not 7.

## Known coverage gaps

- **Uniswap Universal Router:** the EF registry has no descriptor for it at our pinned commit, and it's what app.uniswap.org uses today. PreSign correctly reports those swaps as `unknown` (no verified translation). Older Uniswap routers (V2Router02, V3 SwapRouter, SwapRouter02) are covered.
- **EIP-712 descriptors** (133 files) are not mirrored yet. Only calldata descriptors are.
