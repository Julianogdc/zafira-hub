// Em desenvolvimento local, usa o proxy do Vite (/api) para evitar problemas de cookies cross-site em HTTP
const isDev = import.meta.env.DEV;
const API_BASE_URL = isDev
  ? '/api'
  : (import.meta.env.VITE_API_URL || 'https://zafira-hub-v2-api.hvrb9d.easypanel.host');

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Cliente HTTP central para comunicação com a API do Zafira Hub 2.0.
 * Utiliza credentials: 'include' para envio e recepção segura de cookies HTTP-only.
 * Gerencia Content-Type dinamicamente, evitando cabeçalhos desnecessários em requisições sem body.
 */
export async function apiFetch<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {};

  // Detecta tipos especiais onde o navegador deve definir o Content-Type (ex: multipart com boundary)
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const isUrlSearchParams = typeof URLSearchParams !== 'undefined' && options.body instanceof URLSearchParams;
  const isBlob = typeof Blob !== 'undefined' && options.body instanceof Blob;

  // Apenas define Content-Type: application/json se houver body presente e não for tipo especial
  if (options.body !== undefined && options.body !== null && !isFormData && !isUrlSearchParams && !isBlob) {
    headers['Content-Type'] = 'application/json';
  }

  // Mescla headers customizados informados na chamada
  if (options.headers) {
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      options.headers.forEach(([key, value]) => {
        headers[key] = value;
      });
    } else {
      Object.assign(headers, options.headers);
    }
  }

  const config: RequestInit = {
    ...options,
    credentials: 'include', // Obrigatório para cookies HTTP-only de sessão
    headers,
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
  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) => {
    const isSpecialBody =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
      (typeof Blob !== 'undefined' && body instanceof Blob) ||
      typeof body === 'string';

    return apiFetch<T>(endpoint, {
      ...options,
      method: 'POST',
      body: body !== undefined ? (isSpecialBody ? body : JSON.stringify(body)) : undefined,
    });
  },
  patch: <T = any>(endpoint: string, body?: any, options?: RequestInit) => {
    const isSpecialBody =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
      (typeof Blob !== 'undefined' && body instanceof Blob) ||
      typeof body === 'string';

    return apiFetch<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? (isSpecialBody ? body : JSON.stringify(body)) : undefined,
    });
  },
  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) => {
    const isSpecialBody =
      (typeof FormData !== 'undefined' && body instanceof FormData) ||
      (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
      (typeof Blob !== 'undefined' && body instanceof Blob) ||
      typeof body === 'string';

    return apiFetch<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? (isSpecialBody ? body : JSON.stringify(body)) : undefined,
    });
  },
  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    apiFetch<T>(endpoint, { ...options, method: 'DELETE' }),
};
