/**
 * Fetch the EF clear-signing registry at ONE pinned commit, fully in memory.
 *
 * WHY a tarball, read in memory:
 * - one HTTP request instead of ~1,000 GitHub API calls (no rate limits)
 * - no extraction to disk: macOS is case-insensitive and two Morpho files differ
 *   only by case, so extracting would silently overwrite one of them.
 */
import { gunzipSync } from "node:zlib";
import { retry } from "@presign/core";

const ghHeaders = (): Record<string, string> => {
  const token = process.env.GITHUB_TOKEN;
  return {
    "User-Agent": "presign-importer",
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

/** Latest commit SHA on a branch (used to pin, and by the keeper to detect changes). */
export async function latestCommit(repo: string, ref = "master"): Promise<string> {
  return retry(async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/${ref}`, { headers: ghHeaders() });
    if (!res.ok) throw new Error(`GitHub ${res.status} for ${repo}@${ref}`);
    return ((await res.json()) as { sha: string }).sha;
  }, "GitHub latest commit");
}

export interface RegistrySnapshot {
  repo: string;
  commit: string;
  /** repo-relative path -> UTF-8 file content */
  files: Map<string, string>;
}

/** Download repo@commit as a tarball and return its text files keyed by repo-relative path. */
export async function fetchRegistry(repo: string, commit: string): Promise<RegistrySnapshot> {
  const tar = await retry(async () => {
    const res = await fetch(`https://codeload.github.com/${repo}/tar.gz/${commit}`, {
      headers: { "User-Agent": "presign-importer" },
    });
    if (!res.ok) throw new Error(`Tarball download failed: ${res.status}`);
    return gunzipSync(Buffer.from(await res.arrayBuffer()));
  }, "registry tarball download");
  const files = new Map<string, string>();
  for (const [path, content] of readTar(tar)) {
    // GitHub prefixes every path with "<owner>-<repo>-<sha>/": strip it.
    const rel = path.slice(path.indexOf("/") + 1);
    if (rel) files.set(rel, content.toString("utf8"));
  }
  return { repo, commit, files };
}

/**
 * Minimal tar reader (ustar + pax long names), enough for GitHub tarballs.
 * Each entry: 512-byte header, then content padded to 512 bytes.
 */
function* readTar(buf: Buffer): Generator<[string, Buffer]> {
  let offset = 0;
  let paxPath: string | undefined;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end of archive
    const str = (start: number, len: number) => header.toString("utf8", start, start + len).replace(/\0.*$/s, "");
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1) || "0";
    const prefix = str(345, 155);
    const name = prefix ? `${prefix}/${str(0, 100)}` : str(0, 100);
    const body = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x") {
      // pax extended header: "<len> path=<value>\n" records
      const m = body.toString("utf8").match(/\d+ path=([^\n]*)\n/);
      paxPath = m?.[1];
      continue;
    }
    if (type === "g") continue; // global pax header (GitHub stores the commit id here)
    if (type === "0") yield [paxPath ?? name, body];
    paxPath = undefined;
  }
}
