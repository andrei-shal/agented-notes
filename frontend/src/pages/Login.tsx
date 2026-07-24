import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { initTelegram } from "../lib/telegram";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";

type PageMode = "checking" | "telegram" | "browser" | "dev";

export default function Login() {
  const [mode, setMode] = useState<PageMode>("checking");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initDataInput, setInitDataInput] = useState("");
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (useAuthStore.getState().isAuthenticated) {
      navigate("/notes", { replace: true });
    }
  }, [navigate]);

  // Shared auth handler: POST initData as raw form-encoded body
  const handleTelegramAuth = async (initData: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Authentication failed");
      }
      const data: { accessToken: string; user: { id: number; username: string } } =
        await response.json();
      login(data.accessToken, data.user);
      navigate("/notes", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  // Detect Telegram Web App on mount
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const info = await initTelegram();
        if (cancelled) return;

        if (info.isTelegram && info.initData) {
          setMode("telegram");
          await handleTelegramAuth(info.initData);
        } else if (info.isTelegram) {
          setError("Telegram context detected but no initData available");
          setMode("browser");
        } else {
          setMode("browser");
        }
      } catch {
        if (!cancelled) setMode("browser");
      }
    }

    detect();
    return () => {
      cancelled = true;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Configure Telegram Login Widget (browser mode)
  // eslint-disable-next-line @typescript-eslint/dot-notation
  const botUsername = import.meta.env["VITE_TELEGRAM_BOT_USERNAME"] as string | undefined;

  useEffect(() => {
    if (mode !== "browser" || !botUsername) return;

    // Global callback for the widget
    const authCallback = (user: Record<string, unknown>) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(user)) {
        if (value !== undefined && value !== null) {
          params.set(key, String(value));
        }
      }
      const initData = params.toString();
      if (initData) {
        handleTelegramAuth(initData);
      }
    };
    (window as unknown as Record<string, unknown>)["onTelegramAuth"] = authCallback;

    // Inject the widget script
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-lang", "en");

    if (widgetContainerRef.current) {
      widgetContainerRef.current.appendChild(script);
    }

    return () => {
      delete (window as unknown as Record<string, unknown>)["onTelegramAuth"];
      if (widgetContainerRef.current) {
        widgetContainerRef.current.innerHTML = "";
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, botUsername]);

  const handleInitDataSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!initDataInput.trim()) return;
    handleTelegramAuth(initDataInput.trim());
  };

  // -- Render --

  if (mode === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Initializing...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center">Agented Notes</CardTitle>
          {!loading && (
            <CardDescription className="text-center">
              {mode === "telegram"
                ? "Telegram Mini App"
                : "Sign in with Telegram"}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Loading spinner */}
          {loading && (
            <div className="flex flex-col items-center gap-2 py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <p className="text-sm text-muted-foreground">
                {mode === "telegram"
                  ? "Signing in via Telegram..."
                  : "Verifying..."}
              </p>
            </div>
          )}

          {/* Browser mode — widget + dev option */}
          {mode === "browser" && !loading && (
            <>
              {botUsername && (
                <div
                  ref={widgetContainerRef}
                  className="flex justify-center"
                />
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    {botUsername ? "Or continue with" : "Developer login"}
                  </span>
                </div>
              </div>

              <Button
                variant="outline"
                onClick={() => setMode("dev")}
              >
                Developer Login
              </Button>
            </>
          )}

          {/* Dev mode — manual initData input */}
          {mode === "dev" && !loading && (
            <form onSubmit={handleInitDataSubmit} className="flex flex-col gap-4">
              <Input
                placeholder="Paste initData raw query string"
                value={initDataInput}
                onChange={(e) => setInitDataInput(e.target.value)}
              />
              <Button type="submit" className="w-full" disabled={!initDataInput.trim()}>
                Sign in with initData
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setMode("browser")}
              >
                Back
              </Button>
            </form>
          )}

          {/* Telegram mode info (shown if auto-auth fails silently) */}
          {mode === "telegram" && !loading && !error && (
            <p className="text-center text-sm text-muted-foreground">
              Auto-authenticating...
            </p>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
