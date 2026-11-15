import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AUTOMATION_PROGRESS_EVENT,
  getAutomationSocket,
  type AutomationProgressEvent,
} from '@/lib/socket';
import { getAccessToken } from '@/lib/api';

const TERMINAL_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED']);

export function useAutomationProgress(focusScheduleId?: string | null) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [byScheduleId, setByScheduleId] = useState<
    Record<string, AutomationProgressEvent>
  >({});
  const [latest, setLatest] = useState<AutomationProgressEvent | null>(null);

  useEffect(() => {
    if (!getAccessToken()) return;

    const socket = getAutomationSocket();
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onProgress = (event: AutomationProgressEvent) => {
      setByScheduleId((prev) => ({ ...prev, [event.scheduleId]: event }));
      setLatest(event);
      if (TERMINAL_STATUSES.has(event.status) || event.stage === 'DONE') {
        void queryClient.invalidateQueries({ queryKey: ['automation'] });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on(AUTOMATION_PROGRESS_EVENT, onProgress);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off(AUTOMATION_PROGRESS_EVENT, onProgress);
    };
  }, [queryClient]);

  const focused =
    (focusScheduleId ? byScheduleId[focusScheduleId] : null) ??
    latest ??
    null;

  return {
    connected,
    latest: focused,
    byScheduleId,
    events: byScheduleId,
  };
}
