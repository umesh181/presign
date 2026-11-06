# Arkiv friction log

Everything below is something we hit or verified ourselves while building PreSign (2026-11-05 → 06), with versions and repro steps. Environment unless noted: `@arkiv-network/sdk` **1.0.1**, Node **26.5.0**, macOS, Rabdi testnet (chain 7794095).

---

### 1. `llms.txt` advertises pagination features SDK 1.0.1 doesn't have
- **Expected:** the docs index used by AI tools matches the current SDK.
- **Actual:** `https://docs.arkiv.network/llms.txt` line 27 lists pagination as *"`limit` (max 100), `fetch`, `next`, `for await`, `cursor`, `atBlock`"*. In SDK 1.0.1 the query builder has **no** `next()`, async iteration, `cursor`, or `atBlock` reads. `atBlock` exists only as `ExpirationTime.atBlock` for expiry. Only `limit` + `offset` exist.
- **Repro:** `curl -s https://docs.arkiv.network/llms.txt | sed -n 27p`, then `grep -c "cursor\|next()\|atBlock" node_modules/@arkiv-network/sdk/dist/index-*.d.ts` (0 hits in the query builder types).
- **Impact:** AI-assisted code generated from the docs index won't compile. We relied on the SDK's own `README.md` and `.d.ts` files instead.
- **Workaround:** paginate with `.limit(100).offset(n)`.

### 2. SDK triggers a Node warning on every query (Node ≥ 25)
- **Expected:** no warnings from a plain query in Node.
- **Actual:** `(node) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.` The SDK's debug helper does `"localStorage" in globalThis` (`dist/query-*.js`, line ~13), and touching `globalThis.localStorage` in recent Node emits this warning.
- **Repro:**
  ```ts
  import { createReader, Descriptor } from "@presign/core"; // createPublicClient({ chain: rabdi(...) })
  await createReader("").select({ $key: true }).from(Descriptor).limit(1).fetch();
  ```
  Run with `npx tsx` on Node 26.5.0.
- **Workaround:** ignore it, or run with `--no-warnings`. **Suggestion:** read the DEBUG flag from `process.env` in Node and only touch `localStorage` in browsers.

### 3. `str` is limited to 128 **bytes**, `bytes` to 128 **KiB**: easy to confuse
- **Expected (our first plan):** "~128 KiB per value" for all attributes.
- **Actual:** `MAX_STRING_BYTES = 128` (bytes, UTF-8) vs `MAX_BYTES_LENGTH = MAX_ENTITY_BYTES = 128 * 1024`. A 128-byte `str` limit is very tight for paths, URLs or lists of function selectors.
- **Impact:** we redesigned the schema: long or variable data went into `bytes` (not indexable), and the importer validates every `str` length before writing (`sourcePath` etc.).
- **Suggestion:** put the str limit prominently next to `str()` in the schema docs and error messages.

### 4. 128 KiB `bytes` budget per create, no built-in compression
- **Actual:** the largest registry descriptor (`registry/lifi/calldata-LIFIDiamond.json`, includes resolved) is **179,560 bytes**, over the per-create budget (shared by all `bytes` columns of one create). 55 of our 1,917 entities used it.
- **Workaround:** we gzip descriptor JSON ourselves (`CompressionStream`, works in Node and browsers): max 11,891 B, total 20.2 MiB → 2.9 MiB. We later found the separate `arkiv-chunking` package via Arkiv's MCP.
- **Suggestion:** an optional `compress: "gzip"` on `bytes()` columns, or link `arkiv-chunking` from the limits page.

### 5. No `!=` / `NOT` in the query language
- **Actual:** SDK 1.0.1 exports `eq, gt, gte, lt, lte, between, startsWith, exists, hasType, and, or`, with no negation.
- **Impact:** "all descriptors except superseded ones" can't be written. We store a positive indexed `status` (`active` / `superseded` / `removed`) and always query `status = 'active'`.
- **Suggestion:** document this pattern in the querying guide.

