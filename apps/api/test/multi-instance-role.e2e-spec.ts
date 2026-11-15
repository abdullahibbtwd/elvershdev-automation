import { shouldRunQueueHosts, shouldRunSchedulers, shouldServeHttp } from '../src/common/process-role';

/**
 * Multi-instance ownership contract for Phase 12.1.
 * Ordinary API replicas (PROCESS_ROLE=api) must not host crons or queue consumers.
 * Scheduler singleton owns both. Default "all" preserves single-container behavior.
 */
describe('Phase 12.1 multi-instance process roles', () => {
  const original = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (original === undefined) delete process.env.PROCESS_ROLE;
    else process.env.PROCESS_ROLE = original;
  });

  it('two api replicas must not own schedulers or queue hosts', () => {
    process.env.PROCESS_ROLE = 'api';
    expect(shouldServeHttp()).toBe(true);
    expect(shouldRunSchedulers()).toBe(false);
    expect(shouldRunQueueHosts()).toBe(false);

    // Second replica same role — still no consumers
    expect(shouldRunQueueHosts()).toBe(false);
    expect(shouldRunSchedulers()).toBe(false);
  });

  it('exactly one scheduler role owns crons and queue hosts', () => {
    process.env.PROCESS_ROLE = 'scheduler';
    expect(shouldRunSchedulers()).toBe(true);
    expect(shouldRunQueueHosts()).toBe(true);
    expect(shouldServeHttp()).toBe(false);
  });

  it('api + scheduler partition covers all responsibilities without overlap on hosts', () => {
    process.env.PROCESS_ROLE = 'api';
    const apiHosts = shouldRunQueueHosts();
    const apiCron = shouldRunSchedulers();
    process.env.PROCESS_ROLE = 'scheduler';
    const schedHosts = shouldRunQueueHosts();
    const schedCron = shouldRunSchedulers();

    expect(apiHosts).toBe(false);
    expect(apiCron).toBe(false);
    expect(schedHosts).toBe(true);
    expect(schedCron).toBe(true);
  });
});
