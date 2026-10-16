import { useCallback, useEffect, useRef } from 'react';

export const accessDenied = error => [401, 403, 404, 423].includes(error?.status);
export const staleRequest = error => error?.code === 'stale_ui_request';
const stale = () => Object.assign(new Error('Màn hình đã thay đổi.'), { code: 'stale_ui_request' });

// A denied request invalidates sibling reads too; a late success must not
// restore data that the screen just removed after losing access.
export function useGuardedApi(request, onDenied, scope = '') {
  const state = useRef({ request, scope, epoch: 0, active: false });
  const denied = useRef(onDenied);
  denied.current = onDenied;
  if (state.current.request !== request || state.current.scope !== scope)
    state.current = { request, scope, epoch: state.current.epoch + 1, active: false };
  const current = state.current;
  useEffect(() => {
    current.active = true;
    return () => { current.active = false; current.epoch++; };
  }, [current]);
  const guarded = useCallback(async (...args) => {
    const epoch = current.epoch;
    if (!current.active || state.current !== current) throw stale();
    try {
      const result = await request(...args);
      if (!current.active || state.current !== current || current.epoch !== epoch) throw stale();
      return result;
    } catch (error) {
      if (!current.active || state.current !== current || current.epoch !== epoch) throw stale();
      if (accessDenied(error)) { current.epoch++; denied.current(error); }
      throw error;
    }
  }, [request, current]);
  const isCurrent=useCallback(()=>current.active&&state.current===current,[current]);
  return [guarded,isCurrent];
}
