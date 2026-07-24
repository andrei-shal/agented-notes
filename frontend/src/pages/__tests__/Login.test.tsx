import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Login from "../Login";
import { useAuthStore } from "../../store/authStore";

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

// Mock initTelegram so we control TMA environment per test
const mockInitTelegram = vi.fn();
vi.mock("../../lib/telegram", () => ({
  initTelegram: () => mockInitTelegram(),
}));

// Mock fetch for API calls
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/notes" element={<div>Notes Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Common non-TGA response from initTelegram */
const NOT_TELEGRAM = {
  isTelegram: false,
  initData: null,
  theme: "light" as const,
  viewportHeight: null,
  viewportStableHeight: null,
};

/** Successful auth API response factory */
function authSuccess() {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        accessToken: "tg-token-abc",
        user: { id: 1, username: "telegram_user" },
      }),
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      token: null,
      isAuthenticated: false,
    });
    localStorage.clear();
  });

  describe("TMA auto-auth", () => {
    it("auto-authenticates with initData when inside Telegram Web App", async () => {
      mockInitTelegram.mockResolvedValue({
        isTelegram: true,
        initData: "query_id=AAChash&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22John%22%7D&auth_date=1700000000&hash=abc123",
        theme: "dark",
        viewportHeight: 800,
        viewportStableHeight: 780,
      });
      mockFetch.mockResolvedValueOnce(authSuccess());

      renderLogin();

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
      });

      expect(useAuthStore.getState().token).toBe("tg-token-abc");
      expect(useAuthStore.getState().user).toEqual({
        id: 1,
        username: "telegram_user",
      });

      // initData must be sent as raw form-encoded body, NOT JSON
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "query_id=AAChash&user=%7B%22id%22%3A1%2C%22first_name%22%3A%22John%22%7D&auth_date=1700000000&hash=abc123",
      });

      // Should redirect to /notes
      await waitFor(() => {
        expect(screen.getByText("Notes Page")).toBeInTheDocument();
      });
    });

    it("shows error when Telegram API fails", async () => {
      mockInitTelegram.mockResolvedValue({
        isTelegram: true,
        initData: "hash=invalid",
        theme: "dark",
        viewportHeight: 800,
        viewportStableHeight: 780,
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Invalid initData"),
      });

      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Invalid initData")).toBeInTheDocument();
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("shows browser mode when TMA detected but no initData", async () => {
      mockInitTelegram.mockResolvedValue({
        isTelegram: true,
        initData: null,
        theme: "dark",
        viewportHeight: 800,
        viewportStableHeight: 780,
      });

      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      // Error message should explain
      expect(
        screen.getByText(
          "Telegram context detected but no initData available",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("browser mode", () => {
    beforeEach(() => {
      mockInitTelegram.mockResolvedValue(NOT_TELEGRAM);
    });

    it("shows developer login option when not in Telegram", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      expect(screen.getByText("Sign in with Telegram")).toBeInTheDocument();
    });

    it("switches to dev mode on developer login click", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Developer Login"));

      expect(
        screen.getByPlaceholderText(/initData raw query string/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Sign in with initData/ }),
      ).toBeInTheDocument();
    });

    it("submits initData from dev mode and authenticates", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Developer Login"));

      const input = screen.getByPlaceholderText(/initData raw query string/);
      await user.type(input, "user=%7B%22id%22%3A1%7D&hash=abc");

      mockFetch.mockResolvedValueOnce(authSuccess());

      await user.click(screen.getByRole("button", { name: /Sign in with initData/ }));

      await waitFor(() => {
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
      });

      expect(useAuthStore.getState().token).toBe("tg-token-abc");
      expect(mockFetch).toHaveBeenCalledWith("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "user=%7B%22id%22%3A1%7D&hash=abc",
      });

      // Redirect
      expect(screen.getByText("Notes Page")).toBeInTheDocument();
    });

    it("shows error on failed dev mode auth", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Developer Login"));

      const input = screen.getByPlaceholderText(/initData raw query string/);
      await user.type(input, "hash=bad");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });

      await user.click(screen.getByRole("button", { name: /Sign in with initData/ }));

      await waitFor(() => {
        expect(screen.getByText("Forbidden")).toBeInTheDocument();
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it("disables submit button when initData input is empty", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Developer Login"));

      const submitButton = screen.getByRole("button", {
        name: /Sign in with initData/,
      });
      expect(submitButton).toBeDisabled();
    });

    it("returns to browser mode from dev mode via back button", async () => {
      renderLogin();

      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });

      const user = userEvent.setup();
      await user.click(screen.getByText("Developer Login"));

      // Should see back button
      await user.click(screen.getByText("Back"));

      // Back in browser mode
      await waitFor(() => {
        expect(screen.getByText("Developer Login")).toBeInTheDocument();
      });
    });
  });

  describe("already authenticated", () => {
    it("redirects to /notes when already logged in", () => {
      useAuthStore.setState({
        user: { id: 1, username: "test" },
        token: "existing-token",
        isAuthenticated: true,
      });

      renderLogin();

      expect(screen.getByText("Notes Page")).toBeInTheDocument();
    });
  });
});
