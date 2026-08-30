"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowRight,
  Ban,
  Camera,
  ChevronLeft,
  Flag,
  LogOut,
  Pencil,
  Search,
  Send,
  Shuffle,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { t, type Lang } from "@/app/lib/i18n";
import { api, errMessage, type Conversation, type Message, type Profile } from "@/app/lib/api";

type Screen = "auth" | "setup" | "home" | "chat" | "random" | "profile" | "viewProfile";

const C = {
  bg: "#060a13",
  panel: "#0c1424",
  panel2: "#0e1830",
  border: "#1a2742",
  text: "#eaf1fb",
  muted: "#8ba1c7",
  blue: "#3b82f6",
  cyan: "#22d3ee",
  danger: "#f87171",
};

function Avatar({ photo, name, size = 40 }: { photo?: string; name?: string; size?: number }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        overflow: "hidden",
        background: "linear-gradient(135deg,#1e3a8a,#0891b2)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={name || ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "#fff", fontWeight: 700, fontSize: size * 0.4 }}>{initial}</span>
      )}
    </div>
  );
}

function AdminBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.5,
        lineHeight: 1,
        color: "#fff",
        background: "#dc2626",
        borderRadius: 4,
        padding: "3px 6px",
        flexShrink: 0,
      }}
    >
      ADMIN
    </span>
  );
}

function Glow() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        background:
          "radial-gradient(900px 500px at 80% -10%, rgba(59,130,246,.16), transparent 60%), radial-gradient(700px 420px at -10% 110%, rgba(34,211,238,.10), transparent 55%)",
      }}
    />
  );
}

function fileToThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 200;
        let w = img.width;
        let h = img.height;
        const scale = Math.min(max / w, max / h, 1);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const inputCls = `w-full rounded-xl border px-4 py-3 text-[15px] outline-none transition`;

function LangSelect({ onPick }: { onPick: (l: Lang) => void }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <Glow />
      <div
        className="relative w-full max-w-sm rounded-3xl p-8"
        style={{ background: `linear-gradient(180deg,${C.panel},${C.bg})`, border: `1px solid ${C.border}` }}
      >
        <div
          className="mx-auto mb-6 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Randep" className="h-full w-full object-cover" />
        </div>
        <h1
          className="text-center text-3xl font-bold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Randep
        </h1>
        <p className="mt-2 text-center text-sm" style={{ color: C.muted }}>
          Choose your language
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => onPick("en")}
            className="rounded-xl px-4 py-3.5 text-[15px] font-semibold text-white transition hover:brightness-110"
            style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
          >
            English
          </button>
          <button
            onClick={() => onPick("uz")}
            className="rounded-xl px-4 py-3.5 text-[15px] font-semibold text-white transition hover:brightness-110"
            style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}
          >
            O'zbekcha
          </button>
        </div>
        <button
          onClick={() => (window.location.href = "/admin")}
          className="mt-6 w-full text-center text-xs transition hover:opacity-70"
          style={{ color: C.muted }}
        >
          Admin
        </button>
      </div>
    </div>
  );
}

function AuthScreen({
  lang,
  onAuthed,
}: {
  lang: Lang;
  onAuthed: (token: string, profile: Profile, isNew: boolean) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const action = mode === "login" ? "login" : "register";
    const r = await api(action, { username, password });
    setBusy(false);
    if (r.ok) {
      onAuthed(r.token, r.profile, mode === "register");
    } else if (r.error === "banned") {
      const hrs = Math.max(1, Math.ceil((r.banned_ms || 0) / 3600000));
      const reasonPart = r.reason ? ` ${t(lang, "banReasonLabel")}: ${r.reason}` : "";
      setError(`${t(lang, "bannedByAdmin")} (${hrs} ${t(lang, "hours")}).${reasonPart}`);
    } else {
      setError(errMessage(lang, r.error || "unknown", t));
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6">
      <Glow />
      <div
        className="relative w-full max-w-sm rounded-3xl p-8"
        style={{ background: `linear-gradient(180deg,${C.panel},${C.bg})`, border: `1px solid ${C.border}` }}
      >
        <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {mode === "login" ? t(lang, "loginTitle") : t(lang, "registerTitle")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: C.muted }}>
          {mode === "login" ? t(lang, "loginSubtitle") : t(lang, "registerSubtitle")}
        </p>
        <form onSubmit={submit} className="mt-7 flex flex-col gap-3">
          <input
            className={inputCls}
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
            placeholder={t(lang, "username")}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            className={inputCls}
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
            placeholder={t(lang, "password")}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
          {error && <p className="text-sm" style={{ color: C.danger }}>{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl px-4 py-3.5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
          >
            {busy ? t(lang, "loading") : mode === "login" ? t(lang, "loginBtn") : t(lang, "registerBtn")}
          </button>
        </form>
        <button
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError("");
          }}
          className="mt-5 w-full text-center text-sm transition"
          style={{ color: C.cyan }}
        >
          {mode === "login" ? t(lang, "noAccount") : t(lang, "haveAccount")}
        </button>
      </div>
    </div>
  );
}

