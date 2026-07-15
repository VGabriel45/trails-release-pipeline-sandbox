/** Mock wallet — mirrors @0xtrails/wallet as a leaf dependency for release testing. */
export function createMockWallet(address = "0x0000000000000000000000000000000000000000") {
  const normalizedAddress = String(address ?? "").trim().toLowerCase() ||
    "0x0000000000000000000000000000000000000000";

  return {
    address: normalizedAddress,
    connect() {
      return { connected: true, address: normalizedAddress };
    },
    disconnect() {
      return { connected: false, address: normalizedAddress };
    },
    getAccount() {
      return { address: normalizedAddress };
    },
  };
}

export function getMockWalletMarker() {
  return "mock-wallet-change";
}
