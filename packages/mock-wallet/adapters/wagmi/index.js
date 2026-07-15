/** Mock wagmi adapter — mirrors @0xtrails/adapter-wagmi, depends on mock-wallet. */
import { createMockWallet } from "@vgabriel45/mock-wallet";

export function createMockWagmiAdapter(config = {}) {
  const wallet = createMockWallet(config.address);
  const chainId = Number(config.chainId ?? 1);
  return {
    id: "mock-wagmi",
    chainId: Number.isFinite(chainId) ? chainId : 1,
    wallet,
    connect() {
      return wallet.connect();
    },
    getSession() {
      return {
        adapter: "wagmi",
        chainId: Number.isFinite(chainId) ? chainId : 1,
        walletAddress: wallet.address,
      };
    },
  };
}

export function getMockAdapterWagmiMarker() {
  return "mock-adapter-wagmi-change";
}
