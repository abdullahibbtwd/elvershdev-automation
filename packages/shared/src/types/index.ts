export type JobStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export type MediaType = 'image' | 'video' | 'audio' | 'subtitle';

export type PublishPlatform = 'facebook' | 'instagram' | 'tiktok' | 'youtube';

export type UserRole = 'admin' | 'editor' | 'viewer' | 'ADMIN' | 'EDITOR' | 'VIEWER';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AuthSession {
  user: PublicUser;
  accessToken: string;
  expiresIn: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

export interface StoryScene {
  id: string;
  order: number;
  narration: string;
  visualPrompt: string;
  durationSeconds?: number;
}

export interface GenerationJobPayload {
  jobId: string;
  userId: string;
  projectId?: string;
  storyId?: string;
  metadata?: Record<string, unknown>;
}

export interface StorageObjectRef {
  bucket: string;
  key: string;
  url?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface HealthCheckResult {
  status: 'ok' | 'error' | 'shutting_down';
  info?: Record<string, { status: string; [key: string]: unknown }>;
  error?: Record<string, { status: string; [key: string]: unknown }>;
  details?: Record<string, { status: string; [key: string]: unknown }>;
}
