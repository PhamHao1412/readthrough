import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface User {
  id: string;
  username: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  signup: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const getAccessToken = () => localStorage.getItem('readthrough_access_token');
  const getRefreshToken = () => localStorage.getItem('readthrough_refresh_token');

  const setTokens = (access: string, refresh: string) => {
    localStorage.setItem('readthrough_access_token', access);
    localStorage.setItem('readthrough_refresh_token', refresh);
  };

  const clearTokens = () => {
    localStorage.removeItem('readthrough_access_token');
    localStorage.removeItem('readthrough_refresh_token');
  };

  const logout = useCallback(async () => {
    const refresh = getRefreshToken();
    if (refresh) {
      try {
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        });
      } catch (e) {
        console.error('Error calling logout API:', e);
      }
    }
    clearTokens();
    setUser(null);
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const refresh = getRefreshToken();
    if (!refresh) return null;

    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.succeeded && json.data?.access_token) {
          setTokens(json.data.access_token, json.data.refresh_token);
          return json.data.access_token;
        }
      }
    } catch (e) {
      console.error('Error refreshing session:', e);
    }

    // If refresh fails, log out
    clearTokens();
    setUser(null);
    return null;
  }, []);

  const fetchWithAuth = useCallback(async (url: string, options: RequestInit = {}): Promise<Response> => {
    let access = getAccessToken();
    
    // Set headers
    const headers = new Headers(options.headers || {});
    if (access) {
      headers.set('Authorization', `Bearer ${access}`);
    }
    
    const requestOptions = { ...options, headers };
    let res = await fetch(url, requestOptions);

    // If unauthorized, token might have expired, try refreshing it
    if (res.status === 401) {
      const newAccess = await refreshSession();
      if (newAccess) {
        // Retry request with new token
        const newHeaders = new Headers(options.headers || {});
        newHeaders.set('Authorization', `Bearer ${newAccess}`);
        res = await fetch(url, { ...options, headers: newHeaders });
      }
    }

    return res;
  }, [refreshSession]);

  const loadCurrentUser = useCallback(async () => {
    const access = getAccessToken();
    if (!access) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/me', {
        headers: { 'Authorization': `Bearer ${access}` }
      });

      if (res.ok) {
        const json = await res.json();
        if (json.succeeded && json.data) {
          setUser(json.data);
        }
      } else if (res.status === 401) {
        // Try refreshing
        const newAccess = await refreshSession();
        if (newAccess) {
          const retryRes = await fetch('/api/v1/auth/me', {
            headers: { 'Authorization': `Bearer ${newAccess}` }
          });
          if (retryRes.ok) {
            const retryJson = await retryRes.json();
            if (retryJson.succeeded && retryJson.data) {
              setUser(retryJson.data);
            }
          }
        }
      }
    } catch (e) {
      console.error('Error loading account profile:', e);
    } finally {
      setLoading(false);
    }
  }, [refreshSession]);

  useEffect(() => {
    loadCurrentUser();
  }, [loadCurrentUser]);

  const login = async (username: string, password: string) => {
    const res = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const json = await res.json();
    if (res.ok && json.succeeded && json.data?.access_token) {
      setTokens(json.data.access_token, json.data.refresh_token);
      // Fetch user profile
      const userRes = await fetch('/api/v1/auth/me', {
        headers: { 'Authorization': `Bearer ${json.data.access_token}` }
      });
      if (userRes.ok) {
        const userJson = await userRes.json();
        setUser(userJson.data);
      }
    } else {
      throw new Error(json.message || 'Login failed.');
    }
  };

  const signup = async (username: string, email: string, password: string) => {
    const res = await fetch('/api/v1/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    const json = await res.json();
    if (!res.ok || !json.succeeded) {
      throw new Error(json.message || 'Registration failed.');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
        fetchWithAuth,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
