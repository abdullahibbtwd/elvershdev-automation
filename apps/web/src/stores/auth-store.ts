import { create } from 'zustand';
import type { PublicUser } from '@ai-video/shared';
import { api, getAccessToken, setAccessToken } from '@/lib/api';
import { disconnectAutomationSocket } from '@/lib/socket';

interface AuthState {
  user: PublicUser | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSession: (user: PublicUser, accessToken: string) => void;
  clear: () => void;
  bootstrap: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: getAccessToken(),
  isLoading: true,
  isAuthenticated: false,

  setSession: (user, accessToken) => {
    setAccessToken(accessToken);
    set({
      user,
      accessToken,
      isAuthenticated: true,
      isLoading: false,
    });
  },

  clear: () => {
    disconnectAutomationSocket();
    setAccessToken(null);
    set({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  bootstrap: async () => {
    const token = getAccessToken();
    if (!token) {
      set({ isLoading: false, isAuthenticated: false, user: null });
      return;
    }

    try {
      const { data } = await api.get('/auth/me');
      set({
        user: data.data,
        accessToken: token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      get().clear();
    }
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore network errors on logout
    } finally {
      get().clear();
    }
  },
}));
