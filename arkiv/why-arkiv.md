# Why Arkiv

> *If this data sat in Postgres, what could people no longer do?*

**Short answer:** the whole point of a trust list is that you shouldn't have to trust whoever runs it. In Postgres, every reader trusts our server, our admin and our uptime. On Arkiv, anyone can read the lists without asking us, prove who wrote every entry, and rely on stale trust expiring by itself.

## What PreSign uses Arkiv for, concretely

| Arkiv feature | How PreSign uses it | What breaks without it |
|---|---|---|
| **Public queries, no backend of ours** | Wallets, signers and judges query `arkiv_query` directly (README has a `curl` that needs no API key). The web app reads Arkiv straight from the browser | With Postgres, every reader depends on our API: we can go down, rate-limit, censor or quietly change answers |
| **Provable author (`$creator`)** | Every read is pinned to `$creator = 0x1784…F885` (our publisher). The schema name is forgeable, the creator is not | A Postgres row says nothing about who wrote it; an admin (or attacker with DB access) can edit it silently |
| **Built-in expiry** | Every descriptor and delegate expires in **7 days**. The keeper extends only entries whose source still matches | In Postgres, stale "trusted" rows live forever unless someone remembers to delete them. If the operator disappears, old trust persists. That is the dangerous failure mode |
| **`permissionlessExtension`** | Anyone can keep entries alive if we stop running the keeper, but **nobody else can change their content** | A Postgres mirror dies with its operator, or must hand out write access |
| **`readonly` entities** | `Change` records (added / modified / removed) can never be edited | Logs in Postgres can be rewritten by whoever controls the database |
| **Atomic `executeBatch`** | Each keeper change is one transaction: new entity + retire old + history record. A half-applied update can't exist | Needs careful transaction handling; readers can't verify it happened |
| **Typed, indexed attributes** | Filter by `chainId` + `address` + `status` (+ `attested`) in one query, exactly how a signer searches | This part Postgres does fine. Arkiv gives it without running a server |

## What people can do with our copy that they can't with the original sources today

| Original source | Today | With PreSign on Arkiv |
|---|---|---|
| EF clear-signing registry (GitHub) | Clone or download the repo, parse `index.calldata.json`, resolve `includes` yourself, trust GitHub to be up and unblocked | One query by `chainId` + `address` returns the **resolved** descriptor, its **ERC-8176 fingerprint**, and whether a **verified auditor signature** matches it |
| Auditor attestations (`registry/*/sigs`) | You must recover each EAS signer and re-hash each descriptor yourself | `attested = true` only where we recovered Cyfrin's signer **and** the hash matched (166/169 match; 3 stale ones flagged) |
| EIP-7702 delegate addresses | Scattered across 6 vendor repos in different formats, with no shared list. Addresses go stale (OKX changed theirs on 2026-10-09) | **One** queryable allowlist: 41 entries, 7 chains, each address proven present in the vendor's own file, each with a per-chain code hash re-checked at signing time |
| History | Git history exists only for the registry; vendor address changes are invisible | `Change` entities: "what trusted entries changed in the last 24h?" is one query |

## Why not the alternatives?

| Alternative | Why it doesn't fit |
|---|---|
| **Postgres / a normal API** | Trust the operator; no provable author; stale trust persists; dies with us |
| **GitHub (status quo)** | Single point of failure, can be blocked, not queryable by chain + address, no verification of what you downloaded |
| **IPFS / Swarm alone** | Content-addressed storage is great for files, but you can't *query* "descriptor for chain 1, address 0x…" without already knowing the hash. (We'd use Swarm for full files and Arkiv for the queryable index) |
| **A smart contract on Ethereum** | Storing ~2,000 descriptors (2.9 MiB gzipped) costs far too much, has no expiry, and querying needs an extra indexer |

## Honest limits

- **Testnet:** PreSign runs on Arkiv's Rabdi testnet.
- **Trusted-node reads:** Rabdi has no read proofs today (`eth_getProof` is not available), and block production is centralised for now. A reader trusts the node it queries to report `$creator` correctly. That's still far better than trusting our server, and clients can query several nodes.
- **Expiry needs a keeper:** max lifetime is ~182 days (7,884,000 blocks), so a mirror must be maintained. We see that as a feature: trust has to be re-earned.
