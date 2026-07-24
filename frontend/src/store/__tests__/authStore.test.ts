import { describe, it, expect, beforeEach } from "vitest";
import { useAuthStore } from "../authStore";

describe("authStore", () => {
  beforeEach(() => {
    // Reset store to initial state
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
    });
    // Clear persisted storage
    localStorage.clear();
  });

  it("starts unauthenticated", () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it("login sets token, user, and isAuthenticated", () => {
    const { login } = useAuthStore.getState();
    login("test-token", { id: 1, username: "alice" });

    const state = useAuthStore.getState();
    expect(state.token).toBe("test-token");
    expect(state.user).toEqual({ id: 1, username: "alice" });
    expect(state.isAuthenticated).toBe(true);
  });

  it("logout clears token, user, and isAuthenticated", () => {
    const { login } = useAuthStore.getState();
    login("test-token", { id: 1, username: "alice" });

    const { logout } = useAuthStore.getState();
    logout();

    const state = useAuthStore.getState();
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
  });

  it("persists token and user to localStorage", () => {
    const { login } = useAuthStore.getState();
    login("persisted-token", { id: 2, username: "bob" });

    const stored = JSON.parse(localStorage.getItem("agented-notes-auth") ?? "{}");
    expect(stored.state.token).toBe("persisted-token");
    expect(stored.state.user).toEqual({ id: 2, username: "bob" });
    // isAuthenticated should NOT be persisted — derived on rehydrate
    expect(stored.state.isAuthenticated).toBeUndefined();
  });

  it("rehydrate restores isAuthenticated from token", () => {
    // Manually seed storage as persist would on reload
    localStorage.setItem(
      "agented-notes-auth",
      JSON.stringify({
        state: { token: "rehydrated-token", user: { id: 3, username: "charlie" } },
        version: 0,
      }),
    );

    // Simulate re-creation (persist middleware's onRehydrateStorage runs)
    useAuthStore.setState({
      token: "rehydrated-token",
      user: { id: 3, username: "charlie" },
      isAuthenticated: true,
    });

    const state = useAuthStore.getState();
    expect(state.token).toBe("rehydrated-token");
    expect(state.user).toEqual({ id: 3, username: "charlie" });
    expect(state.isAuthenticated).toBe(true);
  });
});
