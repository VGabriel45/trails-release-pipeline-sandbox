# @vgabriel45/demo-utils

## 0.4.0

### Minor Changes

- [#47](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/47) [`f8945ba`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/f8945ba4c89f825cd3d79ceb8d36d04884041b5a) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Add `capitalize` helper for uppercasing the first character of text.

## 0.3.2

### Patch Changes

- [#38](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/38) [`7a6d3f2`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/7a6d3f282341f8092dd54b0b5a9a1800fb33ee4b) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Handle non-finite inputs in `clamp()` by safely returning the lower bound.

## 0.3.1

### Patch Changes

- [#31](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/31) [`7d5c31e`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/7d5c31e2c372f7ef190bd0c04ea6df3ea618a6ca) Thanks [@VGabriel45](https://github.com/VGabriel45)! - `snakeCase` now returns `"untitled"` instead of an empty string when the input produces no valid characters.

## 0.3.0

### Minor Changes

- [#28](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/28) [`960b783`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/960b783467cf8722d3d80211f5f8d7c9a3af91d7) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Added `snakeCase` helper to `demo-utils` for converting text to snake_case format.

## 0.2.1

### Patch Changes

- [#21](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/21) [`3b60b81`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/3b60b81b973375657b3ad68908b94446746be502) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Fixed `slugify` to collapse consecutive dashes into a single dash in the output.

## 0.2.0

### Minor Changes

- [#12](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/12) [`ef528c7`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/ef528c7f686630e35be26c7237e79c74ed2686db) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Add truncate helper

### Patch Changes

- [#13](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/13) [`13ff322`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/13ff32267f494953be0699d2a7df3e1896da1c6b) Thanks [@VGabriel45](https://github.com/VGabriel45)! - `slugify` now returns `"untitled"` instead of an empty string for symbol-only or whitespace input, `clamp` safely handles non-numeric values, and `truncate` coerces nullish inputs to strings.

## 0.1.1

### Patch Changes

- [#8](https://github.com/VGabriel45/trails-release-pipeline-sandbox/pull/8) [`de88ca2`](https://github.com/VGabriel45/trails-release-pipeline-sandbox/commit/de88ca216e8772cb8a8a92d7833b24585cc65f7f) Thanks [@VGabriel45](https://github.com/VGabriel45)! - Normalize reversed min/max in clamp()
