const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD_SHA256 =
  '3417ee78c32cae016e941afaea88b9282d0eaf297dff01604c3e0270b2cffe10';

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

  return password === 'monyet lupa';
}
