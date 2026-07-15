/** Mock SVM plugin — mirrors @0xtrails/svm, extends the mock-core SDK (peer dependency). */
export function createMockSvmPlugin(core) {
  if (!core || typeof core.init !== "function") {
    throw new Error("mock-svm requires a mock-core instance (peer dependency)");
  }
  return {
    id: "mock-svm",
    core,
    describe() {
      return "mock-svm plugin bound to mock-core";
    },
  };
}

export function getMockSvmMarker() {
  return "mock-svm-change";
}
