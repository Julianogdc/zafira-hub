const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://zafira-hub-v2-api.hvrb9d.easypanel.host';

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cliente HTTP central para comunicação com a API do Zafira Hub 2.0.
 * Utiliza credentials: 'include' para envio e recepção segura de cookies HTTP-only.
 */
export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const defaultHeaders: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const config: RequestInit = {
    ...options,
    credentials: 'include', // Obrigatório para cookies HTTP-only de sessão
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    if (response.status === 204) {
      return {} as T;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = data?.message || data?.error || `Erro na requisição (HTTP ${response.status})`;
      throw new ApiError(response.status, errorMessage, data);
    }

    return data as T;
  } catch (error: any) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(0, error.message || 'Erro de conexão com o servidor');
  }
}

export const api = {
  get: <T = any>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'GET' }),
  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};
