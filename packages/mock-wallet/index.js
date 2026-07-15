/** Mock wallet — mirrors @0xtrails/wallet as a leaf dependency for release testing. */
export function createMockWallet(address = "0x0000000000000000000000000000000000000000") {
  return {
    address,
    connect() {
      return { connected: true, address };
    },
  };
}

export function getMockWalletMarker() {
  return "mock-wallet-change";
}
