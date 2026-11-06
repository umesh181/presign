# PreSign

**Verified pre-signing checks, mirrored on Arkiv.**

PreSign puts the two lists every signer should check onto [Arkiv](https://arkiv.network):

1. **ERC-7730 clear-signing descriptors**: turn transaction hex into plain English. Mirrored from the Ethereum Foundation registry.
2. **A trusted EIP-7702 delegate allowlist**: official delegate contracts published by wallet vendors (MetaMask, Coinbase, Uniswap, OKX, ZeroDev, Alchemy), with on-chain code fingerprints.

Before anything is signed, `check()` answers *"what does this do?"* and *"who am I handing my account to?"*, and returns `trusted`, `blocked` or `unknown`. Every entry is verified against tampering, and trust expires unless it is re-confirmed.

> Built at ETHGlobal Mumbai 2026 for the Arkiv track *"Mirror something Ethereum depends on"*.

## Status

🚧 Work in progress (hackathon build).

## Repo layout

| Path | What |
|---|---|
| `packages/core` | Shared library: Arkiv schemas + reader, fingerprints, `check()`, ERC-7730 formatter |
| `packages/importer` | Re-runnable importers: descriptors (EF registry) and delegates (`sources/delegates.json`) |
| `packages/keeper` | Daily re-sync: extend unchanged entries, let removed ones expire, write change records |
| `packages/watchtower` | Live mainnet scanner for EIP-7702 delegations and burst alerts |
| `packages/guard` | Signer Guard: refuses to sign when `check()` says blocked |
| `apps/web` | Demo UI: About to Sign, Binance Time Machine, Live Watchtower, Registry Explorer |
| `sources/` | Vendor delegate sources (official repos only) |
| `fixtures/` | Read-only demo inputs (Binance replay, …) |
| `arkiv/` | Required judging docs |

## Setup

```bash
nvm use            # Node 22+
npm install
cp .env.example .env   # fill in keys (testnet only!)
npm test
npm run web        # demo UI on http://localhost:5173
```

Get an Arkiv access key at https://hub.arkiv.network/access-keys and testnet tGLM at https://hub.arkiv.network/faucet.

## Scripts

| Command | What |
|---|---|
| `npm run import:descriptors` | Import the clear-signing registry at `REGISTRY_COMMIT` |
| `npm run import:delegates` | Import vendor delegates |
| `npm run keeper` | Re-sync and extend expiry |
| `npm run watchtower` | Start the mainnet watcher |
| `npm run typecheck` / `npm test` | Checks (also run in CI) |

## Arkiv details (required)

- **Network:** Rabdi testnet (chain 7794095), `@arkiv-network/sdk` 1.0.1
- **Publisher wallet (writes every PreSign entity):** [`0x1784A22855d5E482112F94d2169c28bC7e6aF885`](https://rabdi.explorer.arkiv.network/address/0x1784A22855d5E482112F94d2169c28bC7e6aF885)
- **Schema:** [arkiv/schema.md](arkiv/schema.md)

**What's on Arkiv now** (counted with `arkiv_query`):

| Dataset | Entities | Source |
|---|---|---|
| ERC-7730 clear-signing descriptors | **1,917** (one per chainId + contract, 143 chains, 614 descriptor files) | EF registry @ `ef582c2f03bfbd062b7e3889b55dd3b45c3d5494` |
| …of which attested by an auditor (Cyfrin, signature verified) | **201** | `registry/*/sigs/*.json` |

### Run one query yourself (no API key, no PreSign server)

Fetch the clear-signing descriptor for the Uniswap V3 SwapRouter on Ethereum, trusting only entities created by our publisher wallet:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network --json @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('presign.descriptor.v1') AND chainId = u64(1) AND address = addr(0xE592427A0AEce92De3Edee1F18E0157C05861564) AND $creator = addr(0x1784A22855d5E482112F94d2169c28bC7e6aF885)",
  {"select":{"key":true,"expiresAt":true,"attributes":{"protocolOwner":true,"descriptorHash":true,"attested":true,"sourcePath":true,"sourceCommit":true}}}]}
EOF
```

It returns entity [`0x76028dc5…9572`](https://rabdi.explorer.arkiv.network/entity/0x76028dc5a3cb1ad09b0946f175a541e6f262c6903eb86ed667860dc8eb9d9572) with owner `Uniswap Labs`, its fingerprint, and the exact registry file and commit it came from. Add `"descriptor":true` to `attributes` to get the full descriptor JSON (gzip-compressed).

**EIP-7702 trusted delegates:** **41** entities: 6 vendors (MetaMask, Coinbase, Uniswap, OKX, ZeroDev, Alchemy) across 7 chains, each with its per-chain code hash. Query them with `arkiv.schema = str('presign.delegate.v1') AND $creator = addr(0x1784A22855d5E482112F94d2169c28bC7e6aF885)`.

### Signer Guard demo (real EIP-7702 transactions on Sepolia)

```bash
npm run guard:demo
```

1. Delegate the test wallet to MetaMask's official delegator → ✅ trusted → real type-4 tx on Sepolia
2. Delegate to a contract deployed seconds ago (harmless, returns 42) → 🛑 refused, nothing signed
3. The real Binance delegation (mainnet tx `0xad99…298b`, read-only, 50 authorizations) → 🛑 refused
4. Revoke the delegation → ✅ trusted → wallet restored to a plain EOA

### Reproduce the import

```bash
npm run verify:registry                  # fingerprints vs auditor attestations (166/169 match)
npm run import:descriptors               # dry run: build + validate all entities
npm run import:descriptors -- --write    # write to Arkiv; re-running writes nothing new
npm run import:delegates -- --write      # vendor delegates (address proven in vendor file + per-chain code)
```

## Data sources and licenses

| Data | Source | License |
|---|---|---|
| Clear-signing descriptors | [ethereum/clear-signing-erc7730-registry](https://github.com/ethereum/clear-signing-erc7730-registry) | [CC0-1.0](https://github.com/ethereum/clear-signing-erc7730-registry/blob/master/LICENSE.md) |
| EIP-7702 delegates | Vendor repos listed in [`sources/delegates.json`](sources/delegates.json) | Per vendor (MIT / Apache-2.0 / GPL-3.0) |

No Sourcify data, APIs or CDNs are used.

## How AI was used

TODO: describe which parts were written or assisted by AI tools (e.g. Claude Code) and how they were reviewed.

## License

[MIT](LICENSE)
