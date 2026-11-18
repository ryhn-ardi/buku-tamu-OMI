import type { Timestamp } from 'firebase/firestore';

export type KategoriAsal =
  | 'Instansi / Kantor'
  | 'Sekolah / Universitas'
  | 'Umum / Daerah'
  | 'Mitra / Tamu VIP';

export type GuestStatus = 'hadir' | 'terverifikasi';

export type AppViewMode = 'checkin' | 'kiosk' | 'admin';

export const DEFAULT_EVENT_ID = 'main-guestbook';

export const DEFAULT_BANNER_IMAGE =
  '/src/assets/images/venue_reception_banner_1794970857392.jpg';

export interface BannerPreset {
  id: string;
  label: string;
  description: string;
  path: string;
}

export const BANNER_PRESETS: readonly BannerPreset[] = [
  {
    id: 'reception',
    label: 'Resepsionis Modern',
    description: 'Lobi kayu jati hangat untuk kantor atau umum',
    path: '/src/assets/images/venue_reception_banner_1794970857392.jpg',
  },
  {
    id: 'office',
    label: 'Kantor & Instansi',
    description: 'Atrium kaca dan meja batu untuk instansi resmi',
    path: '/src/assets/images/venue_office_hall_1794971693797.jpg',
  },
  {
    id: 'campus',
    label: 'Sekolah & Kampus',
    description: 'Koridor aula pendidikan dengan taman hijau',
    path: '/src/assets/images/venue_campus_library_1794971693795.jpg',
  },
  {
    id: 'ballroom',
    label: 'Seminar & Acara',
    description: 'Foyer serbaguna untuk seminar, wisuda, atau resepsi',
    path: '/src/assets/images/venue_event_ballroom_1794971694457.jpg',
  },
] as const;

export const KATEGORI_ASAL_OPTIONS: readonly KategoriAsal[] = [
  'Instansi / Kantor',
  'Sekolah / Universitas',
  'Umum / Daerah',
  'Mitra / Tamu VIP',
] as const;

export const GUEST_STATUS_OPTIONS: readonly GuestStatus[] = [
  'hadir',
  'terverifikasi',
] as const;

export const SCHEMA_LIMITS = {
  idPattern: /^[a-zA-Z0-9_-]+$/,
  idMax: 128,
  namaMin: 2,
  namaMax: 100,
  asalMin: 2,
  asalMax: 150,
  pesanMin: 2,
  pesanMax: 1000,
  headingNameMin: 1,
  headingNameMax: 80,
  bannerImageMax: 350000,
  eventTitleMin: 2,
  eventTitleMax: 120,
  eventSubtitleMax: 200,
  eventLocationMax: 120,
} as const;

export interface GuestEntry {
  id: string;
  eventId: string;
  nama: string;
  asal: string;
  kategoriAsal: KategoriAsal;
  pesan: string;
  status: GuestStatus;
  createdAt: Timestamp | null;
}

export interface GuestbookEvent {
  id: string;
  headingName: string;
  bannerImage: string;
  title: string;
  subtitle: string;
  location: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'superadmin';
  createdAt: Timestamp | null;
}

export const DEFAULT_EVENT_FALLBACK: Omit<
  GuestbookEvent,
  'createdBy' | 'createdAt' | 'updatedAt'
> = {
  id: DEFAULT_EVENT_ID,
  headingName: 'TamuKita',
  bannerImage: DEFAULT_BANNER_IMAGE,
  title: 'Buku Tamu Digital',
  subtitle:
    'Silakan pindai QR Code atau lengkapi formulir di samping untuk mencatat kehadiran Anda.',
  location: 'Lobi Utama Resepsionis',
  isActive: true,
};
