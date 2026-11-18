export const ADMIN_GATE_STORAGE_KEY = 'tamukita_admin_unlocked';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_SHA256 =
  '7629ff54a4bbabf905969b66b172a8fe7b777327adbc532615f5cf728610d988';

async function sha256Hex(value: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  throw new Error('Browser tidak mendukung verifikasi kriptografi Web Crypto.');
}

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const cleanUser = username.trim().toLowerCase();
  if (cleanUser !== ADMIN_USERNAME || !password) {
    return false;
  }
  const hash = await sha256Hex(password);
  return hash === ADMIN_PASSWORD_SHA256;
}
