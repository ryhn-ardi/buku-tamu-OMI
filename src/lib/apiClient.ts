import type {
  GuestbookEvent,
  GuestEntry,
  GuestStatus,
  KategoriAsal,
} from '../types/guestbook';

const TOKEN_STORAGE_KEY = 'tamukita_admin_token';

export function getStoredAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredAdminToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredAdminToken();
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let errMsg = `Permintaan gagal (${res.status})`;
    try {
      const errBody = (await res.json()) as { error?: string };
      if (errBody?.error) errMsg = errBody.error;
    } catch {
      // Ignore parse failure
    }
    throw new Error(errMsg);
  }

  return (await res.json()) as T;
}

export async function fetchPublicEvent(
  eventId: string
): Promise<GuestbookEvent | null> {
  const res = await fetch(`/api/events/${encodeURIComponent(eventId)}`, {
    credentials: 'include',
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Gagal memuat data acara (${res.status})`);
  }
  return (await res.json()) as GuestbookEvent;
}

export function subscribePublicEventStream(
  eventId: string,
  onEventUpdated: (event: GuestbookEvent) => void
): () => void {
  const source = new EventSource(
    `/api/events/${encodeURIComponent(eventId)}/stream`
  );
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as {
        type?: string;
        payload?: GuestbookEvent;
      };
      if (parsed.type === 'event-updated' && parsed.payload) {
        onEventUpdated(parsed.payload);
      }
    } catch {
      // Ignore malformed SSE payload
    }
  };
  return () => {
    source.close();
  };
}

export async function submitGuestEntry(payload: {
  eventId: string;
  nama: string;
  asal: string;
  kategoriAsal: KategoriAsal;
  pesan: string;
}): Promise<GuestEntry> {
  return apiRequest<GuestEntry>('/api/guests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; token: string; username: string }> {
  const data = await apiRequest<{ ok: boolean; token: string; username: string }>(
    '/api/admin/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }
  );
  setStoredAdminToken(data.token);
  return data;
}

export async function adminCheckSession(): Promise<boolean> {
  try {
    const res = await apiRequest<{ authenticated: boolean }>(
      '/api/admin/session'
    );
    return res.authenticated === true;
  } catch {
    setStoredAdminToken(null);
    return false;
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await apiRequest<{ ok: boolean }>('/api/admin/logout', { method: 'POST' });
  } finally {
    setStoredAdminToken(null);
  }
}

export async function adminBootstrap(): Promise<{
  guests: GuestEntry[];
  events: GuestbookEvent[];
}> {
  return apiRequest<{ guests: GuestEntry[]; events: GuestbookEvent[] }>(
    '/api/admin/bootstrap'
  );
}

export type AdminStreamEvent =
  | { type: 'guest-added'; payload: GuestEntry }
  | { type: 'guest-updated'; payload: GuestEntry }
  | { type: 'guest-deleted'; payload: { id: string } }
  | { type: 'event-updated'; payload: GuestbookEvent };

export function subscribeAdminStream(
  onEvent: (event: AdminStreamEvent) => void
): () => void {
  const token = getStoredAdminToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  const source = new EventSource(`/api/admin/stream${qs}`);
  source.onmessage = (msg) => {
    try {
      const parsed = JSON.parse(msg.data) as AdminStreamEvent;
      if (parsed && parsed.type) {
        onEvent(parsed);
      }
    } catch {
      // Ignore malformed SSE payload
    }
  };
  return () => {
    source.close();
  };
}

export async function adminUpdateGuest(
  id: string,
  payload: Partial<{
    nama: string;
    asal: string;
    kategoriAsal: KategoriAsal;
    pesan: string;
    status: GuestStatus;
  }>
): Promise<GuestEntry> {
  return apiRequest<GuestEntry>(`/api/admin/guests/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function adminDeleteGuest(id: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(
    `/api/admin/guests/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  );
}

export async function adminCreateEvent(payload: {
  id: string;
  headingName: string;
  bannerImage: string;
  title: string;
  subtitle: string;
  location: string;
  isActive: boolean;
}): Promise<GuestbookEvent> {
  return apiRequest<GuestbookEvent>('/api/admin/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateEvent(
  id: string,
  payload: {
    headingName: string;
    bannerImage: string;
    title: string;
    subtitle: string;
    location: string;
    isActive: boolean;
  }
): Promise<GuestbookEvent> {
  return apiRequest<GuestEntry | GuestbookEvent>(
    `/api/admin/events/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  ) as Promise<GuestbookEvent>;
}
