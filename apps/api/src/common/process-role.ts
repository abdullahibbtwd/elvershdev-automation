/**
 * Process role for multi-instance deployments.
 *
 * - `all` (default): HTTP + Nest crons + automation/analytics BullMQ hosts (single-container).
 * - `api`: HTTP + queue producers only — safe to scale horizontally.
 * - `scheduler`: Nest crons + automation/analytics BullMQ hosts — must run as a singleton.
 */
export type ProcessRole = 'all' | 'api' | 'scheduler';

export function getProcessRole(): ProcessRole {
  const raw = (process.env.PROCESS_ROLE ?? 'all').trim().toLowerCase();
  if (raw === 'api' || raw === 'scheduler' || raw === 'all') {
    return raw;
  }
  return 'all';
}

export function shouldRunSchedulers(role: ProcessRole = getProcessRole()): boolean {
  return role === 'all' || role === 'scheduler';
}

export function shouldRunQueueHosts(role: ProcessRole = getProcessRole()): boolean {
  return role === 'all' || role === 'scheduler';
}

export function shouldServeHttp(role: ProcessRole = getProcessRole()): boolean {
  return role === 'all' || role === 'api';
}