### 6. Entity keys aren't content-derived, so idempotent imports need query-before-write
- **Actual:** keys are `keccak(chainId, arkivAddr, owner, nonce, salt)`. Even with `NO_SALT` they depend on the owner's nonce, so re-running an import creates **new** entities.
- **Impact:** for a re-runnable importer (a track requirement), we load all active entities (`createdBy(publisher)`, paged 100 at a time) and diff by a natural key (`chainId:address`) plus a content hash. The keeper also handles leftover duplicates after a crash.
- **Suggestion:** an optional content-derived or caller-chosen salt helper ("upsert by natural key") would make mirrors much simpler.

### 7. No historical reads and no expiry event: history must be built by hand
- **Actual:** reads always hit the latest block (no `atBlock` reads on Rabdi), and entity events cover created / patched / expiry-extended / ownership / deleted, but **not expired**.
- **Impact:** "what changed in the last 24h?" isn't answerable from Arkiv itself, so we write our own `readonly` `Change` entities in the same transaction as each change.
- **Suggestion:** an `EntityExpired` event, or a per-owner change feed.

### 8. Batch sizing under the 2^24 gas cap has to be found empirically
- **Actual:** no documented guidance on how many creates or extensions fit in one `executeBatch`.
- **Measured on Rabdi** (explorer, publisher wallet): batches of 16–20 descriptor creates with 64–108 KB of input data used **3.4M–5.2M gas**; 200 extensions in one batch went through fine. Importing all 1,917 descriptors took 98 transactions (~0.43 tGLM); a full keeper extension of 1,958 entities took 11 transactions (0.043 tGLM).
- **Workaround:** batch by op count (20) and payload (64 KB); on failure, split the batch in half and retry (keeper).
- **Suggestion:** an `estimateBatch` helper, or published per-op gas numbers.

### 9. No read proofs (`eth_getProof`)
- **Repro:** `curl -s --json '{"jsonrpc":"2.0","id":1,"method":"eth_getProof","params":["0x4400000000000000000000000000000000000044",[],"latest"]}' https://rpc.rabdi.db-chain.testnet.arkiv.network` → `"the method eth_getProof does not exist/is not available"`.
- **Impact:** a client can't verify an entity's `$creator` or contents without trusting the RPC node. For a security product we have to state this honestly ("trusted-node reads").

### 10. Anonymous query budget runs out quickly
- **Expected:** our README promise ("run this `curl`, no key needed") to hold for anyone trying it.
- **Actual:** after a day of testing from one IP, keyless queries returned `{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}`. The same command with `-H "X-API-KEY: <key>"` works.
- **Repro:** run many keyless `arkiv_query` calls against `https://rpc.rabdi.db-chain.testnet.arkiv.network` from one IP.
- **Impact:** a judge on a shared venue Wi-Fi can hit it. We now document the key header next to every copyable query. The error message is clear, which helped.
- **Suggestion:** publish the anonymous budget (queries per hour per IP) on the access-keys page.

### 11. A hex string for a `bytes()` column is silently typed as `str`
- **Expected:** `{ deps: "0x5b7b…" }` on a `bytes()` column is stored as bytes (the docs say `bytes("0x…")` takes hex as the bytes it spells).
- **Actual:** a *bare* string value is inferred as `str` before the column type is consulted, so it fails with `Invalid str value … 570 UTF-8 bytes exceeds the 128-byte limit on a str`. Passing a `Uint8Array` (or wrapping it in `bytes(…)`) works.
- **Repro:** `executeBatch({ creates: [{ schema: S, values: { blob: "0x" + "ab".repeat(200) } }] })` where `blob: bytes()`.
- **Impact:** our first Radar write failed; the error message pointed the right way (use a bytes column), which was confusing because it already was one.
- **Suggestion:** coerce by the schema's column type when one is declared.

---

## What worked well

- **Schema-based SDK 1.0:** typed columns caught several mistakes at compile time, and `defineSchema` + `.indexed()` maps cleanly to how signers search (chainId + address).
- **`createdBy(publisher)`** is exactly the primitive a trust list needs.
- **`executeBatch` is atomic**, so each keeper change (create + retire + history) is all-or-nothing.
- **`permissionlessExtension` + `readonly`** express "anyone may keep it alive, nobody may change it" with two flags.
- **Raw JSON-RPC works without an access key** for a small anonymous budget, so our README query is a plain `curl`.
- **Cheap:** 1,958 entities and all keeper runs cost under 0.5 tGLM.
