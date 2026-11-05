/**
 * Node-only helpers: env config + the publisher wallet that WRITES entities.
 * Never import this from the web app.
 */
import { config } from "dotenv";
import { createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// npm workspace scripts run inside packages/<name>, so load the repo-root .env explicitly.
config({ path: new URL("../../../.env", import.meta.url), quiet: true });

export function env(name: string, required = true): string {
  const value = process.env[name] ?? "";
  if (required && !value) throw new Error(`Missing ${name} in .env (see .env.example)`);
  return value;
}

export function createPublisher() {
  const pk = env("PUBLISHER_PRIVATE_KEY");
  if (!isHex(pk)) throw new Error("PUBLISHER_PRIVATE_KEY must be 0x-prefixed hex");
  const account = privateKeyToAccount(pk);
  const chain = rabdi({ accessKey: env("ARKIV_ACCESS_KEY") });
  return createWalletClient({ chain, transport: http(), account });
}
