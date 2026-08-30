"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { t, type Lang } from "@/app/lib/i18n";
import { api } from "@/app/lib/api";

const C = {
  bg: "#060a13",
  panel: "#0c1424",
  border: "#1a2742",
  text: "#eaf1fb",
  muted: "#8ba1c7",
  cyan: "#22d3ee",
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPage() {
  const [lang, setLang] = useState<Lang>("uz");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const l = localStorage.getItem("rc_lang");
    if (l === "en" || l === "uz") setLang(l);
  }, []);

  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await api("admin_login", { admin_username: username, password });
    setBusy(false);
    if (r.ok) {
      setAdminToken(r.admin_token);
      load(r.admin_token);
    } else {
      setError(t(lang, "err_invalid_credentials"));
    }
  };

  const load = async (tk: string) => {
    const r = await api("admin_complaints", { admin_token: tk });
    if (r.ok) setComplaints(r.complaints || []);
  };

  const logout = () => {
    setAdminToken(null);
    setPassword("");
    setComplaints([]);
  };

  return (
    <div
      className="min-h-screen px-4 py-8"
      style={{
        background:
          "radial-gradient(900px 500px at 80% -10%, rgba(59,130,246,.16), transparent 60%), #060a13",
        color: C.text,
      }}
    >
      <div className="mx-auto w-full max-w-lg">
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "linear-gradient(135deg,#3b82f6,#22d3ee)" }}>
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {t(lang, "adminTitle")}
            </h1>
          </div>
          <div className="flex items-center gap-1 text-xs" style={{ color: C.muted }}>
            <button
              onClick={() => setLang(lang === "uz" ? "en" : "uz")}
              className="rounded-md px-2 py-1 transition"
              style={{ background: C.panel, border: `1px solid ${C.border}` }}
            >
              {lang === "uz" ? "EN" : "O'Z"}
            </button>
          </div>
        </header>

        {!adminToken ? (
          <form onSubmit={login} className="rounded-2xl border p-6" style={{ background: C.panel, borderColor: C.border }}>
            <p className="mb-4 text-sm" style={{ color: C.muted }}>{t(lang, "adminPassword")}</p>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="mb-3 w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
              style={{ background: "#0e1830", border: `1px solid ${C.border}`, color: C.text }}
              placeholder={t(lang, "adminUsername")}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
              style={{ background: "#0e1830", border: `1px solid ${C.border}`, color: C.text }}
              placeholder={t(lang, "adminPassword")}
            />
            {error && <p className="mt-3 text-sm" style={{ color: "#f87171" }}>{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="mt-4 w-full rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
            >
              {busy ? t(lang, "loading") : t(lang, "adminLogin")}
            </button>
          </form>
        ) : (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{t(lang, "complaints")}</h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => load(adminToken)}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition"
                  style={{ background: C.panel, border: `1px solid ${C.border}` }}
                >
                  <RefreshCw className="h-4 w-4" /> {t(lang, "refresh")}
                </button>
                <button
                  onClick={logout}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition"
                  style={{ background: C.panel, border: `1px solid ${C.border}`, color: "#f87171" }}
                >
                  <LogOut className="h-4 w-4" /> {t(lang, "logoutAdmin")}
                </button>
              </div>
            </div>

            {complaints.length === 0 ? (
              <p className="mt-10 text-center text-sm" style={{ color: C.muted }}>{t(lang, "noComplaints")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {complaints.map((c, i) => (
                  <div key={i} className="rounded-2xl border p-4" style={{ background: C.panel, borderColor: C.border }}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <span style={{ color: C.muted }}>{t(lang, "from")}:</span> <span className="font-semibold">@{c.from}</span>
                      </div>
                      <span className="text-xs" style={{ color: C.muted }}>{fmtTime(c.ts)}</span>
                    </div>
                    {c.target && (
                      <div className="mb-1 text-sm">
                        <span style={{ color: C.muted }}>{t(lang, "aboutUser")}:</span> <span className="font-semibold">@{c.target}</span>
                      </div>
                    )}
                    <p className="mt-2 text-[15px]" style={{ color: C.text }}>{c.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
