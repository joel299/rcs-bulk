/// <reference types="vite/client" />

// Em produção usa VITE_API_URL; em dev usa proxy do Vite (url relativa)
const API_BASE = import.meta.env.VITE_API_URL ?? "";

export function useApi() {
  async function request(method: string, url: string, body?: any) {
    const fullUrl = `${API_BASE}${url}`;
    const res = await fetch(fullUrl, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? `Request failed: ${res.status}`);
    }

    if (res.status === 204) return null;
    return res.json();
  }

  return {
    get: (url: string) => request("GET", url),
    post: (url: string, body: any) => request("POST", url, body),
    patch: (url: string, body: any) => request("PATCH", url, body),
    del: (url: string) => request("DELETE", url),
  };
}
