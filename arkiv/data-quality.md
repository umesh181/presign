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
