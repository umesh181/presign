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

- **Publisher wallet:** `TODO`
- **Network:** Rabdi testnet, chain 7794095
- **Example query:** `TODO`
- **Schema:** [arkiv/schema.md](arkiv/schema.md)

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
