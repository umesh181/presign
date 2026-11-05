/**
 * Minimal ERC-7730 formatter: calldata -> plain English, using ONLY descriptors from Arkiv.
 * We do not use Sourcify-made libraries (track rule).
 *
 * Hackathon scope: Uniswap V3 SwapRouter exactInputSingle (0x414bf389).
 * Formats needed: tokenAmount, addressName, unit, raw.
 *
 * TODO(B):
 * 1. For each key in display.formats: strip param names -> keccak -> 4-byte selector.
 * 2. Match calldata[0:4]; decode with viem decodeFunctionData using the parsed signature.
 * 3. Resolve field paths (params.amountIn, path.[0], ...).
 * 4. Render each field by its format; use interpolatedIntent if present.
 */
export interface FormattedField {
  label: string;
  value: string;
}

export interface Formatted {
  intent: string;
  fields: FormattedField[];
}
