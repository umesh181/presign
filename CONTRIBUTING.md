# Working together (2 devs)

## Ownership
| Person A: data & Arkiv | Person B: checker & demo |
|---|---|
| `packages/importer`, `packages/keeper`, `packages/watchtower` | `packages/core` check/formatter, `packages/guard`, `apps/web` |
| `arkiv/schema.md`, `arkiv/data-quality.md` | `arkiv/reach.md`, `arkiv/why-arkiv.md` |

Both of you write to `arkiv/friction.md` **as problems happen**.

Changes to `packages/core/src/schemas.ts` affect both, so agree before changing it.

## Flow
1. `git pull --rebase` before you start.
2. Small commits with clear messages (judges read the history), e.g. `importer: resolve includes before hashing`.
3. Push often. Use a short-lived branch + PR for anything touching the other person's area.
4. `npm run typecheck && npm test` before pushing. CI runs both.

## Rules
- Never commit `.env` or private keys (testnet keys only).
- Never use Sourcify data, APIs or CDNs.
- Every mirrored record carries provenance: source URL, commit/version, import time.
- Don't invent APIs: check the SDK `.d.ts` files or docs.arkiv.network.
