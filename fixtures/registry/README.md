# Registry test fixtures

Copied unchanged from [ethereum/clear-signing-erc7730-registry](https://github.com/ethereum/clear-signing-erc7730-registry) (CC0-1.0) at commit `ef582c2f03bfbd062b7e3889b55dd3b45c3d5494`:

- `calldata-UniswapV3SwapRouter.json`: from `registry/uniswap/`
- `calldata-UniswapV3SwapRouter.tests.json`: from `registry/uniswap/testsv2/`. Real Ethereum mainnet transactions with the exact display output the registry expects.

Our formatter tests (`packages/core/test/formatter.test.ts`) render each test transaction and compare the output with `expected`.
