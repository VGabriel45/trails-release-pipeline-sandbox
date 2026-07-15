/** Mock API client — mirrors @0xtrails/api as a leaf dependency for release testing. */
export function createMockApiClient(baseUrl = "https://api.example.test") {
  return {
    baseUrl,
    async getStatus() {
      return { ok: true, baseUrl };
    },
  };
}

export function getMockApiMarker() {
  return "mock-api-change";
}
