"""
Randap - self-hosted backend (FastAPI + SQLite).
No CodeWords dependency, no run limits.

Run:
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8000

Environment variables:
    ADMIN_PASSWORD      (required) - admin panel password
    ADMIN_USERNAME      (optional) - username that gets the red ADMIN badge
    DB_PATH             (optional) - SQLite file path (default: mychat.db)
    PORT                (optional) - port (default: 8000)
    VAPID_PUBLIC_KEY    (optional) - enables web push notifications
    VAPID_PRIVATE_KEY   (optional) - enables web push notifications
    VAPID_CLAIM_EMAIL   (optional) - contact email for push service, default mailto:admin@example.com
"""
import base64
import hashlib
import json
import os
import secrets
import sqlite3
import time

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = os.environ.get("DB_PATH", "mychat.db")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_CLAIM_EMAIL = os.environ.get("VAPID_CLAIM_EMAIL", "mailto:admin@example.com")

app = FastAPI(title="Randap API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            salt TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            bio TEXT NOT NULL DEFAULT '',
            photo TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pair TEXT NOT NULL,
            from_user TEXT NOT NULL,
            text TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
            username TEXT NOT NULL,
            other TEXT NOT NULL,
            last_ts INTEGER NOT NULL,
            PRIMARY KEY (username, other)
        );
        CREATE TABLE IF NOT EXISTS pool (
            username TEXT PRIMARY KEY,
            join_ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS random_matches (
            username TEXT PRIMARY KEY,
            partner TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS random_msgs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pair TEXT NOT NULL,
            from_user TEXT NOT NULL,
            text TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_user TEXT NOT NULL,
            target TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS admin_token (
            token TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS online (
            username TEXT PRIMARY KEY,
            last_seen INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS banned (
            username TEXT PRIMARY KEY,
            until_ts INTEGER NOT NULL,
            reason TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS push_subs (
            username TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            PRIMARY KEY (username, endpoint)
        );
        """
    )
    conn.commit()
    conn.close()


def ensure_admin_user() -> None:
    """Create/update the configured admin account so its username is reserved."""
    if not ADMIN_USERNAME or not ADMIN_PASSWORD:
        return
    username = clean_username(ADMIN_USERNAME)
    if len(username) < 3:
        return
    conn = get_conn()
    try:
        row = conn.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
        salt, h = hash_password(ADMIN_PASSWORD)
        if row:
            conn.execute(
                "UPDATE users SET salt = ?, password_hash = ? WHERE username = ?",
                (salt, h, username),
            )
        else:
            conn.execute(
                "INSERT INTO users(username, salt, password_hash, name, bio, photo, created_at) VALUES(?, ?, ?, ?, ?, '', ?)",
                (username, salt, h, "Admin", "Randap administrator", now_ms()),
            )
        conn.commit()
    finally:
        conn.close()


def now_ms() -> int:
    return int(time.time() * 1000)


def pair(a: str, b: str) -> str:
    return "|".join(sorted([a, b]))


def hash_password(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode("utf-8")).hexdigest()
    return salt, h


def clean_username(u):
    if not u:
        return ""
    return "".join(ch for ch in u.strip().lower() if ch.isalnum() or ch == "_")


def is_admin_user(username: str) -> bool:
    return bool(ADMIN_USERNAME) and clean_username(username) == clean_username(ADMIN_USERNAME)


def ban_remaining_ms(conn, username: str) -> int:
    row = conn.execute("SELECT until_ts FROM banned WHERE username = ?", (username,)).fetchone()
    if not row:
        return 0
    remaining = row["until_ts"] - now_ms()
    if remaining <= 0:
        conn.execute("DELETE FROM banned WHERE username = ?", (username,))
        conn.commit()
        return 0
    return remaining


def ban_info(conn, username: str):
    """Returns (remaining_ms, reason). Cleans up expired bans."""
    row = conn.execute("SELECT until_ts, reason FROM banned WHERE username = ?", (username,)).fetchone()
    if not row:
        return 0, ""
    remaining = row["until_ts"] - now_ms()
    if remaining <= 0:
        conn.execute("DELETE FROM banned WHERE username = ?", (username,))
        conn.commit()
        return 0, ""
    return remaining, row["reason"] or ""


class Request(BaseModel):
    action: str = Field(..., description="Action to perform")
    username: str | None = None
    password: str | None = None
    name: str | None = None
    bio: str | None = None
    photo: str | None = None
    query: str | None = None
    to: str | None = None
    text: str | None = None
    target: str | None = None
    token: str | None = None
    admin_token: str | None = None
    admin_username: str | None = None
    endpoint: str | None = None
    p256dh: str | None = None
    auth: str | None = None


def touch_online(conn, username: str) -> None:
    conn.execute(
        "INSERT INTO online(username, last_seen) VALUES(?, ?) "
        "ON CONFLICT(username) DO UPDATE SET last_seen = excluded.last_seen",
        (username, now_ms()),
    )
    conn.commit()


def resolve_user(conn, token):
    if not token:
        return None
    row = conn.execute("SELECT username FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return None
    u = row["username"]
    if ban_remaining_ms(conn, u) > 0:
        return None
    touch_online(conn, u)
    return u


def get_profile(conn, username: str) -> dict:
    row = conn.execute("SELECT username, name, bio, photo FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return {"username": username, "name": "", "bio": "", "photo": "", "is_admin": is_admin_user(username)}
    return {
        "username": row["username"],
        "name": row["name"],
        "bio": row["bio"],
        "photo": row["photo"],
        "is_admin": is_admin_user(username),
    }


def do_register(conn, req):
    username = clean_username(req.username)
    password = req.password or ""
    if len(username) < 3:
        return {"ok": False, "error": "username_too_short"}
    if len(password) < 4:
        return {"ok": False, "error": "password_too_short"}
    row = conn.execute("SELECT username FROM users WHERE username = ?", (username,)).fetchone()
    if row:
        return {"ok": False, "error": "username_taken"}
    salt, h = hash_password(password)
    conn.execute(
        "INSERT INTO users(username, salt, password_hash, name, bio, photo, created_at) VALUES(?, ?, ?, '', '', '', ?)",
        (username, salt, h, now_ms()),
    )
    token = secrets.token_hex(24)
    conn.execute("INSERT INTO sessions(token, username) VALUES(?, ?)", (token, username))
    touch_online(conn, username)
    conn.commit()
    return {"ok": True, "token": token, "profile": get_profile(conn, username)}


def do_login(conn, req):
    username = clean_username(req.username)
    password = req.password or ""
    row = conn.execute("SELECT salt, password_hash FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return {"ok": False, "error": "invalid_credentials"}
    h = hashlib.sha256((row["salt"] + password).encode("utf-8")).hexdigest()
    if h != row["password_hash"]:
        return {"ok": False, "error": "invalid_credentials"}
    remaining, reason = ban_info(conn, username)
    if remaining > 0:
        return {"ok": False, "error": "banned", "banned_ms": remaining, "reason": reason}
    token = secrets.token_hex(24)
    conn.execute("INSERT INTO sessions(token, username) VALUES(?, ?)", (token, username))
    touch_online(conn, username)
    conn.commit()
    return {"ok": True, "token": token, "profile": get_profile(conn, username)}


def do_update_profile(conn, username, name, bio, photo):
    updates, params = [], []
    if name is not None:
        updates.append("name = ?")
        params.append((name or "")[:60])
    if bio is not None:
        updates.append("bio = ?")
        params.append((bio or "")[:300])
    if photo is not None:
        if len(photo) > 300000:
            return {"ok": False, "error": "photo_too_large"}
        updates.append("photo = ?")
        params.append(photo)
    if updates:
        params.append(username)
        conn.execute("UPDATE users SET " + ", ".join(updates) + " WHERE username = ?", params)
        conn.commit()
    return {"ok": True, "profile": get_profile(conn, username)}


def do_search_users(conn, username, query):
    q = (query or "").strip().lower()
    if q:
        rows = conn.execute(
            "SELECT username, name, photo FROM users WHERE username != ? AND (lower(username) LIKE ? OR lower(name) LIKE ?) LIMIT 30",
            (username, "%" + q + "%", "%" + q + "%"),
        ).fetchall()
    else:
        rows = conn.execute("SELECT username, name, photo FROM users WHERE username != ? LIMIT 30", (username,)).fetchall()
    return [
        {"username": r["username"], "name": r["name"], "photo": r["photo"], "is_admin": is_admin_user(r["username"])}
        for r in rows
    ]


def _b64url_decode(s: str) -> bytes:
    s = s + "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _vapid_private_key():
    from cryptography.hazmat.primitives.asymmetric import ec
    raw = _b64url_decode(VAPID_PRIVATE_KEY)
    priv_int = int.from_bytes(raw, "big")
    return ec.derive_private_key(priv_int, ec.SECP256R1())


def _vapid_headers(endpoint: str) -> dict:
    import jwt as pyjwt
    from urllib.parse import urlparse
    parsed = urlparse(endpoint)
    aud = f"{parsed.scheme}://{parsed.netloc}"
    token = pyjwt.encode(
        {"aud": aud, "exp": int(time.time()) + 12 * 3600, "sub": VAPID_CLAIM_EMAIL},
        _vapid_private_key(),
        algorithm="ES256",
    )
    if isinstance(token, bytes):
        token = token.decode()
    return {"Authorization": f"vapid t={token}, k={VAPID_PUBLIC_KEY}"}


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def _encrypt_push_payload(p256dh_b64: str, auth_b64: str, plaintext: bytes) -> bytes:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    ua_public_bytes = _b64url_decode(p256dh_b64)
    auth_secret = _b64url_decode(auth_b64)
    ua_public_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_public_bytes)

    as_private = ec.generate_private_key(ec.SECP256R1())
    as_public_bytes = as_private.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    shared_secret = as_private.exchange(ec.ECDH(), ua_public_key)

    ikm = _hkdf(
        salt=auth_secret,
        ikm=shared_secret,
        info=b"WebPush: info\x00" + ua_public_bytes + as_public_bytes,
        length=32,
    )

    salt16 = os.urandom(16)
    cek = _hkdf(salt=salt16, ikm=ikm, info=b"Content-Encoding: aes128gcm\x00", length=16)
    nonce = _hkdf(salt=salt16, ikm=ikm, info=b"Content-Encoding: nonce\x00", length=12)

    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    rs = 4096
    header = salt16 + rs.to_bytes(4, "big") + len(as_public_bytes).to_bytes(1, "big") + as_public_bytes
    return header + ciphertext


def notify_user(conn, username, title, body, extra=None):
    """Best-effort web push notification. Never raises - failures are silently ignored
    so a broken/expired subscription never breaks message sending."""
    if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
        return
    rows = conn.execute("SELECT endpoint, p256dh, auth FROM push_subs WHERE username = ?", (username,)).fetchall()
    if not rows:
        return
    payload = {"title": title, "body": body}
    if extra:
        payload.update(extra)
    payload_bytes = json.dumps(payload).encode("utf-8")
    dead = []
    for r in rows:
        try:
            body_bytes = _encrypt_push_payload(r["p256dh"], r["auth"], payload_bytes)
            headers = _vapid_headers(r["endpoint"])
            headers.update({
                "Content-Type": "application/octet-stream",
                "Content-Encoding": "aes128gcm",
                "TTL": "60",
            })
            resp = requests.post(r["endpoint"], data=body_bytes, headers=headers, timeout=8)
            if resp.status_code in (404, 410):
                dead.append(r["endpoint"])
        except Exception:
            pass
    for ep in dead:
        conn.execute("DELETE FROM push_subs WHERE endpoint = ?", (ep,))
    if dead:
        conn.commit()


def do_send_message(conn, username, to, text):
    to = clean_username(to)
    if not to or to == username:
        return {"ok": False, "error": "invalid_target"}
    row = conn.execute("SELECT username FROM users WHERE username = ?", (to,)).fetchone()
    if not row:
        return {"ok": False, "error": "user_not_found"}
    ts = now_ms()
    p = pair(username, to)
    conn.execute("INSERT INTO messages(pair, from_user, text, ts) VALUES(?, ?, ?, ?)", (p, username, text or "", ts))
    conn.execute(
        "INSERT INTO chats(username, other, last_ts) VALUES(?, ?, ?) ON CONFLICT(username, other) DO UPDATE SET last_ts = excluded.last_ts",
        (username, to, ts),
    )
    conn.execute(
        "INSERT INTO chats(username, other, last_ts) VALUES(?, ?, ?) ON CONFLICT(username, other) DO UPDATE SET last_ts = excluded.last_ts",
        (to, username, ts),
    )
    conn.commit()
    sender = get_profile(conn, username)
    snippet = (text or "")[:120]
    notify_user(conn, to, sender.get("name") or sender.get("username"), snippet, {
        "from_username": sender.get("username"),
        "from_name": sender.get("name"),
        "from_photo": sender.get("photo"),
        "url": "/",
    })
    return {"ok": True}


def do_get_conversations(conn, username):
    rows = conn.execute("SELECT other FROM chats WHERE username = ? ORDER BY last_ts DESC", (username,)).fetchall()
    out = []
    for r in rows:
        other = r["other"]
        prof = get_profile(conn, other)
        mrow = conn.execute("SELECT text, ts FROM messages WHERE pair = ? ORDER BY id DESC LIMIT 1", (pair(username, other),)).fetchone()
        out.append({**prof, "last_text": mrow["text"] if mrow else "", "last_ts": mrow["ts"] if mrow else 0})
    return out


def do_delete_chat(conn, username, other):
    other = clean_username(other)
    if not other:
        return {"ok": False, "error": "invalid_username"}
    conn.execute("DELETE FROM chats WHERE username = ? AND other = ?", (username, other))
    conn.commit()
    return {"ok": True}


def do_get_messages(conn, username, other):
    rows = conn.execute(
        "SELECT from_user, text, ts FROM messages WHERE pair = ? ORDER BY id ASC", (pair(username, other),)
    ).fetchall()
    return [{"from": r["from_user"], "text": r["text"], "ts": r["ts"]} for r in rows]


def do_random_join(conn, username):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if row and row["partner"] != "waiting":
        return {"status": "matched", "partner": row["partner"]}
    conn.execute("DELETE FROM pool WHERE username = ?", (username,))
    cutoff = now_ms() - 20000
    row = conn.execute(
        "SELECT p.username FROM pool p JOIN online o ON o.username = p.username "
        "WHERE o.last_seen > ? AND p.username != ? ORDER BY p.join_ts ASC LIMIT 1",
        (cutoff, username),
    ).fetchone()
    if row:
        partner = row["username"]
        conn.execute("DELETE FROM pool WHERE username = ?", (partner,))
        conn.execute("INSERT INTO random_matches(username, partner) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET partner = excluded.partner", (username, partner))
        conn.execute("INSERT INTO random_matches(username, partner) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET partner = excluded.partner", (partner, username))
        conn.commit()
        return {"status": "matched", "partner": partner}
    conn.execute("INSERT INTO pool(username, join_ts) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET join_ts = excluded.join_ts", (username, now_ms()))
    conn.execute("INSERT INTO random_matches(username, partner) VALUES(?, 'waiting') ON CONFLICT(username) DO UPDATE SET partner = 'waiting'", (username,))
    conn.commit()
    return {"status": "waiting", "partner": None}


def do_random_next(conn, username):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if row and row["partner"] != "waiting":
        cur = row["partner"]
        conn.execute("INSERT INTO random_matches(username, partner) VALUES(?, 'waiting') ON CONFLICT(username) DO UPDATE SET partner = 'waiting'", (cur,))
        conn.execute("INSERT INTO pool(username, join_ts) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET join_ts = excluded.join_ts", (cur, now_ms()))
    conn.execute("DELETE FROM random_matches WHERE username = ?", (username,))
    conn.execute("DELETE FROM pool WHERE username = ?", (username,))
    conn.commit()
    return do_random_join(conn, username)


def do_random_leave(conn, username):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if row and row["partner"] != "waiting":
        cur = row["partner"]
        conn.execute("INSERT INTO random_matches(username, partner) VALUES(?, 'waiting') ON CONFLICT(username) DO UPDATE SET partner = 'waiting'", (cur,))
        conn.execute("INSERT INTO pool(username, join_ts) VALUES(?, ?) ON CONFLICT(username) DO UPDATE SET join_ts = excluded.join_ts", (cur, now_ms()))
    conn.execute("DELETE FROM random_matches WHERE username = ?", (username,))
    conn.execute("DELETE FROM pool WHERE username = ?", (username,))
    conn.commit()
    return {"ok": True}


def do_random_status(conn, username):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if not row:
        return {"status": "none", "partner": None}
    if row["partner"] == "waiting":
        return {"status": "waiting", "partner": None}
    return {"status": "matched", "partner": row["partner"]}


def do_random_send(conn, username, text):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if not row or row["partner"] == "waiting":
        return {"ok": False, "error": "not_matched"}
    conn.execute("INSERT INTO random_msgs(pair, from_user, text, ts) VALUES(?, ?, ?, ?)", (pair(username, row["partner"]), username, text or "", now_ms()))
    conn.commit()
    return {"ok": True}


def do_random_messages(conn, username):
    row = conn.execute("SELECT partner FROM random_matches WHERE username = ?", (username,)).fetchone()
    if not row or row["partner"] == "waiting":
        return {"ok": True, "messages": [], "partner": None}
    rows = conn.execute("SELECT from_user, text, ts FROM random_msgs WHERE pair = ? ORDER BY id ASC", (pair(username, row["partner"]),)).fetchall()
    return {"ok": True, "messages": [{"from": r["from_user"], "text": r["text"], "ts": r["ts"]} for r in rows], "partner": row["partner"]}


def do_submit_complaint(conn, username, target, text):
    conn.execute("INSERT INTO complaints(from_user, target, text, ts) VALUES(?, ?, ?, ?)", (username, target or "", text or "", now_ms()))
    conn.commit()
    return {"ok": True}


def do_admin_login(conn, username, password):
    if not ADMIN_USERNAME or clean_username(username) != clean_username(ADMIN_USERNAME) or not ADMIN_PASSWORD or password != ADMIN_PASSWORD:
        return {"ok": False, "error": "invalid_credentials"}
    token = secrets.token_hex(24)
    conn.execute("DELETE FROM admin_token")
    conn.execute("INSERT INTO admin_token(token) VALUES(?)", (token,))
    conn.commit()
    return {"ok": True, "admin_token": token}


def check_admin(conn, admin_token):
    row = conn.execute("SELECT token FROM admin_token LIMIT 1").fetchone()
    return admin_token and row and admin_token == row["token"]


def do_admin_complaints(conn, admin_token):
    if not check_admin(conn, admin_token):
        return {"ok": False, "error": "unauthorized"}
    rows = conn.execute("SELECT from_user, target, text, ts FROM complaints ORDER BY id DESC").fetchall()
    return {"ok": True, "complaints": [{"from": r["from_user"], "target": r["target"], "text": r["text"], "ts": r["ts"]} for r in rows]}


def do_my_complaints(conn, username):
    """Same as do_admin_complaints, but authorized via the normal user token
    when that user is the configured admin - no separate admin login needed."""
    if not is_admin_user(username):
        return {"ok": False, "error": "unauthorized"}
    rows = conn.execute("SELECT from_user, target, text, ts FROM complaints ORDER BY id DESC").fetchall()
    return {"ok": True, "complaints": [{"from": r["from_user"], "target": r["target"], "text": r["text"], "ts": r["ts"]} for r in rows]}


def do_site_users(conn, username):
    """List everyone who has ever visited/logged into the site (admin only, via normal token)."""
    if not is_admin_user(username):
        return {"ok": False, "error": "unauthorized"}
    rows = conn.execute(
        "SELECT u.username, u.name, u.photo, o.last_seen, b.until_ts, b.reason "
        "FROM users u LEFT JOIN online o ON o.username = u.username "
        "LEFT JOIN banned b ON b.username = u.username "
        "ORDER BY COALESCE(o.last_seen, 0) DESC"
    ).fetchall()
    now = now_ms()
    out = []
    for r in rows:
        if clean_username(r["username"]) == clean_username(ADMIN_USERNAME):
            continue
        banned_ms = (r["until_ts"] - now) if r["until_ts"] and r["until_ts"] > now else 0
        out.append({
            "username": r["username"],
            "name": r["name"],
            "photo": r["photo"],
            "last_seen": r["last_seen"] or 0,
            "banned_ms": banned_ms,
            "ban_reason": r["reason"] if banned_ms > 0 else "",
        })
    return {"ok": True, "users": out}


def do_ban_user(conn, username, target, reason):
    """Ban a user for 3 hours (admin only, via normal token)."""
    if not is_admin_user(username):
        return {"ok": False, "error": "unauthorized"}
    target = clean_username(target)
    if not target or target == clean_username(ADMIN_USERNAME):
        return {"ok": False, "error": "invalid_username"}
    until_ts = now_ms() + 3 * 60 * 60 * 1000
    conn.execute(
        "INSERT INTO banned(username, until_ts, reason) VALUES(?, ?, ?) "
        "ON CONFLICT(username) DO UPDATE SET until_ts = excluded.until_ts, reason = excluded.reason",
        (target, until_ts, (reason or "")[:300]),
    )
    conn.execute("DELETE FROM sessions WHERE username = ?", (target,))
    conn.commit()
    return {"ok": True}


def do_admin_update_user(conn, admin_token, target, name, bio):
    if not check_admin(conn, admin_token):
        return {"ok": False, "error": "unauthorized"}
    target = clean_username(target)
    if not target:
        return {"ok": False, "error": "invalid_username"}
    if name is not None:
        conn.execute("UPDATE users SET name = ? WHERE username = ?", ((name or "")[:60], target))
    if bio is not None:
        conn.execute("UPDATE users SET bio = ? WHERE username = ?", ((bio or "")[:300], target))
    conn.commit()
    return {"ok": True, "profile": get_profile(conn, target)}


@app.post("/")
def main_endpoint(request: Request):
    action = request.action
    conn = get_conn()
    try:
        if action == "register":
            return do_register(conn, request)
        if action == "login":
            return do_login(conn, request)
        if action == "me":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return {"ok": True, "profile": get_profile(conn, u)}
        if action == "update_profile":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_update_profile(conn, u, request.name, request.bio, request.photo)
        if action == "get_profile":
            u = clean_username(request.username)
            if not u:
                return {"ok": False, "error": "invalid_username"}
            return {"ok": True, "profile": get_profile(conn, u)}
        if action == "search_users":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return {"ok": True, "users": do_search_users(conn, u, request.query)}
        if action == "send_message":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_send_message(conn, u, request.to, request.text)
        if action == "get_conversations":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return {"ok": True, "conversations": do_get_conversations(conn, u)}
        if action == "get_messages":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            other = clean_username(request.to)
            if not other:
                return {"ok": False, "error": "invalid_target"}
            return {"ok": True, "messages": do_get_messages(conn, u, other)}
        if action == "random_join":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_join(conn, u)
        if action == "random_next":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_next(conn, u)
        if action == "random_leave":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_leave(conn, u)
        if action == "random_status":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_status(conn, u)
        if action == "random_send":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_send(conn, u, request.text)
        if action == "random_messages":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_random_messages(conn, u)
        if action == "submit_complaint":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_submit_complaint(conn, u, request.target, request.text)
        if action == "my_complaints":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_my_complaints(conn, u)
        if action == "delete_chat":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_delete_chat(conn, u, request.target)
        if action == "site_users":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_site_users(conn, u)
        if action == "ban_user":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            return do_ban_user(conn, u, request.target, request.text)
        if action == "vapid_public_key":
            return {"ok": True, "key": VAPID_PUBLIC_KEY}
        if action == "save_push_subscription":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            if not request.endpoint or not request.p256dh or not request.auth:
                return {"ok": False, "error": "invalid_request"}
            conn.execute(
                "INSERT INTO push_subs(username, endpoint, p256dh, auth) VALUES(?, ?, ?, ?) "
                "ON CONFLICT(username, endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
                (u, request.endpoint, request.p256dh, request.auth),
            )
            conn.commit()
            return {"ok": True}
        if action == "remove_push_subscription":
            u = resolve_user(conn, request.token)
            if not u:
                return {"ok": False, "error": "unauthorized"}
            if request.endpoint:
                conn.execute("DELETE FROM push_subs WHERE username = ? AND endpoint = ?", (u, request.endpoint))
                conn.commit()
            return {"ok": True}
        if action == "admin_login":
            return do_admin_login(conn, request.admin_username, request.password)
        if action == "admin_complaints":
            return do_admin_complaints(conn, request.admin_token)
        if action == "admin_update_user":
            return do_admin_update_user(conn, request.admin_token, request.username, request.name, request.bio)
        return {"ok": False, "error": "unknown_action"}
    finally:
        conn.close()


@app.get("/")
def health():
    return {"ok": True, "service": "Randap API"}


init_db()
ensure_admin_user()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