function SetupScreen({
  lang,
  token,
  onDone,
}: {
  lang: Lang;
  token: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async (skip: boolean) => {
    if (busy) return;
    setBusy(true);
    if (!skip) {
      await api("update_profile", { token, name, bio, photo });
    } else if (name || bio || photo) {
      await api("update_profile", { token, name, bio, photo });
    }
    setBusy(false);
    onDone();
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setPhoto(await fileToThumb(f));
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-6 py-10">
      <Glow />
      <div
        className="relative w-full max-w-sm rounded-3xl p-8"
        style={{ background: `linear-gradient(180deg,${C.panel},${C.bg})`, border: `1px solid ${C.border}` }}
      >
        <h2 className="text-2xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
          {t(lang, "profileSetupTitle")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: C.muted }}>
          {t(lang, "profileSetupSubtitle")}
        </p>

        <div className="mt-7 flex flex-col items-center gap-3">
          <div className="relative">
            <Avatar photo={photo} name={name || "?"} size={96} />
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border text-white transition"
              style={{ background: C.blue, borderColor: C.bg }}
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          {photo ? (
            <button onClick={() => setPhoto("")} className="text-xs" style={{ color: C.muted }}>
              {t(lang, "removePhoto")}
            </button>
          ) : (
            <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold" style={{ color: C.cyan }}>
              {t(lang, "uploadPhoto")}
            </button>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <input
            className={inputCls}
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text }}
            placeholder={t(lang, "yourName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
            style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, minHeight: 88, resize: "vertical" }}
            placeholder={t(lang, "bioPlaceholder")}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
          />
        </div>

        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={() => save(false)}
            disabled={busy}
            className="rounded-xl px-4 py-3.5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
          >
            {busy ? t(lang, "loading") : t(lang, "save")}
          </button>
          <button
            onClick={() => save(true)}
            disabled={busy}
            className="rounded-xl border px-4 py-3.5 text-[15px] font-semibold transition"
            style={{ borderColor: C.border, color: C.muted }}
          >
            {t(lang, "skip")}
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  lang,
  token,
  me,
  onOpenChat,
  onRandom,
  onProfile,
  onViewProfile,
}: {
  lang: Lang;
  token: string;
  me: Profile;
  onOpenChat: (u: Profile) => void;
  onRandom: () => void;
  onProfile: () => void;
  onViewProfile: (u: Profile) => void;
}) {
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api("get_conversations", { token });
      if (alive && r.ok) setConvs(r.conversations || []);
    };
    load();
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => {
        if (!alive) return;
        const r = await api("get_conversations", { token });
        if (alive && r.ok) setConvs(r.conversations || []);
        loop();
      }, 7000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const r = await api("search_users", { token, query });
      setResults(r.users || []);
      setSearching(false);
    }, 500);
    return () => clearTimeout(id);
  }, [query, token]);

  const deleteConversation = async (username: string) => {
    if (deleting) return;
    setDeleting(true);
    const r = await api("delete_chat", { token, target: username });
    setDeleting(false);
    if (r.ok) {
      setConvs((prev) => prev.filter((c) => c.username !== username));
      setConfirmDelete(null);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Glow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4">
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="Randep" className="h-full w-full object-cover" />
            </div>
            <span className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {t(lang, "appName")}
            </span>
          </div>
          <button onClick={onProfile} className="transition hover:opacity-80">
            <Avatar photo={me.photo} name={me.name || me.username} size={40} />
          </button>
        </header>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.muted }} />
          <input
            className={inputCls}
            style={{ background: C.panel, border: `1px solid ${C.border}`, color: C.text, paddingLeft: 42 }}
            placeholder={t(lang, "searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {query.trim() ? (
          <div className="mt-3 flex flex-col gap-2">
            {searching && <p className="px-1 text-sm" style={{ color: C.muted }}>{t(lang, "searching")}</p>}
            {!searching && results.length === 0 && (
              <p className="px-1 text-sm" style={{ color: C.muted }}>{t(lang, "noResults")}</p>
            )}
            {results.map((u) => (
              <div
                key={u.username}
                className="flex items-center gap-3 rounded-xl border p-3 transition hover:brightness-125"
                style={{ background: C.panel, borderColor: C.border }}
              >
                <button onClick={() => onViewProfile(u)} className="shrink-0">
                  <Avatar photo={u.photo} name={u.name || u.username} size={42} />
                </button>
                <button onClick={() => onOpenChat(u)} className="min-w-0 flex-1 text-left">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-semibold">{u.name || u.username}</p>
                    {u.is_admin && <AdminBadge />}
                  </div>
                  <p className="truncate text-sm" style={{ color: C.muted }}>@{u.username}</p>
                </button>
              </div>
            ))}
          </div>
        ) : (
          <section className="mt-4 flex-1">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: C.muted }}>
              {t(lang, "chats")}
            </h3>
            {convs.length === 0 ? (
              <p className="mt-6 text-center text-sm" style={{ color: C.muted }}>{t(lang, "noChats")}</p>
            ) : (
              <div className="flex flex-col gap-2 pb-6">
                {convs.map((c) => (
                  <div
                    key={c.username}
                    className="rounded-xl border p-3 transition hover:brightness-125"
                    style={{ background: C.panel, borderColor: C.border }}
                  >
                    <div className="flex items-center gap-3">
                      <button onClick={() => onViewProfile(c)} className="shrink-0">
                        <Avatar photo={c.photo} name={c.name || c.username} size={46} />
                      </button>
                      <button onClick={() => onOpenChat(c)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-semibold">{c.name || c.username}</p>
                          {c.is_admin && <AdminBadge />}
                        </div>
                        <p className="truncate text-sm" style={{ color: C.muted }}>{c.last_text}</p>
                      </button>
                      <button
                        onClick={() => setConfirmDelete(confirmDelete === c.username ? null : c.username)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition"
                        style={{ color: C.muted }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {confirmDelete === c.username && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg p-2" style={{ background: C.panel2 }}>
                        <p className="text-xs" style={{ color: C.muted }}>{t(lang, "deleteChatConfirm")}</p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                            style={{ color: C.muted }}
                          >
                            {t(lang, "cancel")}
                          </button>
                          <button
                            onClick={() => deleteConversation(c.username)}
                            disabled={deleting}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                            style={{ background: C.danger }}
                          >
                            {t(lang, "deleteChat")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="sticky bottom-0 -mx-4 border-t p-4" style={{ background: C.bg, borderColor: C.border }}>
          <button
            onClick={onRandom}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-[15px] font-semibold text-white transition hover:brightness-110"
            style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}
          >
            <Shuffle className="h-5 w-5" />
            {t(lang, "randomChat")}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewProfileScreen({
  lang,
  token,
  me,
  user,
  onBack,
  onBanned,
}: {
  lang: Lang;
  token: string;
  me: Profile;
  user: Profile;
  onBack: () => void;
  onBanned: (username: string) => void;
}) {
  const [banning, setBanning] = useState(false);
  const [banned, setBanned] = useState(false);
  const [showBanForm, setShowBanForm] = useState(false);
  const [banReason, setBanReason] = useState("");
  const canBan = me.is_admin && !user.is_admin && user.username !== me.username;

  const doBan = async () => {
    if (banning || banned) return;
    setBanning(true);
    const r = await api("ban_user", { token, target: user.username, text: banReason });
    setBanning(false);
    if (r.ok) {
      setBanned(true);
      onBanned(user.username);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Glow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4">
        <header className="flex items-center gap-3 border-b py-3" style={{ borderColor: C.border }}>
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg transition" style={{ background: C.panel }}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>{t(lang, "profile")}</h2>
        </header>

        <div className="flex flex-col items-center gap-3 py-8">
          <Avatar photo={user.photo} name={user.name || user.username} size={104} />
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <p className="text-xl font-bold">{user.name || user.username}</p>
              {user.is_admin && <AdminBadge />}
            </div>
            <p className="text-sm" style={{ color: C.muted }}>@{user.username}</p>
          </div>
          {user.bio && (
            <p className="max-w-xs text-center text-sm" style={{ color: C.muted }}>{user.bio}</p>
          )}
        </div>

        {canBan && (
          <div className="flex flex-col gap-3 pb-8">
            {!showBanForm ? (
              <button
                onClick={() => setShowBanForm(true)}
                disabled={banned}
                className="flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                style={{ borderColor: C.border, background: "linear-gradient(135deg,#f87171,#ef4444)" }}
              >
                <Ban className="h-4 w-4" />
                {banned ? t(lang, "userBanned") : t(lang, "banUser")}
              </button>
            ) : (
              <div className="rounded-xl border p-4" style={{ background: C.panel, borderColor: C.border }}>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">{t(lang, "banUser")}</p>
                  <button onClick={() => setShowBanForm(false)} style={{ color: C.muted }}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <textarea
                  className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
                  style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, minHeight: 80, resize: "vertical" }}
                  placeholder={t(lang, "banReasonPlaceholder")}
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
                <button
                  onClick={doBan}
                  disabled={banning}
                  className="mt-3 w-full rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg,#f87171,#ef4444)" }}
                >
                  {banning ? t(lang, "loading") : t(lang, "banUser")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatScreen({
  lang,
  token,
  me,
  other,
  onBack,
  onViewProfile,
}: {
  lang: Lang;
  token: string;
  me: Profile;
  other: Profile;
  onBack: () => void;
  onViewProfile: (u: Profile) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await api("get_messages", { token, to: other.username });
      if (alive && r.ok) setMessages(r.messages || []);
    };
    load();
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => {
        if (!alive) return;
        const r = await api("get_messages", { token, to: other.username });
        if (alive && r.ok) setMessages(r.messages || []);
        loop();
      }, 5000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, other.username]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    setMessages((m) => [...m, { from: me.username, text: v, ts: Date.now() }]);
    const r = await api("send_message", { token, to: other.username, text: v });
    if (r.ok) {
      const r2 = await api("get_messages", { token, to: other.username });
      if (r2.ok) setMessages(r2.messages || []);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Glow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4">
        <header className="flex items-center gap-3 border-b py-3" style={{ borderColor: C.border }}>
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg transition" style={{ background: C.panel }}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button onClick={() => onViewProfile(other)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <Avatar photo={other.photo} name={other.name || other.username} size={38} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-semibold">{other.name || other.username}</p>
                {other.is_admin && <AdminBadge />}
              </div>
              <p className="truncate text-xs" style={{ color: C.muted }}>@{other.username}</p>
            </div>
          </button>
        </header>

        <div ref={boxRef} className="flex-1 space-y-2 overflow-y-auto py-4">
          {messages.length === 0 && (
            <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>{t(lang, "startChat")}</p>
          )}
          {messages.map((m, i) => {
            const mine = m.from === me.username;
            return (
              <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px]"
                  style={
                    mine
                      ? { background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "#fff", borderBottomRightRadius: 6 }
                      : { background: C.panel, border: `1px solid ${C.border}`, borderBottomLeftRadius: 6 }
                  }
                >
                  {m.text}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 border-t py-3" style={{ borderColor: C.border }}>
          <input
            className="flex-1 rounded-xl border px-4 py-3 text-[15px] outline-none"
            style={{ background: C.panel, borderColor: C.border, color: C.text }}
            placeholder={t(lang, "typeMessage")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            onClick={send}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-white transition hover:brightness-110"
            style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function RandomScreen({ lang, token, me, onBack }: { lang: Lang; token: string; me: Profile; onBack: () => void }) {
  const [status, setStatus] = useState<"none" | "waiting" | "matched">("none");
  const [partner, setPartner] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    const join = async () => {
      const r = await api("random_join", { token });
      if (!alive) return;
      if (r.status === "matched") {
        setStatus("matched");
        const p = await api("get_profile", { username: r.partner });
        if (alive && p.ok) setPartner(p.profile);
      } else if (r.status === "waiting") {
        setStatus("waiting");
      }
    };
    join();
    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      timer = setTimeout(async () => {
        if (!alive) return;
        const s = await api("random_status", { token });
        if (!alive) return;
        if (s.status === "matched") {
          setStatus("matched");
          if (s.partner && !partner) {
            const p = await api("get_profile", { username: s.partner });
            if (alive && p.ok) setPartner(p.profile);
          }
          const m = await api("random_messages", { token });
          if (alive && m.ok) setMessages(m.messages || []);
        } else if (s.status === "waiting") {
          setStatus("waiting");
        }
        loop();
      }, 4000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [token, partner]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const v = text.trim();
    if (!v) return;
    setText("");
    setMessages((m) => [...m, { from: me.username, text: v, ts: Date.now() }]);
    await api("random_send", { token, text: v });
  };

  const next = async () => {
    setMessages([]);
    setPartner(null);
    setStatus("none");
    const r = await api("random_next", { token });
    if (r.status === "matched") {
      setStatus("matched");
      const p = await api("get_profile", { username: r.partner });
      if (p.ok) setPartner(p.profile);
    } else if (r.status === "waiting") {
      setStatus("waiting");
    }
  };

  const back = async () => {
    await api("random_leave", { token });
    onBack();
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Glow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4">
        <header className="flex items-center justify-between border-b py-3" style={{ borderColor: C.border }}>
          <button onClick={back} className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition" style={{ background: C.panel }}>
            <ChevronLeft className="h-4 w-4" /> {t(lang, "leaveRandom")}
          </button>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: C.cyan }}>
            <Shuffle className="h-4 w-4" /> {t(lang, "randomChat")}
          </div>
        </header>

        {status === "none" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: C.border, borderTopColor: C.cyan }} />
            <p className="text-sm" style={{ color: C.muted }}>{t(lang, "connecting")}</p>
          </div>
        )}

        {status === "waiting" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <div className="relative h-10 w-10">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40" style={{ background: C.cyan }} />
              <span className="relative inline-flex h-10 w-10 rounded-full" style={{ background: C.cyan }} />
            </div>
            <p className="text-sm" style={{ color: C.muted }}>{t(lang, "waiting")}</p>
          </div>
        )}

        {status === "matched" && (
          <>
            <div className="flex items-center gap-3 border-b py-3" style={{ borderColor: C.border }}>
              <Avatar photo={partner?.photo} name={partner?.name || partner?.username || "?"} size={38} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-semibold">{partner?.name || partner?.username || "..."}</p>
                  {partner?.is_admin && <AdminBadge />}
                </div>
                <p className="truncate text-xs" style={{ color: C.cyan }}>{t(lang, "connected")}</p>
              </div>
            </div>

            <div ref={boxRef} className="flex-1 space-y-2 overflow-y-auto py-4">
              {messages.length === 0 && (
                <p className="mt-8 text-center text-sm" style={{ color: C.muted }}>{t(lang, "startChat")}</p>
              )}
              {messages.map((m, i) => {
                const mine = m.from === me.username;
                return (
                  <div key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      className="max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[15px]"
                      style={
                        mine
                          ? { background: "linear-gradient(135deg,#0891b2,#0e7490)", color: "#fff", borderBottomRightRadius: 6 }
                          : { background: C.panel, border: `1px solid ${C.border}`, borderBottomLeftRadius: 6 }
                      }
                    >
                      {m.text}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 border-t py-3" style={{ borderColor: C.border }}>
              <input
                className="flex-1 rounded-xl border px-4 py-3 text-[15px] outline-none"
                style={{ background: C.panel, borderColor: C.border, color: C.text }}
                placeholder={t(lang, "typeMessage")}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
              />
              <button
                onClick={send}
                className="flex h-12 w-12 items-center justify-center rounded-xl text-white transition hover:brightness-110"
                style={{ background: "linear-gradient(135deg,#0891b2,#0e7490)" }}
              >
                <Send className="h-5 w-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 pb-4">
              <button
                onClick={back}
                className="flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition"
                style={{ borderColor: C.border, color: C.muted }}
              >
                {t(lang, "leaveRandom")}
              </button>
              <button
                onClick={next}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110"
                style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
              >
                {t(lang, "next")} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileScreen({
  lang,
  token,
  me,
  onBack,
  onLogout,
  onUpdate,
  onViewProfile,
}: {
  lang: Lang;
  token: string;
  me: Profile;
  onBack: () => void;
  onLogout: () => void;
  onUpdate: (p: Profile) => void;
  onViewProfile: (u: Profile) => void;
}) {
  const [complaining, setComplaining] = useState(false);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.name || "");
  const [bio, setBio] = useState(me.bio || "");
  const [photo, setPhoto] = useState(me.photo || "");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [showComplaints, setShowComplaints] = useState(false);
  const [complaints, setComplaints] = useState<{ from: string; target: string; text: string; ts: number }[]>([]);
  const [loadingComplaints, setLoadingComplaints] = useState(false);

  const [showSiteUsers, setShowSiteUsers] = useState(false);
  const [siteUsers, setSiteUsers] = useState<{ username: string; name: string; photo: string; last_seen: number; banned_ms: number }[]>([]);
  const [loadingSiteUsers, setLoadingSiteUsers] = useState(false);

  const startEdit = () => {
    setName(me.name || "");
    setBio(me.bio || "");
    setPhoto(me.photo || "");
    setSaveErr("");
    setEditing(true);
  };

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setPhoto(await fileToThumb(f));
    } catch {
      /* ignore */
    }
  };

  const saveProfile = async () => {
    if (saving) return;
    setSaving(true);
    setSaveErr("");
    const r = await api("update_profile", { token, name, bio, photo });
    setSaving(false);
    if (r.ok) {
      onUpdate(r.profile);
      setEditing(false);
    } else {
      setSaveErr(errMessage(lang, r.error, t));
    }
  };

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await api("submit_complaint", { token, target, text });
    setBusy(false);
    if (r.ok) {
      setSent(true);
      setText("");
      setTarget("");
      setTimeout(() => {
        setSent(false);
        setComplaining(false);
      }, 2000);
    }
  };

  const loadComplaints = async () => {
    if (loadingComplaints) return;
    setLoadingComplaints(true);
    const r = await api("my_complaints", { token });
    setLoadingComplaints(false);
    if (r.ok) {
      setComplaints(r.complaints || []);
      setShowComplaints(true);
    }
  };

  const loadSiteUsers = async () => {
    if (loadingSiteUsers) return;
    setLoadingSiteUsers(true);
    const r = await api("site_users", { token });
    setLoadingSiteUsers(false);
    if (r.ok) {
      setSiteUsers(r.users || []);
      setShowSiteUsers(true);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <Glow />
      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col px-4">
        <header className="flex items-center gap-3 border-b py-3" style={{ borderColor: C.border }}>
          <button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-lg transition" style={{ background: C.panel }}>
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-bold" style={{ fontFamily: "var(--font-display)" }}>{t(lang, "profile")}</h2>
        </header>

        {!editing ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Avatar photo={me.photo} name={me.name || me.username} size={104} />
            <div className="text-center">
              <div className="flex items-center justify-center gap-1.5">
                <p className="text-xl font-bold">{me.name || me.username}</p>
                {me.is_admin && <AdminBadge />}
              </div>
              <p className="text-sm" style={{ color: C.muted }}>@{me.username}</p>
            </div>
            {me.bio && (
              <p className="max-w-xs text-center text-sm" style={{ color: C.muted }}>{me.bio}</p>
            )}
            <button
              onClick={startEdit}
              className="mt-1 flex items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition"
              style={{ borderColor: C.border, color: C.cyan }}
            >
              <Pencil className="h-3.5 w-3.5" /> {t(lang, "editProfile")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="relative">
              <Avatar photo={photo} name={name || me.username} size={104} />
              <button
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border text-white transition"
                style={{ background: C.blue, borderColor: C.bg }}
              >
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickPhoto} />
            {photo ? (
              <button onClick={() => setPhoto("")} className="text-xs" style={{ color: C.muted }}>
                {t(lang, "removePhoto")}
              </button>
            ) : (
              <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold" style={{ color: C.cyan }}>
                {t(lang, "uploadPhoto")}
              </button>
            )}

            <div className="mt-2 w-full max-w-xs">
              <input
                className={inputCls}
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, marginBottom: 8 }}
                placeholder={t(lang, "namePlaceholder")}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <textarea
                className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, minHeight: 80, resize: "vertical" }}
                placeholder={t(lang, "bioPlaceholder")}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
              {saveErr && <p className="mt-2 text-sm" style={{ color: C.danger }}>{saveErr}</p>}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 rounded-xl border px-4 py-3 text-[15px] font-semibold transition"
                  style={{ borderColor: C.border, color: C.muted }}
                >
                  {t(lang, "cancel")}
                </button>
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="flex-1 rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg,#3b82f6,#2563eb)" }}
                >
                  {saving ? t(lang, "loading") : t(lang, "save")}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 pb-8">
          {!complaining ? (
            <button
              onClick={() => setComplaining(true)}
              className="flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-[15px] font-semibold transition"
              style={{ borderColor: C.border, color: C.danger }}
            >
              <Flag className="h-4 w-4" /> {t(lang, "complaint")}
            </button>
          ) : (
            <div className="rounded-xl border p-4" style={{ background: C.panel, borderColor: C.border }}>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">{t(lang, "complaintTitle")}</p>
                <button onClick={() => setComplaining(false)} style={{ color: C.muted }}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                className={inputCls}
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, marginBottom: 8 }}
                placeholder={t(lang, "complaintTarget")}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
              <textarea
                className="w-full rounded-xl border px-4 py-3 text-[15px] outline-none"
                style={{ background: C.panel2, border: `1px solid ${C.border}`, color: C.text, minHeight: 90, resize: "vertical" }}
                placeholder={t(lang, "complaintText")}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {sent && <p className="mt-2 text-sm" style={{ color: C.cyan }}>{t(lang, "complaintSent")}</p>}
              <button
                onClick={submit}
                disabled={busy}
                className="mt-3 w-full rounded-xl px-4 py-3 text-[15px] font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#f87171,#ef4444)" }}
              >
                {busy ? t(lang, "loading") : t(lang, "complaintSend")}
              </button>
            </div>
          )}

          {me.is_admin && (
            <div className="rounded-xl border" style={{ borderColor: C.border, background: C.panel }}>
              <button
                onClick={() => (showComplaints ? setShowComplaints(false) : loadComplaints())}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-[15px] font-semibold transition"
                style={{ color: C.text }}
              >
                <span className="flex items-center gap-2">
                  <Flag className="h-4 w-4" style={{ color: C.danger }} />
                  {t(lang, "complaints")}
                </span>
                <span className="text-xs" style={{ color: C.muted }}>
                  {loadingComplaints ? t(lang, "loading") : showComplaints ? "▲" : "▼"}
                </span>
              </button>
              {showComplaints && (
                <div className="flex flex-col gap-2 border-t px-4 py-3" style={{ borderColor: C.border }}>
                  {complaints.length === 0 ? (
                    <p className="py-2 text-center text-sm" style={{ color: C.muted }}>
                      {t(lang, "noComplaints")}
                    </p>
                  ) : (
                    complaints.map((c, i) => (
                      <div key={i} className="rounded-lg p-3" style={{ background: C.panel2 }}>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs" style={{ color: C.muted }}>
                          <span>{t(lang, "from")}: <strong style={{ color: C.text }}>{c.from}</strong></span>
                          {c.target && (
                            <span>{t(lang, "aboutUser")}: <strong style={{ color: C.text }}>{c.target}</strong></span>
                          )}
                          <span>{new Date(c.ts).toLocaleString()}</span>
                        </div>
                        <p className="mt-1.5 text-sm" style={{ color: C.text }}>{c.text}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          {me.is_admin && (
            <div className="rounded-xl border" style={{ borderColor: C.border, background: C.panel }}>
              <button
                onClick={() => (showSiteUsers ? setShowSiteUsers(false) : loadSiteUsers())}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-[15px] font-semibold transition"
                style={{ color: C.text }}
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" style={{ color: C.cyan }} />
                  {t(lang, "siteUsers")}
                </span>
                <span className="text-xs" style={{ color: C.muted }}>
                  {loadingSiteUsers ? t(lang, "loading") : showSiteUsers ? "▲" : "▼"}
                </span>
              </button>
              {showSiteUsers && (
                <div className="flex flex-col gap-2 border-t px-4 py-3" style={{ borderColor: C.border }}>
                  {siteUsers.length === 0 ? (
                    <p className="py-2 text-center text-sm" style={{ color: C.muted }}>
                      {t(lang, "noSiteUsers")}
                    </p>
                  ) : (
                    siteUsers.map((u) => (
                      <div
                        key={u.username}
                        className="flex items-center gap-3 rounded-lg p-2.5"
                        style={{ background: C.panel2 }}
                      >
                        <button
                          onClick={() => onViewProfile({ username: u.username, name: u.name, bio: "", photo: u.photo, is_admin: false })}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Avatar photo={u.photo} name={u.name || u.username} size={38} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{u.name || u.username}</p>
                            <p className="truncate text-xs" style={{ color: C.muted }}>
                              {u.banned_ms > 0
                                ? `${t(lang, "bannedUntil")} ${Math.ceil(u.banned_ms / 3600000)} ${t(lang, "hours")}`
                                : u.last_seen
                                ? `${t(lang, "lastSeen")}: ${new Date(u.last_seen).toLocaleString()}`
                                : ""}
                            </p>
                          </div>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={onLogout}
            className="flex items-center justify-center gap-2 rounded-xl border px-4 py-3.5 text-[15px] font-semibold transition"
            style={{ borderColor: C.border, color: C.muted }}
          >
            <LogOut className="h-4 w-4" /> {t(lang, "logout")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [ready, setReady] = useState(false);
  const [lang, setLang] = useState<Lang | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [screen, setScreen] = useState<Screen>("home");
  const [activeChat, setActiveChat] = useState<Profile | null>(null);
  const [viewingUser, setViewingUser] = useState<Profile | null>(null);
  const [prevScreen, setPrevScreen] = useState<Screen>("home");

  useEffect(() => {
    const l = localStorage.getItem("rc_lang");
    if (l === "en" || l === "uz") setLang(l);
    const tk = localStorage.getItem("rc_token");
    if (tk) {
      setToken(tk);
      api("me", { token: tk }).then((r) => {
        if (r.ok) {
          setMe(r.profile);
          setScreen("home");
        } else {
          localStorage.removeItem("rc_token");
        }
      });
    }
    setReady(true);
  }, []);

  const pickLang = (l: Lang) => {
    setLang(l);
    localStorage.setItem("rc_lang", l);
  };

  const authed = (tk: string, profile: Profile, isNew: boolean) => {
    setToken(tk);
    setMe(profile);
    localStorage.setItem("rc_token", tk);
    setScreen(isNew ? "setup" : "home");
  };

  const logout = () => {
    setToken(null);
    setMe(null);
    setActiveChat(null);
    localStorage.removeItem("rc_token");
    setScreen("home");
  };

  if (!ready) {
    return <div className="min-h-screen" style={{ background: C.bg }} />;
  }

  if (!lang) {
    return <LangSelect onPick={pickLang} />;
  }

  if (!token || !me) {
    return <AuthScreen lang={lang} onAuthed={authed} />;
  }

  if (screen === "setup") {
    return <SetupScreen lang={lang} token={token} onDone={() => setScreen("home")} />;
  }

  if (screen === "chat" && activeChat) {
    return (
      <ChatScreen
        lang={lang}
        token={token}
        me={me}
        other={activeChat}
        onBack={() => {
          setActiveChat(null);
          setScreen("home");
        }}
        onViewProfile={(u) => {
          setViewingUser(u);
          setPrevScreen("chat");
          setScreen("viewProfile");
        }}
      />
    );
  }

  if (screen === "viewProfile" && viewingUser) {
    return (
      <ViewProfileScreen
        lang={lang}
        token={token}
        me={me}
        user={viewingUser}
        onBack={() => {
          setViewingUser(null);
          setScreen(prevScreen);
        }}
        onBanned={() => {
          setViewingUser(null);
          setScreen(prevScreen);
        }}
      />
    );
  }

  if (screen === "random") {
    return <RandomScreen lang={lang} token={token} me={me} onBack={() => setScreen("home")} />;
  }

  if (screen === "profile") {
    return (
      <ProfileScreen
        lang={lang}
        token={token}
        me={me}
        onBack={() => setScreen("home")}
        onLogout={logout}
        onUpdate={(p) => setMe(p)}
        onViewProfile={(u) => {
          setViewingUser(u);
          setPrevScreen("profile");
          setScreen("viewProfile");
        }}
      />
    );
  }

  return (
    <HomeScreen
      lang={lang}
      token={token}
      me={me}
      onOpenChat={(u) => {
        setActiveChat(u);
        setScreen("chat");
      }}
      onRandom={() => setScreen("random")}
      onProfile={() => setScreen("profile")}
      onViewProfile={(u) => {
        setViewingUser(u);
        setPrevScreen("home");
        setScreen("viewProfile");
      }}
    />
  );
}
