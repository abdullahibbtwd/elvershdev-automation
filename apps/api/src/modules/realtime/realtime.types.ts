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
export const AUTOMATION_USER_ROOM = (userId: string) => `user:${userId}`;
