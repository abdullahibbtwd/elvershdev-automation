import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from '@/lib/api';

export type AutomationProgressEvent = {
  scheduleId: string;
  stage: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
  at: string;
};

export const AUTOMATION_PROGRESS_EVENT = 'automation.progress';

let automationSocket: Socket | null = null;

function getSocketOrigin(): string {
  const apiUrl = import.meta.env.VITE_API_URL ?? '/api';
  if (apiUrl.startsWith('http://') || apiUrl.startsWith('https://')) {
    return new URL(apiUrl).origin;
  }
  return window.location.origin;
}

export function getAutomationSocket(): Socket | null {
  const token = getAccessToken();
  if (!token) {
    disconnectAutomationSocket();
    return null;
  }

  if (automationSocket?.connected) {
    return automationSocket;
  }

  if (automationSocket) {
    automationSocket.auth = { token };
    automationSocket.connect();
    return automationSocket;
  }

  automationSocket = io(`${getSocketOrigin()}/automation`, {
    auth: { token },
    withCredentials: true,
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 1000,
  });

  automationSocket.on('reconnect_attempt', () => {
    if (!automationSocket) return;
    automationSocket.auth = { token: getAccessToken() };
  });

  return automationSocket;
}

export function disconnectAutomationSocket() {
  if (!automationSocket) return;
  automationSocket.removeAllListeners();
  automationSocket.disconnect();
  automationSocket = null;
}
