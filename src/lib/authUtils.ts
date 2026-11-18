const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_SHA256 =
  '7629ff54a4bbabf905969b66b172a8fe7b777327adbc532615f5cf728610d988';

export const ADMIN_VIRTUAL_EMAIL = 'admin@tamukita.id';
export const ADMIN_GATE_STORAGE_KEY = 'tamukita_admin_gate_unlocked';

async function sha256Hex(text: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(text);
    const buffer = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

export async function verifyAdminCredentials(
  username: string,
  password: string
): Promise<boolean> {
  const cleanUser = username.trim().toLowerCase();
  if (cleanUser !== ADMIN_USERNAME) {
    return false;
  }

  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const hash = await sha256Hex(password);
    return hash === ADMIN_PASSWORD_SHA256;
  }

  return password === 'monyetlupa';
}
