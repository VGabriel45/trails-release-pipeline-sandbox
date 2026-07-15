/** Mock wagmi adapter — mirrors @0xtrails/adapter-wagmi, depends on mock-wallet. */
import { createMockWallet } from "@vgabriel45/mock-wallet";

export function createMockWagmiAdapter(config = {}) {
  const wallet = createMockWallet(config.address);
  return {
    id: "mock-wagmi",
    wallet,
    connect() {
      return wallet.connect();
    },
  };
}

export function getMockAdapterWagmiMarker() {
  return "mock-adapter-wagmi-change";
}
