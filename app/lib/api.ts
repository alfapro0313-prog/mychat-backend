export type Profile = {
  username: string;
  name: string;
  bio: string;
  photo: string;
  is_admin: boolean;
};

export type Message = {
  from: string;
  text: string;
  ts: number;
};

export type Conversation = Profile & {
  last_text: string;
  last_ts: number;
};

export async function api(action: string, payload: Record<string, any> = {}): Promise<any> {
  try {
    const res = await fetch("/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "network" };
  }
}

export function errMessage(lang: string, code: string, t: (l: any, k: string) => string): string {
  return t(lang, `err_${code}`) || t(lang, "err_unknown");
}
