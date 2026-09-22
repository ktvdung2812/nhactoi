// Preserve invocation order across asynchronous SQLite initialization/IO. In particular,
// a logout erase must finish after any write already requested by an in-flight query.
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.catch(() => {});
    return result;
  };
}
