# Fixtures

Read-only demo inputs. **Nothing here is ever broadcast.**

| File | Scenario | Expected |
|---|---|---|
| `binance-replay.json` | Real Oct 29, 2026 delegation of "Binance 14" to a sweeper | 🛑 blocked |
| `metamask-delegation.json` (TODO) | Delegation to MetaMask's official delegator | ✅ trusted |
| `uniswap-swap.json` (TODO) | Uniswap V3 SwapRouter `exactInputSingle` (`0x414bf389`) | ✅ readable |

The values in `binance-replay.json` were checked against Etherscan on 2026-11-05.
The full `authorizationList` should be fetched with `eth_getTransactionByHash` and committed here.
