# Reach

> *How many people or projects already use or depend on this data? Who would use our copy on Arkiv after Mumbai, and for what?*

## Who depends on this data today

### ERC-7730 clear-signing descriptors
Numbers checked on 2026-11-06 via the GitHub API and our own import:

| Signal | Value |
|---|---|
| Registry | [`ethereum/clear-signing-erc7730-registry`](https://github.com/ethereum/clear-signing-erc7730-registry), hosted by the Ethereum Foundation, CC0 |
| Protocol folders in `registry/` | **84** (Uniswap, Safe, 1inch, Lido, Morpho, …) |
| Contract deployments covered | **1,917** across **143 chains** (from 614 calldata descriptor files) |
| Auditor attestations | **169** ERC-8176 signatures (Cyfrin) |
| Activity | **82 commits in the last 30 days**, **95 contributors**, 131 stars, 222 forks |

Who consumes it: wallets that implement clear signing. Ledger maintains the reference tooling ([`LedgerHQ/python-erc7730`](https://github.com/LedgerHQ/python-erc7730)). The EF launch post ([2026-05-12](https://blog.ethereum.org/2026/05/12/clear-signing-announcement)) positions the registry as the neutral source wallets choose to trust, and the ethereum.org tutorial says *"Anyone is free to clone and self-host it."*

### EIP-7702 delegations
EIP-7702 has been live since May 2025. Figures below are **secondhand** (we cite the sources and didn't measure them ourselves):
- A USENIX Security 2026 study, cited by [DelegProof](https://eprint.iacr.org/2026/2060.pdf), reports **~63% of observed delegations point to malicious contracts**; secondary coverage cites 3.66M authorization transactions across 7 chains up to 2025-07-15.
- Wintermute reported **>80% of early delegations went to "CrimeEnjoyor" sweeper contracts** ([The Block](https://www.theblock.co/post/356481/wintermute-warns-pectra-upgrade-leaves-ethereum-users-at-risk-of-automated-attacks)).
- **Binance, 2026-10-29:** a hot-wallet signer delegated "Binance 14" to an hours-old sweeper ([tx](https://etherscan.io/tx/0xad99264d5532ae0dd04b2004eebda05f25657e70dacb764f7ac8d4ccd051298b), 50 authorizations). Binance estimates ~$6.3B lost across ~10 chains in the incident.

The legitimate delegate contracts we mirror belong to the wallets most users already have: **MetaMask, Coinbase/Base, Uniswap, OKX, ZeroDev, Alchemy**. There is **no shared, open list** of them today; each vendor publishes its own address in its own repo and format.

## Who would use our copy after Mumbai

| User | Use | Why our copy rather than the source |
|---|---|---|
| **Exchange & custody signing systems** | Signer Guard: refuse delegations that aren't verified and calls with no verified translation | They sign with no human watching. The Binance case: 50 pre-signed authorizations to an unknown contract would have been refused |
| **Wallets** (browser, mobile) | Show verified plain English before signing; show the Radar's evidence before an EIP-7702 delegation; tell users whose current delegate has an alert to revoke | One query by chain + address, no GitHub dependency, fingerprint + auditor status precomputed, and delegate evidence (drainer families, upgradeability, logic-change alerts) that doesn't exist anywhere else |
| **Hardware wallet companion apps** | Fetch descriptors when GitHub is blocked or down | Always-available, verifiable mirror |
| **AI agents with wallets** | "Check before I sign" via `check()` | Deterministic, machine-readable answers |
| **Security teams** | Watch the `Change` feed and Radar alerts: "which trusted entries changed, and which delegates swapped their logic or match drainer code?" | Early warning for registry poisoning, vendor address changes (we already caught OKX's change) and drainer clones (the Radar found one live on mainnet) |
| **Other watchers** | Publish their own `presign.radar.v1` / `presign.alert.v1` evidence under their own address | Evidence is pinned to its creator, so a wallet can require several independent watchers to agree: no single gatekeeper |
| **Protocol teams** | Confirm their descriptor is mirrored correctly and see its audit status | Public, queryable view of their entry |

## How someone starts using it
- **No integration at all:** run the `curl` query in the README.
- **TypeScript:** `@presign/core` → `checkTransaction()` / `checkDelegation()` with `delegateDepsFor(reader, PUBLISHER, clients)`, reading Arkiv with `createdBy(PUBLISHER)`.
- **Web:** the PreSign web app (`npm run web`): check a transaction before signing, explain a transaction hash, check whether an account's delegation is exposed.
- **Automated signers:** `@presign/guard` → `guardedDelegate()` refuses unsafe delegations (`npm run guard:demo` shows it on Sepolia).
