// These component tests mock transport explicitly. Avoid initializing Expo's lazy
// native fetch polyfill when Jest enumerates globals after tearing down a suite.
Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  writable: true,
  value: jest.fn(() =>
    Promise.reject(new Error("Mock the API transport in component tests.")),
  ),
});
// Most component suites exercise transport/UI and use an isolated durable-store
// substitute. offline-store.test.tsx explicitly unmocks it to verify native calls.
jest.mock('../src/core/offline-store', () => {
  const states=new Map();
  const empty=()=>({operations:[],drafts:{},ids:{},results:{}});
  return {
    offlineRead:jest.fn(async scope=>JSON.parse(JSON.stringify(states.get(scope)||empty()))),
    offlineUpdate:jest.fn(async(scope,change)=>{const next=JSON.parse(JSON.stringify(states.get(scope)||empty()));const result=change(next);states.set(scope,next);return result;}),
    offlineDelete:jest.fn(async scope=>{states.delete(scope);}),
  };
});
