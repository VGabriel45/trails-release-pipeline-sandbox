/** Mock core SDK — mirrors the main 0xtrails package, composed from mock-api + mock-wallet. */
import { createMockApiClient } from "@vgabriel45/mock-api";
import { createMockWallet } from "@vgabriel45/mock-wallet";

export function createMockCore(config = {}) {
  const api = createMockApiClient(config.baseUrl);
  const wallet = createMockWallet(config.address);
  return {
    api,
    wallet,
    async init() {
      const status = await api.getStatus();
      return { status, wallet: wallet.connect() };
    },
  };
}

export function getMockCoreMarker() {
  return "mock-core-change";
}
