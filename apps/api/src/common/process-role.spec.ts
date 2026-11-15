import {
  getProcessRole,
  shouldRunQueueHosts,
  shouldRunSchedulers,
  shouldServeHttp,
} from './process-role';

describe('process-role', () => {
  const original = process.env.PROCESS_ROLE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PROCESS_ROLE;
    } else {
      process.env.PROCESS_ROLE = original;
    }
  });

  it('defaults to all', () => {
    delete process.env.PROCESS_ROLE;
    expect(getProcessRole()).toBe('all');
    expect(shouldServeHttp()).toBe(true);
    expect(shouldRunSchedulers()).toBe(true);
    expect(shouldRunQueueHosts()).toBe(true);
  });

  it('api role serves HTTP only', () => {
    process.env.PROCESS_ROLE = 'api';
    expect(getProcessRole()).toBe('api');
    expect(shouldServeHttp()).toBe(true);
    expect(shouldRunSchedulers()).toBe(false);
    expect(shouldRunQueueHosts()).toBe(false);
  });

  it('scheduler role owns crons and queue hosts without HTTP requirement', () => {
    process.env.PROCESS_ROLE = 'scheduler';
    expect(getProcessRole()).toBe('scheduler');
    expect(shouldServeHttp()).toBe(false);
    expect(shouldRunSchedulers()).toBe(true);
    expect(shouldRunQueueHosts()).toBe(true);
  });

  it('rejects unknown roles by falling back to all', () => {
    process.env.PROCESS_ROLE = 'worker';
    expect(getProcessRole()).toBe('all');
  });
});
