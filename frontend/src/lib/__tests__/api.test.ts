import { describe, it, expect, beforeEach, vi } from "vitest";
import { api, ApiError } from "../api";
import { useAuthStore } from "../../store/authStore";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
    });
    localStorage.clear();
  });

  it("api.get makes a GET request with correct headers", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: "ok" }),
    });

    const result = await api.get<{ data: string }>("/test");

    expect(mockFetch).toHaveBeenCalledWith("/api/test", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
    expect(result).toEqual({ data: "ok" });
  });

  it("api.post sends JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 1 }),
    });

    const result = await api.post<{ id: number }>("/items", { name: "foo" });

    expect(mockFetch).toHaveBeenCalledWith("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "foo" }),
    });
    expect(result).toEqual({ id: 1 });
  });

  it("api.put sends JSON body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ updated: true }),
    });

    const result = await api.put<{ updated: boolean }>("/items/1", { name: "bar" });

    expect(mockFetch).toHaveBeenCalledWith("/api/items/1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bar" }),
    });
    expect(result).toEqual({ updated: true });
  });

  it("api.delete makes a DELETE request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve(),
    });

    const result = await api.delete<void>("/items/1");

    expect(mockFetch).toHaveBeenCalledWith("/api/items/1", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
    expect(result).toBeUndefined();
  });

  it("includes Authorization header when token is set", async () => {
    useAuthStore.getState().login("my-jwt", { id: 1, username: "test" });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await api.get("/protected");

    expect(mockFetch).toHaveBeenCalledWith("/api/protected", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer my-jwt",
      },
      body: undefined,
    });
  });

  it("throws ApiError on non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Resource not found"),
    });

    await expect(api.get("/not-found")).rejects.toThrow(ApiError);
    await expect(api.get("/not-found")).rejects.toThrow("Resource not found");
  });

  it("throws ApiError with statusText when body is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
    });

    await expect(api.get("/error")).rejects.toThrow("Internal Server Error");
  });

  it("handles 204 No Content response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      json: () => Promise.resolve(),
    });

    const result = await api.get<void>("/empty");
    expect(result).toBeUndefined();
  });

  describe("401 refresh flow", () => {
    it("retries request on successful token refresh", async () => {
      useAuthStore.getState().login("expired-token", { id: 1, username: "test" });

      // First call returns 401, refresh succeeds, retry succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ token: "new-token", user: { id: 1, username: "test" } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: "retried" }),
        });

      const result = await api.get<{ data: string }>("/protected");

      // Should have called refresh endpoint
      expect(mockFetch).toHaveBeenNthCalledWith(2, "/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      // Token should be updated in store
      expect(useAuthStore.getState().token).toBe("new-token");

      // Retry should use new token
      expect(mockFetch).toHaveBeenNthCalledWith(3, "/api/protected", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer new-token",
        },
        body: undefined,
      });

      expect(result).toEqual({ data: "retried" });
    });

    it("logs out on failed refresh", async () => {
      useAuthStore.getState().login("expired-token", { id: 1, username: "test" });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Unauthorized"),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          text: () => Promise.resolve("Refresh failed"),
        });

      await expect(api.get("/protected")).rejects.toThrow("Session expired");

      // Should be logged out
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });
});
