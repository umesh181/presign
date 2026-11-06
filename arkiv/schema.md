# Arkiv schema

Source of truth: [`packages/core/src/schemas.ts`](../packages/core/src/schemas.ts).

- **Network:** Rabdi testnet (chain 7794095), `@arkiv-network/sdk` 1.0.1 (schema-based entities)
- **Owner / creator of every entity:** publisher wallet [`0x1784A22855d5E482112F94d2169c28bC7e6aF885`](https://rabdi.explorer.arkiv.network/address/0x1784A22855d5E482112F94d2169c28bC7e6aF885)
- **Trust rule:** the schema name (`arkiv.schema`) is a tag anyone can write, so every PreSign read also filters on `$creator = <publisher>`.

## Overview

| Schema (`arkiv.schema`) | One entity per | Status | Expiry | Flags |
|---|---|---|---|---|
| `presign.descriptor.v1` | (chainId, contract address) | **Live: 1,917 entities** | 7 days from write; the keeper re-extends while the source still matches | `permissionlessExtension` |
| `presign.delegate.v1` | (chainId, EIP-7702 delegate address) | **Live: 41 entities** | 7 days, keeper-extended | `permissionlessExtension` |
| `presign.change.v1` | detected change to a trusted entry | **Live**, written by the keeper (none yet for the real publisher: sources unchanged since import) | 90 days | `readonly` + `permissionlessExtension` |
| `presign.radar.v1` | (chainId, EIP-7702 delegate seen on-chain or vendor-listed) | **Live**, written by the Watchtower | 7 days, re-extended while watched | `permissionlessExtension` |
| `presign.badfamily.v1` | known drainer **code family** (`sources/known-bad.json`, published research) | **Live: 16 families** from 28 contracts | 30 days | `permissionlessExtension` |
| `presign.alert.v1` | Watchtower alert: `logicChanged` or `knownBadFamily` | **Live**, written by the Watchtower | 30 days | `readonly` + `permissionlessExtension` |

**Why these flags:** with `permissionlessExtension`, anyone can keep an entry alive if we stop running the keeper, but only the publisher can change its content. With `readonly`, history can never be rewritten.

## `presign.descriptor.v1`

One ERC-7730 calldata descriptor bound to one deployment. Built from `index.calldata.json` of the EF registry; `includes` are resolved with the registry's own rules.

| Column | Type | Indexed | Example | Notes |
|---|---|---|---|---|
| `chainId` | u64 | ✅ | `1` | EIP-155 chain id |
| `address` | addr | ✅ | `0xE592…1564` | Contract the descriptor covers |
| `descriptorHash` | str | ✅ | `0x2988…17cb` | ERC-8176: keccak256(JCS(resolved descriptor)) |
| `attested` | bool | ✅ | `true` | A trusted auditor's EAS attestation (signer recovered and checked) carries exactly this hash |
| `status` | str | ✅ | `active` | `active`, `superseded` or `removed`. A positive value, because the query language has no `!=` |
| `importedAt` | u64 | ✅ | `1793938677` | Unix seconds (here 2026-11-06 04:17:57 UTC) |
| `sourceCommit` | str | ✅ | `ef582c2f…` | Pinned registry commit |
| `protocolOwner` | str | | `Uniswap Labs` | `metadata.owner` (≤128 bytes) |
| `sourceRepo` | str | | `ethereum/clear-signing-erc7730-registry` | Provenance |
| `sourcePath` | str | | `registry/uniswap/calldata-UniswapV3SwapRouter.json` | Provenance |
| `swarmRef` | str | | — | Optional, for the Swarm add-on |
| `descriptor` | bytes | | gzip(JSON) | Resolved descriptor, gzip-compressed: median 1 KB, max 11.9 KB (raw max 175 KB > the 128 KiB limit) |

**Queried fields:** `chainId` + `address` (+ `status`), filtered by `$creator`. Readers recompute `descriptorHash` client-side from the stored JSON before trusting it.

## `presign.delegate.v1`

| Column | Type | Indexed | Notes |
|---|---|---|---|
| `chainId` | u64 | ✅ | |
| `address` | addr | ✅ | Delegate (implementation) contract |
| `codeHash` | str | ✅ | keccak256 of the runtime bytecode (`eth_getCode`) at import time; re-checked live by `check()` |
| `vendor` | str | ✅ | e.g. `MetaMask` |
| `status` | str | ✅ | `active` / `superseded` |
| `importedAt` | u64 | ✅ | |
| `contractName`, `version` | str | | |
| `sourceType`, `sourceRepo`, `sourcePath`, `sourceCommit` | str | | Official vendor source (see `sources/delegates.json`) |

## `presign.change.v1`

See `packages/core/src/schemas.ts`. Change records (`added`, `modified`, `removed`, `codeHashMismatch`, `newCandidate`) are the public history: Rabdi has no historical queries, and expiry emits no event.

## Delegation Radar: `presign.radar.v1`, `presign.badfamily.v1`, `presign.alert.v1`

Evidence, not verdicts: `check()` turns these into a verdict at signing time (`packages/core/src/check.ts`).

**`presign.radar.v1`** (one per delegate contract per chain)

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `chainId`, `address` | u64, addr | ✅ | The delegate contract |
| `status` | str | ✅ | `active` |
| `family` | str | ✅ | Code family: keccak256 of the runtime code with metadata stripped and every 20/32-byte constant blanked (`core/src/bytecode.ts`). Clones that only differ in a hardcoded address share it |
| `knownBad` | str | ✅ | Label of the matching `presign.badfamily.v1`, or `none` |
| `upgradeable` | bool | ✅ | Uses DELEGATECALL **and** depends on an EIP-1967 proxy or a beacon (`implementation()` + `upgradeTo()`) that someone else can change |
| `vendor` | str | ✅ | Vendor whose official list includes it (from `presign.delegate.v1`), or `none` |
| `firstSeenAt` | u64 | ✅ | When the Watchtower first saw it (unix) |
| `accounts` | u64 | ✅ | Signing accounts seen delegating to it (recovered from each authorization) |
| `codeHash`, `logicHash` | str | | `logicHash` = keccak of the code **plus every dependency's current implementation**: it changes when the logic is swapped |
| `codeSize`, `delegatecall`, `upgradeableVia`, `firstSeenBlock`, `lastSeenBlock`, `authorizations`, `checkedAt` | | | |
| `deps` | bytes | | JSON: each hardcoded dependency, its code hash and current implementation |

**`presign.badfamily.v1`**: `family` (indexed), `label` (indexed), `exampleChainId`, `exampleAddress`, `source` (URL of the research), `status`.

**`presign.alert.v1`** (readonly): `alertType` (`logicChanged` | `knownBadFamily`), `chainId`, `delegate`, `detectedAt` (all indexed), `blockNumber`, `oldHash`, `newHash`, `message` (one sentence for wallets).

## Example query

See [README → Run one query yourself](../README.md#run-one-query-yourself-no-api-key-no-presign-server).
