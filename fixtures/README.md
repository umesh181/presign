# Fixtures

Read-only demo inputs. **Nothing here is ever broadcast.**

| File | Used by | Expected |
|---|---|---|
| `binance-replay.json` | Web app "Binance hot-wallet delegation", Signer Guard demo step 3, `check.test.ts` | 🛑 blocked (50 authorizations in one transaction, delegate not vendor-listed) |
| `registry/calldata-UniswapV3SwapRouter*.json` | Web app "Uniswap swap" + "Tampered translation", formatter tests | ✅ verified / 🛑 blocked when one character is altered |

`binance-replay.json` is the real Oct 29, 2026 delegation of "Binance 14" (mainnet tx `0xad99…298b`), including its full 50-entry `authorizationList` copied from `eth_getTransactionByHash` and checked against Etherscan on 2026-11-05.

The MetaMask scenario needs no fixture: it is checked live against Sepolia and Arkiv.
