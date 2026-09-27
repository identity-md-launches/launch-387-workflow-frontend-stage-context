import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// viem builds a `new Request(url, init)` before calling fetch. Under the jsdom
// environment the global AbortController is jsdom's while Request is Node's
// undici implementation, which rejects that signal. The tests never inspect
// the Request object, so a minimal stand-in keeps the RPC stack working and
// lets the stubbed global fetch answer JSON-RPC. Assigned directly (not via
// vi.stubGlobal) so per-test `vi.unstubAllGlobals()` leaves it in place.
class TestRequest {
  constructor(
    public url: string | URL,
    public init?: RequestInit,
  ) {}
}
(globalThis as any).Request = TestRequest;

afterEach(() => {
  cleanup();
  localStorage.clear();
});
