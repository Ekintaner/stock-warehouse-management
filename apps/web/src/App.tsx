import { useEffect, useState, type FormEvent } from "react";
import CatalogApp from "./CatalogApp.js";

interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";
  warehouseIds: string[];
}

interface AuthPayload {
  user: AuthenticatedUser;
  csrfToken: string;
}

type AppState =
  | { status: "loading" }
  | { status: "login"; message: string }
  | { status: "authenticated"; data: AuthPayload; message?: string }
  | { status: "unavailable"; message: string };

const API_TIMEOUT_MS = 5_000;

function parseAuthPayload(value: unknown): AuthPayload {
  if (
    typeof value !== "object" ||
    value === null ||
    !("user" in value) ||
    typeof value.user !== "object" ||
    value.user === null ||
    !("csrfToken" in value) ||
    typeof value.csrfToken !== "string"
  ) {
    throw new Error("Sunucu yanıtı doğrulanamadı.");
  }

  const user = value.user;
  if (
    !("id" in user) ||
    typeof user.id !== "string" ||
    !("username" in user) ||
    typeof user.username !== "string" ||
    !("displayName" in user) ||
    typeof user.displayName !== "string" ||
    !("role" in user) ||
    (user.role !== "ADMIN" &&
      user.role !== "WAREHOUSE_MANAGER" &&
      user.role !== "VIEWER") ||
    !("warehouseIds" in user) ||
    !Array.isArray(user.warehouseIds) ||
    !user.warehouseIds.every((id) => typeof id === "string")
  ) {
    throw new Error("Sunucu yanıtı doğrulanamadı.");
  }

  return {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      warehouseIds: user.warehouseIds,
    },
    csrfToken: value.csrfToken,
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      return body.error.message;
    }
  } catch {
    // A non-JSON error response uses the standard local connection message.
  }
  return "İstek tamamlanamadı. Tekrar deneyin.";
}

function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AppState>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      API_TIMEOUT_MS,
    );

    async function loadSession() {
      setState({ status: "loading" });
      try {
        const response = await fetch("/api/auth/session", {
          signal: controller.signal,
        });
        if (response.status === 401) {
          setState({ status: "login", message: "" });
          return;
        }
        if (!response.ok) {
          throw new Error(await readErrorMessage(response));
        }
        setState({
          status: "authenticated",
          data: parseAuthPayload(await response.json()),
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        if (!controller.signal.aborted) {
          setState({
            status: "unavailable",
            message:
              error instanceof Error && error.message !== "fetch failed"
                ? error.message
                : "Uygulamaya ulaşılamadı. Yerel geliştirme ortamını kontrol edip tekrar deneyin.",
          });
        } else {
          setState({
            status: "unavailable",
            message:
              "Sunucu zamanında yanıt vermedi. Backend'in çalıştığını kontrol edip tekrar deneyin.",
          });
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [attempt]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setState({ status: "login", message: "" });
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setState({ status: "login", message: await readErrorMessage(response) });
        return;
      }
      const data = parseAuthPayload(await response.json());
      setPassword("");
      setState({ status: "authenticated", data });
    } catch {
      setState({
        status: "login",
        message:
          "Giriş isteği tamamlanamadı. Bağlantıyı kontrol edip tekrar deneyin.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (state.status !== "authenticated") {
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": state.data.csrfToken },
      });
      if (!response.ok) {
        setState({
          status: "login",
          message: await readErrorMessage(response),
        });
        return;
      }
      setPassword("");
      setState({ status: "login", message: "Oturumunuz güvenle kapatıldı." });
    } catch {
      setState({
        status: "authenticated",
        data: state.data,
        message: "Çıkış yapılamadı. Bağlantıyı kontrol edip tekrar deneyin.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "authenticated") {
    return (
      <CatalogApp
        session={state.data}
        onLogout={handleLogout}
        loggingOut={submitting}
      />
    );
  }

  return (
    <main className="page">
      <section className="auth-panel" aria-labelledby="page-title">
        <h1 id="page-title">Stok ve Depo Yönetimi</h1>

        {state.status === "loading" && (
          <p className="status-message" role="status" aria-live="polite">
            Oturum kontrol ediliyor…
          </p>
        )}

        {state.status === "unavailable" && (
          <div className="form-content">
            <p className="status-message" role="status">
              {state.message}
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setAttempt((current) => current + 1)}
            >
              Tekrar dene
            </button>
          </div>
        )}

        {state.status === "login" && (
          <form className="form-content" onSubmit={handleLogin}>
            <div className="section-heading">
              <h2>Giriş yapın</h2>
              <p>Devam etmek için kullanıcı bilgilerinizi girin.</p>
            </div>
            <label htmlFor="username">Kullanıcı adı</label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              maxLength={64}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
            />
            <label htmlFor="password">Parola</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={1_024}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
            {state.message && (
              <p className="form-message" role="alert">
                {state.message}
              </p>
            )}
            <button
              className="primary-button"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Kontrol ediliyor…" : "Giriş yap"}
            </button>
          </form>
        )}

      </section>
    </main>
  );
}

export default App;
