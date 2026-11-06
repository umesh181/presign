# PreSign

**Verified pre-signing checks, mirrored on Arkiv.**

PreSign puts the two lists every signer should check onto [Arkiv](https://arkiv.network):

1. **ERC-7730 clear-signing descriptors**: turn transaction hex into plain English. Mirrored from the Ethereum Foundation registry.
2. **A trusted EIP-7702 delegate allowlist**: official delegate contracts published by wallet vendors (MetaMask, Coinbase, Uniswap, OKX, ZeroDev, Alchemy), with on-chain code fingerprints.

Before anything is signed, `check()` answers *"what does this do?"* and *"who am I handing my account to?"*, and returns `trusted`, `blocked` or `unknown`. Every entry is verified against tampering, and trust expires unless it is re-confirmed.

> Built at ETHGlobal Mumbai 2026 for the Arkiv track *"Mirror something Ethereum depends on"*.

## Status

Working on Arkiv's Rabdi testnet: **1,917** clear-signing descriptors and **41** EIP-7702 trusted delegates are live and kept fresh by the keeper. The checker, ERC-7730 formatter, Signer Guard (real Sepolia transactions) and web app all work. Hackathon build.

## Repo layout

| Path | What |
|---|---|
| `packages/core` | Shared library: Arkiv schemas + reader, fingerprints, `check()`, ERC-7730 formatter |
| `packages/importer` | Re-runnable importers: descriptors (EF registry) and delegates (`sources/delegates.json`) |
| `packages/keeper` | Daily re-sync: extend unchanged entries, let removed ones expire, write change records |
| `packages/watchtower` | Delegation Radar: observes EIP-7702 delegations, inspects each delegate, publishes evidence and alerts to Arkiv |
| `contracts/radar-demo` | Sepolia demo contracts for the Radar (beacon-backed delegate, harmless logic, drainer) |
| `packages/guard` | Signer Guard: refuses to sign when `check()` says blocked |
| `apps/web` | Web app: Check (before signing), Radar (delegate evidence + live alerts), Explorer |
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
| `npm run watchtower` | Delegation Radar: scan EIP-7702 delegations, publish evidence + alerts (`--write`, `--watch`, `--seed`) |
| `npm run radar:demo` | Live Sepolia demo: a delegate's logic is swapped to a drainer → alert on Arkiv → PreSign blocks |
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

### Run one query yourself (no PreSign server; key optional)

Fetch the clear-signing descriptor for the Uniswap V3 SwapRouter on Ethereum, trusting only entities created by our publisher wallet:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network --json @- <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":[
  "arkiv.schema = str('presign.descriptor.v1') AND chainId = u64(1) AND address = addr(0xE592427A0AEce92De3Edee1F18E0157C05861564) AND $creator = addr(0x1784A22855d5E482112F94d2169c28bC7e6aF885)",
  {"select":{"key":true,"expiresAt":true,"attributes":{"protocolOwner":true,"descriptorHash":true,"attested":true,"sourcePath":true,"sourceCommit":true}}}]}
