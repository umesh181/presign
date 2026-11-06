# Data quality

> Judged (25%). Complete, current, filterable the way people search?

## Summary

| Question | Answer |
|---|---|
| **Complete?** | All **1,917** calldata deployments in the EF registry's `index.calldata.json` (614 descriptor files, **143 chains**) at a pinned commit, `includes` resolved. Plus an EIP-7702 allowlist of **41** entries: 6 vendors × 7 chains (OKX isn't deployed on Sepolia). Not yet mirrored: EIP-712 descriptors (see gaps below) |
| **Correct?** | Every descriptor carries its ERC-8176 fingerprint, which readers recompute client-side. **166/169** auditor attestations match (signer recovered = Cyfrin). Every delegate address is proven present in the vendor's own file, with each chain's exact code hash |
| **Current?** | Every entity expires in 7 days. The keeper re-reads the sources (latest registry commit, vendor files, on-chain code), extends what still matches, and immediately marks changed or removed entries, with a `readonly` `Change` record. Last run: 2026-11-06, all 1,958 entities matched and were extended |
| **Filterable the way people search?** | Signers look up "this contract on this chain": indexed `chainId` + `address` + `status` (+ `attested`, `vendor`, `codeHash`, `sourceCommit`), always pinned to `$creator = publisher`. One query, no API key (see README) |
| **Provenance?** | Every entity stores source repo, path, commit and import time |

**Excluded on purpose (see `sources/delegates.json` research):** Ambire's delegate (its repo has no license, so we can't republish); eth-infinitism `Simple7702Account` (two different addresses published in different places, so neither is trusted until they agree); vendors with no published address (Safe, Thirdweb, Porto, Pimlico, …).

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

## Freshness: the keeper

**Real publisher, 2026-11-06:** the sources were unchanged (registry still at `ef582c2`, all vendor files and code still matching), so the keeper extended all **1,958** entities (1,917 descriptors + 41 delegates) by 7 days in 11 transactions for **0.043 tGLM**. Read-back: "1917 active, expiry in 7.00 days, matches sources exactly" and "41 active, expiry in 7.00 days, matches sources exactly".

**Live change test** (throwaway publisher `0xfA4D462E573B30f1B35dDEF3654879EF084e7447`, so real data is untouched; delegates only):

| Step | Simulated event | Keeper result | Verified |
|---|---|---|---|
| A | First run | added 41 | 41 active, match sources |
| B | Vendor drops Alchemy from its list | removed 7 (marked `removed` immediately), extended 34 | `check()` now **blocks** Alchemy and still trusts MetaMask |
| C | One stored code hash corrupted (Coinbase, chain 1) | modified 1: new correct entity, old one `superseded` | 34 active, match sources |
| D | Alchemy listed again | added 7 | 41 active, match sources |
| E | Re-run, nothing changed | extend 41, **0 changes** | idempotent |

The test produced 56 `Change` records (48 added, 7 removed, 1 modified), all `readonly`. Query them with `arkiv.schema = str('presign.change.v1') AND $creator = addr(0xfA4D462E573B30f1B35dDEF3654879EF084e7447)`.

## Reproducibility (from scratch)

On 2026-11-06 we re-ran the whole import the way an organizer would:

1. `git clone https://github.com/umesh181/presign` into an empty folder (no `.env` in the repo), then `npm ci`, `npm run typecheck` (0 errors) and `npm test` (32/32).
2. A **brand-new publisher wallet** (`0xb8d70b5a05B02B9F97E5c4011571491e7e856441`, funded with 0.7 tGLM) ran `npm run import:descriptors -- --write` (pinned `REGISTRY_COMMIT=ef582c2…`) and `npm run import:delegates -- --write`, configured only through environment variables.
3. A field-by-field comparison with the original publisher's active entities:

| Dataset | Original | Reproduced | Missing | Extra | Field differences |
|---|---|---|---|---|---|
| Descriptors (`descriptorHash, attested, protocolOwner, sourceRepo, sourcePath, sourceCommit`) | 1,917 | 1,917 | 0 | 0 | **0** |
| Delegates (`codeHash, vendor, contractName, sourceRepo, sourcePath, sourceCommit`) | 41 | 41 | 0 | 0 | **0** |

The network was flaky during the run (RPC and GitHub timeouts). It surfaced two fixes, now in the repo:
- read retries with back-off
- resume-safe writes: after an error, re-read Arkiv and continue

One failed attempt had actually landed 100 entities before its timeout. The resume skipped them, and the final count was exactly 1,917, with no duplicates.

The keeper then re-confirmed the original publisher's data: all 1,958 entities extended to 7.00 days, matching their sources exactly.
