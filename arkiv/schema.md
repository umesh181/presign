# Arkiv schema

> Required by the track. Fill in as the build progresses. Source of truth: `packages/core/src/schemas.ts`.

- **Network:** Rabdi testnet (chain 7794095), `@arkiv-network/sdk` 1.0.x
- **Publisher (owner/creator) wallet:** `TODO`. Readers only trust entities with `$creator` = this address.

| Schema | One entity per | Indexed (queried) fields | Expiry | Flags |
|---|---|---|---|---|
| `presign.descriptor.v1` | (chainId, contract address) | chainId, address, descriptorHash, attested, status, importedAt, sourceCommit | 7 days, extended by keeper | `permissionlessExtension` (TBD) |
| `presign.delegate.v1` | (chainId, delegate address) | chainId, address, codeHash, vendor, status, importedAt | 7 days, extended by keeper | `permissionlessExtension` (TBD) |
| `presign.change.v1` | detected change | kind, changeType, chainId, address, detectedAt | TBD | `readonly` |
| `presign.alert.v1` | watchtower alert | alertType, chainId, delegate, detectedAt | 7 days | `readonly` |

## Example query

```
TODO: paste one runnable query here (also in README)
```
