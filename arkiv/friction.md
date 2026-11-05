# Arkiv friction log

> Judged (25%). Log issues **as they happen**: expected vs actual, versions, repro steps. No invented complaints.

## Template

### N. Title
- **When:** YYYY-MM-DD HH:MM
- **Versions:** @arkiv-network/sdk x.y.z, Node x
- **Expected:**
- **Actual:**
- **Repro:**
- **Workaround:**

---

### 1. SDK 1.0 removed the payload/annotations model; many tutorials and AI snippets are outdated
- **When:** 2026-11-05 (pre-build research)
- **Versions:** @arkiv-network/sdk 1.0.1
- **Expected:** docs, llms.txt and examples match the current SDK.
- **Actual:** llms.txt and generated API docs still mention payload helpers, `ne`/`not`, cursors and `atBlock`, which SDK 1.0 / Rabdi removed.
- **Repro:** TODO: add exact URLs.
- **Workaround:** read the SDK README and `.d.ts` files in node_modules.
