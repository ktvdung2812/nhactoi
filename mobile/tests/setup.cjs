// These component tests mock transport explicitly. Avoid initializing Expo's lazy
// native fetch polyfill when Jest enumerates globals after tearing down a suite.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: jest.fn(() =>
    Promise.reject(new Error("Mock the API transport in component tests.")),
  ),
});