EOF
```

Arkiv's public endpoint gives each IP a small anonymous query budget. If you see `ANON_COST_LIMITED`, add a free key from [hub.arkiv.network](https://hub.arkiv.network/access-keys): `curl -s -H "X-API-KEY: <key>" …`.

It returns entity [`0x76028dc5…9572`](https://rabdi.explorer.arkiv.network/entity/0x76028dc5a3cb1ad09b0946f175a541e6f262c6903eb86ed667860dc8eb9d9572) with owner `Uniswap Labs`, its fingerprint, and the exact registry file and commit it came from. Add `"descriptor":true` to `attributes` to get the full descriptor JSON (gzip-compressed).

**EIP-7702 trusted delegates:** **41** entities: 6 vendors (MetaMask, Coinbase, Uniswap, OKX, ZeroDev, Alchemy) across 7 chains, each with its per-chain code hash. Query them with `arkiv.schema = str('presign.delegate.v1') AND $creator = addr(0x1784A22855d5E482112F94d2169c28bC7e6aF885)`.

### Delegation Radar (evidence, not a guest list)

A vendor allowlist only answers *"is this contract famous?"*. The Radar answers *"what is it, and has it changed?"*, from on-chain evidence anyone can recompute:

- **Code family vs known drainers**: runtime code with metadata stripped and every 20/32-byte constant blanked, so sweeper clones that differ only in the attacker address match. Seeded from published research (`sources/known-bad.json`: 27 CrimeEnjoyor contracts catalogued by nullteilerfrei/Wintermute + GoPlus's 7702 phishing delegator → 16 families). Checked against our vendor contracts: no false matches.
- **Upgradeable logic**: DELEGATECALL **plus** a dependency that's an EIP-1967 proxy or a beacon (`implementation()` + `upgradeTo()`). DELEGATECALL alone isn't flagged: vendor contracts use it with logic chosen by the account itself.
- **Logic fingerprint**: code + every dependency's current implementation. If it changes, the Watchtower writes a `readonly` **Alert** (it can't be deleted), even for vendor-listed contracts.
- **Profile**: vendor listing, first seen, how many accounts delegated (recovered from each authorization).

`check()` turns this into the verdict a wallet shows: 🛑 known drainer code, a logic-change alert, a code mismatch with the vendor's version, no contract, or ≥5 authorizations in one transaction (nonce spraying); ⚠️ unknown / upgradeable / brand new; ✅ vendor-listed with clean evidence.

```bash
npm run watchtower -- --seed --write          # publish known drainer families + profile recent delegates
npm run watchtower -- --watch --write         # keep watching; alert on logic changes
npm run radar:demo                            # live Sepolia demo (below)
```

**Live demo (`npm run radar:demo`, real Sepolia transactions):**
1. Deploy a delegate whose code never changes but whose logic sits behind a beacon (harmless smart account)
2. Watchtower profiles it → PreSign: ⚠️ CAUTION (not vendor-listed, upgradeable by the beacon owner)
3. A demo account delegates anyway
4. The beacon owner swaps the logic for a drainer: the delegate address and its code are unchanged
5. Watchtower: logic fingerprint changed → 🚨 Alert on Arkiv
6. PreSign: 🛑 BLOCKED for anyone about to delegate; the delegated account sees the alert (Radar → "Is my account exposed?")
7. The demo account revokes

### Signer Guard demo (real EIP-7702 transactions on Sepolia)

```bash
npm run guard:demo
```

1. Delegate the test wallet to MetaMask's official delegator → ✅ trusted → real type-4 tx on Sepolia
2. Delegate to a contract deployed seconds ago (harmless, returns 42) → 🛑 refused, nothing signed
3. The real Binance delegation (mainnet tx `0xad99…298b`, read-only, 50 authorizations) → 🛑 refused
4. Revoke the delegation → ✅ trusted → wallet restored to a plain EOA

### Keeper (keeps trust fresh)

```bash
npm run keeper              # dry run: what would change
npm run keeper -- --write   # apply
```

It re-reads the sources (latest EF registry commit; every vendor file plus on-chain code) and compares them with our active entities on Arkiv:
- **unchanged**: extend expiry 7 days
- **added**: create the entity + a `Change` record
- **modified**: create the new entity, mark the old one `superseded`, write a `Change` record
- **removed**: mark the entity `removed` immediately (so `check()` stops trusting it now), write a `Change` record

Each item is one atomic Arkiv transaction. `Change` records are `readonly`, so history can't be rewritten. If a source can't be read (GitHub or an RPC is down), the run fails and changes nothing, so an outage can never "remove" trusted entries. Set `GITHUB_TOKEN` for regular runs; unauthenticated GitHub allows only 60 requests per hour.

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

We built PreSign with **Claude Code** (Anthropic, model Claude Opus 5.5) as a pair programmer. Commits it helped write carry a `Co-Authored-By: Claude` trailer.

- **Research:** reading the Arkiv docs and SDK types, ERC-7730 / ERC-8176, the EF registry layout, vendor EIP-7702 repos, and verifying the Binance transaction on Etherscan. Facts the AI found were re-checked against primary sources: SDK `.d.ts` files, raw JSON-RPC calls, GitHub files at pinned commits.
- **Code:** importers, keeper, `check()`, the ERC-7730 formatter, Signer Guard and the web app were written with AI assistance, with the team directing design decisions.
- **How we kept it honest:**
  - the formatter is tested against the registry's **own** expected outputs for 11 real mainnet transactions
  - the keeper's change paths were exercised **live on Arkiv** with a throwaway publisher
  - Signer Guard sent **real** Sepolia transactions
  - every number in this README and in `arkiv/*.md` was re-measured (Arkiv count queries, GitHub API, explorer)
- **Decisions are deterministic:** PreSign itself uses **no AI** at signing time. Every verdict comes from verified data and fixed rules.
- **Planning:** a planning document (no code) was written before the event; all code in this repo was written during ETHGlobal Mumbai.

## License

[MIT](LICENSE)
