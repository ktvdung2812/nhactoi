import { useRef } from 'react';

// Match only JSON routes backed by task-mutation-pipeline. Uploads and other
// legacy endpoints must not be advertised as idempotent by the client.
export function isTaskMutation(path, method = 'GET') {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) &&
    ((method === 'POST' && /^\/task-templates\/[^/]+\/(apply|create)$/.test(path)) || /^\/boards\/tasks\/[^/]+\/move$/.test(path) || /^\/tasks(?:\/[^/]+(?:\/extras|\/plan|\/fields|\/timeline|\/copy|\/checklists(?:\/[^/]+(?:\/order|\/copy|\/items(?:\/[^/]+(?:\/convert)?)?)?)?|\/reminders\/(?:acknowledge|snooze))?)?$/.test(path));
}

export function taskMutationRequest(request) {
  const pending = new Map();
  return async (path, options) => {
    const method = options?.method || 'GET';
    if (!isTaskMutation(path, method)) return request(path, options);
    const body = options.body ? JSON.parse(options.body) : {};
    // A parent may already own this operation's lifetime.
    if (body.operationId) return request(path, options);
    const { expectedRevision, ...intent } = body;
    const key = `${method} ${path}`, fingerprint = JSON.stringify(intent);
    let operation = pending.get(key);
    if (operation?.inflight) {
      if (operation.fingerprint === fingerprint) return operation.inflight;
      throw new Error('Thao tác trước vẫn đang gửi. Vui lòng chờ kết quả.');
    }
    if (!operation || operation.fingerprint !== fingerprint) {
      operation = { fingerprint, body: JSON.stringify({ ...body, operationId: crypto.randomUUID() }) };
      pending.set(key, operation);
    }
    // Keep the complete original payload, including its captured revision, on
    // an ambiguous failure. A refreshed read must not rewrite a retry's body.
    operation.inflight = Promise.resolve().then(() => request(path, { ...options, body: operation.body }));
    try {
      const result = await operation.inflight;
      pending.delete(key);
      return result;
    } catch (error) {
      if (error.status >= 400 && error.status < 500) pending.delete(key);
      throw error;
    } finally { operation.inflight = null; }
  };
}

export function useTaskMutation(request, scope = '') {
  const current = useRef(null);
  if (!current.current || current.current.scope !== scope) {
    const state = { scope, request };
    state.api = taskMutationRequest((...args) => state.request(...args));
    current.current = state;
  }
  current.current.request = request;
  return current.current.api;
}
