import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * engineClient.ts talks to a real Web Worker (engine.worker.ts, which in
 * turn loads the WASM module) via postMessage/onmessage. None of that is
 * available or desirable in a unit test — instead this stubs the global
 * `Worker` constructor with a fake that records postMessage calls and lets
 * the test drive `onmessage` directly, so what's actually under test is
 * engineClient's own message-routing logic: id-based dispatch to the right
 * pending promise, progress-callback forwarding, and error rejection. That
 * logic is easy to get subtly wrong (e.g. resolving the wrong pending call,
 * or leaking a callback that's never cleaned up) and isn't covered by any
 * end-to-end Playwright check, which only exercises the happy path.
 */
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  posted: any[] = [];
  postMessage(msg: any, _transfer?: Transferable[]) {
    this.posted.push(msg);
  }
  /** Test helper: simulate a message arriving from the real worker. */
  emit(data: any) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

let mockWorker: MockWorker;

vi.stubGlobal(
  'Worker',
  vi.fn().mockImplementation(function () {
    mockWorker = new MockWorker();
    return mockWorker;
  }),
);

// Imported after the Worker stub is installed — engineClient constructs its
// worker lazily on first use, but stubbing global.Worker before import
// keeps this test file's intent unambiguous regardless of evaluation order.
const {
  initWorker,
  workerParseSurface,
  workerRunConformance,
  workerClearSurfaces,
  workerRemoveSurface,
} = await import('./engineClient');

describe('engineClient', () => {
  beforeAll(async () => {
    const readyPromise = initWorker('fake-wasm-url');
    // initWorker posts {type:'init', ...} and awaits a 'ready' reply.
    expect(mockWorker.posted[0]).toMatchObject({ type: 'init', wasmUrl: 'fake-wasm-url' });
    mockWorker.emit({ type: 'ready' });
    await readyPromise;
  });

  it('resolves workerParseSurface with the fields from the matching surfaceParsed reply', async () => {
    const positions = new Float32Array([1, 2, 3]);
    const indices = new Uint32Array([0, 1, 2]);
    const promise = workerParseSurface('production_start', new ArrayBuffer(8), 'test.00t');

    const sentId = mockWorker.posted.at(-1).id;
    mockWorker.emit({
      type: 'surfaceParsed',
      id: sentId,
      role: 'production_start',
      fileName: 'test.00t',
      name: 'test',
      vertexCount: 1,
      triangleCount: 1,
      positions,
      indices,
    });

    const result = await promise;
    expect(result.role).toBe('production_start');
    expect(result.fileName).toBe('test.00t');
    expect(result.positions).toBe(positions);
    expect(result.indices).toBe(indices);
  });

  it('routes concurrent calls to their own promise by id, not by arrival order', async () => {
    const p1 = workerParseSurface('production_start', new ArrayBuffer(8), 'a.00t');
    const id1 = mockWorker.posted.at(-1).id;
    const p2 = workerParseSurface('production_end', new ArrayBuffer(8), 'b.00t');
    const id2 = mockWorker.posted.at(-1).id;

    expect(id1).not.toBe(id2);

    // Reply to the SECOND request first, to prove dispatch is id-keyed, not
    // FIFO-order-dependent.
    mockWorker.emit({
      type: 'surfaceParsed', id: id2, role: 'production_end', fileName: 'b.00t',
      name: 'b', vertexCount: 1, triangleCount: 1,
      positions: new Float32Array(), indices: new Uint32Array(),
    });
    mockWorker.emit({
      type: 'surfaceParsed', id: id1, role: 'production_start', fileName: 'a.00t',
      name: 'a', vertexCount: 1, triangleCount: 1,
      positions: new Float32Array(), indices: new Uint32Array(),
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.fileName).toBe('a.00t');
    expect(r2.fileName).toBe('b.00t');
  });

  it('forwards progress messages to the onProgress callback without resolving the promise', async () => {
    const progressCalls: [string, number][] = [];
    const promise = workerRunConformance('dig', 1, 0.1, [], (phase, progress) => {
      progressCalls.push([phase, progress]);
    });
    const id = mockWorker.posted.at(-1).id;

    mockWorker.emit({ type: 'progress', id, phase: 'Preparing surfaces', progress: 0.05 });
    mockWorker.emit({ type: 'progress', id, phase: 'Computing conformance', progress: 0.15 });
    expect(progressCalls).toEqual([
      ['Preparing surfaces', 0.05],
      ['Computing conformance', 0.15],
    ]);

    mockWorker.emit({ type: 'conformanceResult', id, result: { mode: 'dig', summary: {}, flatDomains: [] } });
    const result = await promise;
    expect(result.mode).toBe('dig');
  });

  it('rejects the promise when the worker replies with an error', async () => {
    const promise = workerRunConformance('dig', 1, 0.1, []);
    const id = mockWorker.posted.at(-1).id;
    mockWorker.emit({ type: 'error', id, message: 'No overlap found' });
    await expect(promise).rejects.toThrow('No overlap found');
  });

  it('ignores a reply whose id has no pending callback (already resolved or unknown)', async () => {
    // Should not throw even though no promise is waiting on this id.
    expect(() => mockWorker.emit({ type: 'surfaceParsed', id: 999999, role: 'production_start' })).not.toThrow();
  });

  it('posts clearSurfaces and removeSurface messages directly with no pending callback', () => {
    workerClearSurfaces();
    expect(mockWorker.posted.at(-1)).toEqual({ type: 'clearSurfaces' });

    workerRemoveSurface('schedule_future');
    expect(mockWorker.posted.at(-1)).toEqual({ type: 'removeSurface', role: 'schedule_future' });
  });
});
