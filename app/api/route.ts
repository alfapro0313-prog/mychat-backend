export const runtime = "nodejs";

// Point this to your own backend (e.g. "https://your-backend.onrender.com")
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8000";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  try {
    const resp = await fetch(`${BACKEND_URL}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return Response.json(data, { status: resp.status });
  } catch {
    return Response.json({ ok: false, error: "upstream_error" }, { status: 502 });
  }
}
