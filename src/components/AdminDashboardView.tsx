import React, { useMemo, useRef, useState } from 'react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Building2,
  Calendar,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Link2,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  QrCode,
  Search,
  Settings2,
  Trash2,
  Upload,
  User as UserIcon,
  X,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  exportGuestsToExcel,
  exportGuestsToPdf,
  formatGuestTimestamp,
  toJsDate,
} from '../lib/exportUtils';
import { compressImageFileToDataUrl } from '../lib/imageUtils';
import {
  BANNER_PRESETS,
  DEFAULT_BANNER_IMAGE,
  DEFAULT_EVENT_FALLBACK,
  DEFAULT_EVENT_ID,
  KATEGORI_ASAL_OPTIONS,
  SCHEMA_LIMITS,
  type GuestbookEvent,
  type GuestEntry,
  type GuestStatus,
  type KategoriAsal,
} from '../types/guestbook';

interface AdminDashboardViewProps {
  isAuthenticated: boolean;
  authReady: boolean;
  guests: GuestEntry[];
  events: GuestbookEvent[];
  loadingData: boolean;
  recentArrival: GuestEntry | null;
  onAdminLogin: (username: string, password: string) => Promise<void>;
  onAdminLogout: () => Promise<void>;
  onOpenKioskForEvent: (eventId: string) => void;
}

type ImageSourceMode = 'presets' | 'upload' | 'url';

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  isAuthenticated,
  authReady,
  guests,
  events,
  loadingData,
  recentArrival,
  onAdminLogin,
  onAdminLogout,
  onOpenKioskForEvent,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'nama' | 'asal' | 'pesan'>('all');
  const [selectedEventFilter, setSelectedEventFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | GuestStatus>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | '7days' | 'specific'>('all');
  const [specificDate, setSpecificDate] = useState<string>('');
  const [actionError, setActionError] = useState<string | null>(null);

  // Username & Password Login Form states
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submittingCredentials, setSubmittingCredentials] = useState(false);

  // Guest Detail / Edit / Delete states
  const [viewingGuest, setViewingGuest] = useState<GuestEntry | null>(null);
  const [editingGuest, setEditingGuest] = useState<GuestEntry | null>(null);
  const [editNama, setEditNama] = useState('');
  const [editAsal, setEditAsal] = useState('');
  const [editKategori, setEditKategori] = useState<KategoriAsal>('Instansi / Kantor');
  const [editPesan, setEditPesan] = useState('');
  const [editStatus, setEditStatus] = useState<GuestStatus>('hadir');
  const [savingGuest, setSavingGuest] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Event & Appearance Management Modal states
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string>(DEFAULT_EVENT_ID);
  const [isCreatingNewEvent, setIsCreatingNewEvent] = useState(false);
  const [newEventSlug, setNewEventSlug] = useState('');
  const [eventHeadingName, setEventHeadingName] = useState(
    DEFAULT_EVENT_FALLBACK.headingName
  );
  const [eventBannerImage, setEventBannerImage] = useState(DEFAULT_BANNER_IMAGE);
  const [imageSourceMode, setImageSourceMode] = useState<ImageSourceMode>('presets');
  const [processingUpload, setProcessingUpload] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventSubtitle, setEventSubtitle] = useState('');
  const [eventLocation, setEventLocation] = useState('');
  const [eventIsActive, setEventIsActive] = useState(true);
  const [eventFormError, setEventFormError] = useState<string | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCredentialSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    const trimmedUser = loginUsername.trim();

    if (!trimmedUser || !loginPassword) {
      setLoginError('Masukkan username dan password.');
      return;
    }

    setSubmittingCredentials(true);
    try {
      await onAdminLogin(trimmedUser, loginPassword);
      setLoginPassword('');
    } catch (err) {
      setLoginError(
        err instanceof Error
          ? err.message
          : 'Username atau password salah. Silakan periksa kembali.'
      );
    } finally {
      setSubmittingCredentials(false);
    }
  };

  const toLocalDateKey = (d: Date): string => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setSearchField('all');
    setSelectedEventFilter('all');
    setSelectedCategoryFilter('all');
    setSelectedStatusFilter('all');
    setDateFilter('all');
    setSpecificDate('');
  };

  const hasActiveFilters = Boolean(
    searchQuery.trim() ||
      searchField !== 'all' ||
      selectedEventFilter !== 'all' ||
      selectedCategoryFilter !== 'all' ||
      selectedStatusFilter !== 'all' ||
      dateFilter !== 'all'
  );

  // Filtered guests
  const filteredGuests = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = new Date();
    const todayKey = toLocalDateKey(now);
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);

    return guests.filter((g) => {
      if (selectedEventFilter !== 'all' && g.eventId !== selectedEventFilter) {
        return false;
      }
      if (selectedCategoryFilter !== 'all' && g.kategoriAsal !== selectedCategoryFilter) {
        return false;
      }
      if (selectedStatusFilter !== 'all' && g.status !== selectedStatusFilter) {
        return false;
      }
      if (dateFilter !== 'all') {
        const guestDate = toJsDate(g.createdAt);
        if (!guestDate) return false;
        if (dateFilter === 'today' && toLocalDateKey(guestDate) !== todayKey) {
          return false;
        }
        if (dateFilter === '7days' && guestDate < sevenDaysAgo) {
          return false;
        }
        if (dateFilter === 'specific' && specificDate) {
          if (toLocalDateKey(guestDate) !== specificDate) return false;
        }
      }
      if (q) {
        if (searchField === 'nama') {
          return g.nama.toLowerCase().includes(q);
        }
        if (searchField === 'asal') {
          return g.asal.toLowerCase().includes(q);
        }
        if (searchField === 'pesan') {
          return g.pesan.toLowerCase().includes(q);
        }
        const matchNama = g.nama.toLowerCase().includes(q);
        const matchAsal = g.asal.toLowerCase().includes(q);
        const matchPesan = g.pesan.toLowerCase().includes(q);
        if (!matchNama && !matchAsal && !matchPesan) return false;
      }
      return true;
    });
  }, [
    guests,
    searchQuery,
    searchField,
    selectedEventFilter,
    selectedCategoryFilter,
    selectedStatusFilter,
    dateFilter,
    specificDate,
  ]);

  // Real KPI stats computed from Firestore documents
  const kpiStats = useMemo(() => {
    const todayStr = new Date().toDateString();
    const baseList =
      selectedEventFilter === 'all'
        ? guests
        : guests.filter((g) => g.eventId === selectedEventFilter);

    const todayCount = baseList.filter((g) => {
      const d = toJsDate(g.createdAt);
      return Boolean(d && d.toDateString() === todayStr);
    }).length;

    const verifiedCount = baseList.filter((g) => g.status === 'terverifikasi').length;

    const uniqueOrigins = new Set(
      baseList.map((g) => g.asal.trim().toLowerCase()).filter(Boolean)
    ).size;

    const byCategory = KATEGORI_ASAL_OPTIONS.map((kat) => ({
      kategori: kat,
      count: baseList.filter((g) => g.kategoriAsal === kat).length,
    }));

    return {
      total: baseList.length,
      todayCount,
      verifiedCount,
      uniqueOrigins,
      byCategory,
    };
  }, [guests, selectedEventFilter]);

  const activeExportEvent = useMemo(() => {
    if (selectedEventFilter !== 'all') {
      return events.find((e) => e.id === selectedEventFilter) || null;
    }
    return events.find((e) => e.id === DEFAULT_EVENT_ID) || events[0] || null;
  }, [events, selectedEventFilter]);

  const handleToggleStatus = async (guest: GuestEntry) => {
    setActionError(null);
    const nextStatus: GuestStatus = guest.status === 'hadir' ? 'terverifikasi' : 'hadir';
    try {
      await updateDoc(doc(db, 'guests', guest.id), {
        status: nextStatus,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal memperbarui status kehadiran.'
      );
      handleFirestoreError(err, OperationType.UPDATE, `guests/${guest.id}`);
    }
  };

  const openEditGuest = (guest: GuestEntry) => {
    setActionError(null);
    setEditingGuest(guest);
    setEditNama(guest.nama);
    setEditAsal(guest.asal);
    setEditKategori(guest.kategoriAsal);
    setEditPesan(guest.pesan);
    setEditStatus(guest.status);
  };

  const handleSaveGuestEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGuest) return;
    setActionError(null);

    const cleanNama = editNama.trim().slice(0, SCHEMA_LIMITS.namaMax);
    const cleanAsal = editAsal.trim().slice(0, SCHEMA_LIMITS.asalMax);
    const cleanPesan = editPesan.trim().slice(0, SCHEMA_LIMITS.pesanMax);
    if (
      cleanNama.length < SCHEMA_LIMITS.namaMin ||
      cleanAsal.length < SCHEMA_LIMITS.asalMin ||
      cleanPesan.length < SCHEMA_LIMITS.pesanMin
    ) {
      return;
    }

    setSavingGuest(true);
    try {
      await updateDoc(doc(db, 'guests', editingGuest.id), {
        nama: cleanNama,
        asal: cleanAsal,
        kategoriAsal: editKategori,
        pesan: cleanPesan,
        status: editStatus,
      });
      setEditingGuest(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menyimpan perubahan data tamu.'
      );
      handleFirestoreError(err, OperationType.UPDATE, `guests/${editingGuest.id}`);
    } finally {
      setSavingGuest(false);
    }
  };

  const handleDeleteGuest = async (guestId: string) => {
    setActionError(null);
    try {
      await deleteDoc(doc(db, 'guests', guestId));
      setConfirmDeleteId(null);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menghapus data tamu.'
      );
      handleFirestoreError(err, OperationType.DELETE, `guests/${guestId}`);
    }
  };

  const detectImageMode = (imgSrc: string): ImageSourceMode => {
    if (BANNER_PRESETS.some((p) => p.path === imgSrc)) return 'presets';
    if (imgSrc.startsWith('data:image/')) return 'upload';
    return 'url';
  };

  const openEventModal = (targetEvent?: GuestbookEvent) => {
    setEventFormError(null);
    setPreviewError(false);

    const chosen =
      targetEvent ||
      events.find((e) => e.id === DEFAULT_EVENT_ID) ||
      events[0] ||
      null;

    if (chosen) {
      const img = chosen.bannerImage || DEFAULT_BANNER_IMAGE;
      setIsCreatingNewEvent(false);
      setEditingEventId(chosen.id);
      setEventHeadingName(chosen.headingName || DEFAULT_EVENT_FALLBACK.headingName);
      setEventBannerImage(img);
      setImageSourceMode(detectImageMode(img));
      setEventTitle(chosen.title);
      setEventSubtitle(chosen.subtitle);
      setEventLocation(chosen.location);
      setEventIsActive(chosen.isActive);
    } else {
      setIsCreatingNewEvent(true);
      setNewEventSlug('acara-baru-2026');
      setEventHeadingName(DEFAULT_EVENT_FALLBACK.headingName);
      setEventBannerImage(DEFAULT_BANNER_IMAGE);
      setImageSourceMode('presets');
      setEventTitle('Buku Tamu Digital');
      setEventSubtitle('Silakan pindai QR Code dan isi identitas kehadiran Anda.');
      setEventLocation('Lobi Utama');
      setEventIsActive(true);
    }
    setShowEventModal(true);
  };

  const handleSelectEventInModal = (id: string) => {
    setEventFormError(null);
    setPreviewError(false);
    if (id === '__new__') {
      setIsCreatingNewEvent(true);
      setNewEventSlug('');
      setEventHeadingName(DEFAULT_EVENT_FALLBACK.headingName);
      setEventBannerImage(DEFAULT_BANNER_IMAGE);
      setImageSourceMode('presets');
      setEventTitle('');
      setEventSubtitle('Silakan pindai QR Code dan isi identitas kehadiran Anda.');
      setEventLocation('');
      setEventIsActive(true);
      return;
    }
    const found = events.find((ev) => ev.id === id);
    if (found) {
      const img = found.bannerImage || DEFAULT_BANNER_IMAGE;
      setIsCreatingNewEvent(false);
      setEditingEventId(found.id);
      setEventHeadingName(found.headingName || DEFAULT_EVENT_FALLBACK.headingName);
      setEventBannerImage(img);
      setImageSourceMode(detectImageMode(img));
      setEventTitle(found.title);
      setEventSubtitle(found.subtitle);
      setEventLocation(found.location);
      setEventIsActive(found.isActive);
    }
  };

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEventFormError(null);
    setProcessingUpload(true);
    try {
      const compressedDataUrl = await compressImageFileToDataUrl(file);
      setEventBannerImage(compressedDataUrl);
      setPreviewError(false);
    } catch (err) {
      setEventFormError(
        err instanceof Error ? err.message : 'Gagal memproses gambar yang diunggah.'
      );
    } finally {
      setProcessingUpload(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthenticated) return;
    setEventFormError(null);

    const cleanHeading = eventHeadingName
      .trim()
      .slice(0, SCHEMA_LIMITS.headingNameMax);
    const cleanBanner = eventBannerImage.trim() || DEFAULT_BANNER_IMAGE;
    const cleanTitle = eventTitle.trim().slice(0, SCHEMA_LIMITS.eventTitleMax);
    const cleanSubtitle = eventSubtitle.trim().slice(0, SCHEMA_LIMITS.eventSubtitleMax);
    const cleanLocation = eventLocation.trim().slice(0, SCHEMA_LIMITS.eventLocationMax);

    if (cleanHeading.length < SCHEMA_LIMITS.headingNameMin) {
      setEventFormError(`Nama heading minimal ${SCHEMA_LIMITS.headingNameMin} karakter.`);
      return;
    }
    if (cleanBanner.length > SCHEMA_LIMITS.bannerImageMax) {
      setEventFormError('Ukuran gambar atau panjang URL melebihi batas penyimpanan.');
      return;
    }
    if (cleanTitle.length < SCHEMA_LIMITS.eventTitleMin) {
      setEventFormError(`Judul acara minimal ${SCHEMA_LIMITS.eventTitleMin} karakter.`);
      return;
    }

    const targetId = isCreatingNewEvent
      ? newEventSlug
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/(^-|-$)/g, '')
      : editingEventId;

    if (
      !targetId ||
      !SCHEMA_LIMITS.idPattern.test(targetId) ||
      targetId.length > SCHEMA_LIMITS.idMax
    ) {
      setEventFormError(
        'ID acara hanya boleh berisi huruf, angka, tanda hubung (-), atau garis bawah (_).'
      );
      return;
    }

    setSavingEvent(true);
    try {
      if (isCreatingNewEvent) {
        await setDoc(doc(db, 'events', targetId), {
          headingName: cleanHeading,
          bannerImage: cleanBanner,
          title: cleanTitle,
          subtitle: cleanSubtitle,
          location: cleanLocation,
          isActive: eventIsActive,
          createdBy: 'admin',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'events', targetId), {
          headingName: cleanHeading,
          bannerImage: cleanBanner,
          title: cleanTitle,
          subtitle: cleanSubtitle,
          location: cleanLocation,
          isActive: eventIsActive,
          updatedAt: serverTimestamp(),
        });
      }
      setShowEventModal(false);
    } catch (err) {
      setEventFormError(
        err instanceof Error ? err.message : 'Gagal menyimpan pengaturan acara.'
      );
      handleFirestoreError(err, OperationType.WRITE, `events/${targetId}`);
    } finally {
      setSavingEvent(false);
    }
  };

  // Loading auth state
  if (!authReady) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-48" />
          <div className="h-4 bg-slate-100 rounded w-80" />
          <div className="h-32 bg-slate-100 rounded w-full mt-4" />
        </div>
      </div>
    );
  }

  // Admin Login Form (Username & Password Only)
  if (!isAuthenticated) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="max-w-md mx-auto bg-white border border-slate-200 rounded-xl p-8">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6" />
          </div>
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-slate-900">Login Dashboard Admin</h1>
            <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
              Masukkan username dan password administrator untuk memantau kehadiran tamu serta mengekspor laporan.
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {loginError}
            </div>
          )}

          <form onSubmit={handleCredentialSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="admin-username"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Username
              </label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-username"
                  type="text"
                  autoComplete="username"
                  required
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-password"
                  type={showLoginPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="w-full min-h-[44px] pl-10 pr-11 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((prev) => !prev)}
                  aria-label={showLoginPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  {showLoginPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submittingCredentials}
              className="w-full min-h-[46px] px-5 py-2.5 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{submittingCredentials ? 'Memverifikasi...' : 'Masuk Dashboard'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  const categoryColors: Record<KategoriAsal, string> = {
    'Instansi / Kantor': 'bg-teal-700',
    'Sekolah / Universitas': 'bg-sky-600',
    'Umum / Daerah': 'bg-amber-600',
    'Mitra / Tamu VIP': 'bg-slate-800',
  };

  const exportReportTitle = activeExportEvent
    ? activeExportEvent.headingName &&
      activeExportEvent.headingName !== activeExportEvent.title
      ? `${activeExportEvent.headingName} - ${activeExportEvent.title}`
      : activeExportEvent.title
    : 'Buku Tamu Digital';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Dashboard Monitoring Kehadiran
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Pemantauan data tamu real-time · Masuk sebagai admin
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => openEventModal()}
            className="min-h-[42px] px-4 py-2 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Settings2 className="w-4 h-4 text-teal-700" />
            <span>Ubah Heading &amp; Gambar</span>
          </button>

          <button
            type="button"
            disabled={filteredGuests.length === 0}
            onClick={() => exportGuestsToExcel(filteredGuests, exportReportTitle)}
            className="min-h-[42px] px-4 py-2 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-45 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-teal-700" />
            <span>Ekspor Excel</span>
          </button>

          <button
            type="button"
            disabled={filteredGuests.length === 0}
            onClick={() =>
              exportGuestsToPdf(
                filteredGuests,
                exportReportTitle,
                activeExportEvent?.location
              )
            }
            className="min-h-[42px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-45 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <FileText className="w-4 h-4" />
            <span>Ekspor PDF</span>
          </button>
        </div>
      </div>

      {/* Inline Action Error Banner */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4 text-sm text-red-700">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="p-1 text-red-500 hover:text-red-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Real-time New Arrival Notification */}
      {recentArrival && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle2 className="w-5 h-5 text-teal-700 shrink-0" />
            <p className="text-sm text-teal-950 truncate">
              <span className="font-semibold">Tamu Baru Hadir:</span> {recentArrival.nama} ·{' '}
              <span className="text-teal-800">{recentArrival.asal}</span>
            </p>
          </div>
          <span className="text-xs font-mono text-teal-800 tabular-nums shrink-0">
            Baru saja
          </span>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Total Pengunjung</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums">
            {kpiStats.total}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {selectedEventFilter === 'all' ? 'Semua sesi acara' : 'Pada acara terpilih'}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Hadir Hari Ini</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-teal-700 tabular-nums">
            {kpiStats.todayCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Tercatat pada tanggal hari ini</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Terverifikasi</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums">
            {kpiStats.verifiedCount}
          </p>
          <p className="mt-1 text-xs text-slate-500">Dikonfirmasi oleh petugas</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Instansi / Daerah Unik</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums">
            {kpiStats.uniqueOrigins}
          </p>
          <p className="mt-1 text-xs text-slate-500">Asal berbeda yang tercatat</p>
        </div>
      </div>

      {/* Category Distribution Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Distribusi Kategori Asal Pengunjung
          </h2>
          <span className="text-xs font-mono text-slate-500 tabular-nums">
            {kpiStats.total} Total Entri
          </span>
        </div>

        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden flex">
          {kpiStats.total > 0 &&
            kpiStats.byCategory.map((item) => {
              const pct = (item.count / kpiStats.total) * 100;
              if (pct <= 0) return null;
              return (
                <div
                  key={item.kategori}
                  style={{ width: `${pct}%` }}
                  className={`${categoryColors[item.kategori]} h-full transition-all duration-300`}
                  title={`${item.kategori}: ${item.count}`}
                />
              );
            })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          {kpiStats.byCategory.map((item) => (
            <div key={item.kategori} className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-sm shrink-0 ${categoryColors[item.kategori]}`}
              />
              <span>{item.kategori}</span>
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {item.count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Search, Filters & High-Density Guest Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 space-y-4">
          {/* Row 1: Specific Search & Secondary Dropdowns */}
          <div className="flex flex-col xl:flex-row xl:items-center gap-3">
            <div className="flex-1 flex flex-col sm:flex-row gap-2">
              <select
                aria-label="Target Pencarian"
                value={searchField}
                onChange={(e) =>
                  setSearchField(e.target.value as 'all' | 'nama' | 'asal' | 'pesan')
                }
                className="min-h-[42px] px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700 shrink-0"
              >
                <option value="all">Semua Kolom</option>
                <option value="nama">Khusus Nama Tamu</option>
                <option value="asal">Khusus Asal / Instansi</option>
                <option value="pesan">Khusus Pesan &amp; Kesan</option>
              </select>

              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label="Cari Data Tamu"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    searchField === 'nama'
                      ? 'Ketik nama lengkap tamu secara spesifik...'
                      : searchField === 'asal'
                      ? 'Ketik asal daerah, sekolah, atau instansi...'
                      : searchField === 'pesan'
                      ? 'Cari kata kunci pada pesan dan kesan...'
                      : 'Cari nama tamu, asal instansi/daerah, atau pesan kesan...'
                  }
                  className="w-full min-h-[42px] pl-10 pr-9 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Hapus pencarian"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Filter Acara"
                value={selectedEventFilter}
                onChange={(e) => setSelectedEventFilter(e.target.value)}
                className="min-h-[42px] px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              >
                <option value="all">Semua Sesi Acara</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.headingName ? `${ev.headingName} — ` : ''}
                    {ev.title}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter Status Kehadiran"
                value={selectedStatusFilter}
                onChange={(e) =>
                  setSelectedStatusFilter(e.target.value as 'all' | GuestStatus)
                }
                className="min-h-[42px] px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              >
                <option value="all">Semua Status</option>
                <option value="hadir">Hadir</option>
                <option value="terverifikasi">Terverifikasi</option>
              </select>
            </div>
          </div>

          {/* Row 2: Arrival Date Filters & Category Segmented Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            {/* Segmented Category Filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
              <button
                type="button"
                onClick={() => setSelectedCategoryFilter('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  selectedCategoryFilter === 'all'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                }`}
              >
                Semua Kategori · <span className="font-mono tabular-nums">{kpiStats.total}</span>
              </button>
              {KATEGORI_ASAL_OPTIONS.map((kat) => {
                const katCount =
                  kpiStats.byCategory.find((b) => b.kategori === kat)?.count ?? 0;
                return (
                  <button
                    key={kat}
                    type="button"
                    onClick={() => setSelectedCategoryFilter(kat)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      selectedCategoryFilter === kat
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    {kat} · <span className="font-mono tabular-nums">{katCount}</span>
                  </button>
                );
              })}
            </div>

            {/* Arrival Date Filter Controls */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter('all');
                    setSpecificDate('');
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    dateFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua Tanggal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter('today');
                    setSpecificDate('');
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    dateFilter === 'today'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Hari Ini
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDateFilter('7days');
                    setSpecificDate('');
                  }}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    dateFilter === '7days'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  7 Hari
                </button>
              </div>

              <div className="relative flex items-center">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                <input
                  type="date"
                  aria-label="Filter Tanggal Kedatangan Spesifik"
                  value={specificDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSpecificDate(val);
                    setDateFilter(val ? 'specific' : 'all');
                  }}
                  className={`min-h-[36px] pl-8 pr-2.5 py-1 border rounded-lg text-xs font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700 ${
                    dateFilter === 'specific' && specificDate
                      ? 'bg-teal-50 border-teal-700 text-teal-900 font-semibold'
                      : 'bg-white border-slate-300 text-slate-700'
                  }`}
                />
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="min-h-[36px] px-3 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Reset Filter
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table Content */}
        {loadingData ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="h-11 bg-slate-100 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : filteredGuests.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-900">
              {guests.length === 0
                ? 'Belum Ada Data Tamu Tercatat'
                : 'Tidak Ada Data yang Cocok dengan Filter'}
            </h3>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              {guests.length === 0
                ? 'Tampilkan Layar QR Kiosk di meja resepsionis agar pengunjung dapat memindai dan mengisi buku tamu.'
                : 'Ubah kata kunci pencarian atau atur ulang filter kategori dan tanggal.'}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              {guests.length === 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenKioskForEvent(
                      selectedEventFilter === 'all' ? DEFAULT_EVENT_ID : selectedEventFilter
                    )
                  }
                  className="min-h-[42px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 transition-colors inline-flex items-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Buka Layar QR Kiosk</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="min-h-[42px] px-4 py-2 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Reset Semua Filter
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 pl-5 pr-3 w-12 text-right">No</th>
                  <th className="py-3 px-3 whitespace-nowrap">Waktu Hadir</th>
                  <th className="py-3 px-3">Nama Tamu</th>
                  <th className="py-3 px-3">Asal Daerah / Instansi</th>
                  <th className="py-3 px-3">Pesan &amp; Kesan</th>
                  <th className="py-3 px-3 whitespace-nowrap">Status</th>
                  <th className="py-3 pl-3 pr-5 text-right whitespace-nowrap">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredGuests.map((guest, index) => (
                  <tr
                    key={guest.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="py-3 pl-5 pr-3 text-right font-mono text-xs text-slate-500 tabular-nums align-top">
                      {index + 1}
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap align-top">
                      {formatGuestTimestamp(guest.createdAt)}
                    </td>
                    <td className="py-3 px-3 font-semibold text-slate-900 align-top min-w-[160px]">
                      {guest.nama}
                    </td>
                    <td className="py-3 px-3 align-top min-w-[200px]">
                      <div className="text-slate-900 font-medium">{guest.asal}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {guest.kategoriAsal}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 align-top max-w-xs">
                      <p className="line-clamp-2 leading-relaxed">{guest.pesan}</p>
                    </td>
                    <td className="py-3 px-3 align-top whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void handleToggleStatus(guest)}
                        title="Klik untuk mengubah status verifikasi"
                        className={`text-xs font-medium inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
                          guest.status === 'terverifikasi'
                            ? 'bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100'
                            : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {guest.status === 'terverifikasi' ? 'Terverifikasi' : 'Hadir'}
                        </span>
                      </button>
                    </td>
                    <td className="py-3 pl-3 pr-5 text-right align-top whitespace-nowrap">
                      {confirmDeleteId === guest.id ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDeleteGuest(guest.id)}
                            className="px-2.5 py-1 bg-red-600 text-white text-xs font-medium rounded hover:bg-red-700 cursor-pointer"
                          >
                            Hapus
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2.5 py-1 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded hover:bg-slate-50 cursor-pointer"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setViewingGuest(guest)}
                            title="Lihat detail"
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditGuest(guest)}
                            title="Edit data tamu"
                            className="p-1.5 text-slate-500 hover:text-teal-700 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(guest.id)}
                            title="Hapus entri"
                            className="p-1.5 text-slate-500 hover:text-red-700 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Table Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span className="font-mono tabular-nums">
            Menampilkan {filteredGuests.length} dari {guests.length} catatan tamu
          </span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => void onAdminLogout()}
              className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 font-medium cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Keluar Admin</span>
            </button>
          </div>
        </div>
      </div>

      {/* View Guest Detail Modal */}
      {viewingGuest && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs text-slate-500 font-mono tabular-nums">
                  {formatGuestTimestamp(viewingGuest.createdAt)} · {viewingGuest.eventId}
                </p>
                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  {viewingGuest.nama}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setViewingGuest(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">
                  Asal Daerah / Instansi / Sekolah / Kantor
                </span>
                <span className="font-medium text-slate-900">
                  {viewingGuest.asal} · {viewingGuest.kategoriAsal}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block mb-1">Pesan dan Kesan</span>
                <p className="text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3.5 leading-relaxed">
                  {viewingGuest.pesan}
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const target = viewingGuest;
                  setViewingGuest(null);
                  openEditGuest(target);
                }}
                className="min-h-[40px] px-4 py-2 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Edit Data
              </button>
              <button
                type="button"
                onClick={() => setViewingGuest(null)}
                className="min-h-[40px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Guest Modal */}
      {editingGuest && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveGuestEdit}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Edit Catatan Tamu</h3>
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nama Lengkap
              </label>
              <input
                type="text"
                required
                minLength={SCHEMA_LIMITS.namaMin}
                maxLength={SCHEMA_LIMITS.namaMax}
                value={editNama}
                onChange={(e) => setEditNama(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Kategori Asal
                </label>
                <select
                  value={editKategori}
                  onChange={(e) => setEditKategori(e.target.value as KategoriAsal)}
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900"
                >
                  {KATEGORI_ASAL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Status Kehadiran
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as GuestStatus)}
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900"
                >
                  <option value="hadir">Hadir</option>
                  <option value="terverifikasi">Terverifikasi</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Asal Daerah / Instansi / Sekolah / Kantor
              </label>
              <input
                type="text"
                required
                minLength={SCHEMA_LIMITS.asalMin}
                maxLength={SCHEMA_LIMITS.asalMax}
                value={editAsal}
                onChange={(e) => setEditAsal(e.target.value)}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Pesan dan Kesan
              </label>
              <textarea
                required
                rows={3}
                minLength={SCHEMA_LIMITS.pesanMin}
                maxLength={SCHEMA_LIMITS.pesanMax}
                value={editPesan}
                onChange={(e) => setEditPesan(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="min-h-[40px] px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={savingGuest}
                className="min-h-[40px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer"
              >
                {savingGuest ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manage Heading, Banner Image & Event Modal */}
      {showEventModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveEvent}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 space-y-5 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Pengaturan Heading, Gambar &amp; Acara
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sesuaikan nama heading instansi/acara dan gambar tampilan agar cocok untuk berbagai keperluan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEventModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Event Selector */}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Pilih Sesi Acara atau Buat Baru
              </label>
              <div className="flex gap-2">
                <select
                  value={isCreatingNewEvent ? '__new__' : editingEventId}
                  onChange={(e) => handleSelectEventInModal(e.target.value)}
                  className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900"
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.headingName ? `${ev.headingName} — ` : ''}
                      {ev.title} ({ev.id})
                    </option>
                  ))}
                  <option value="__new__">+ Buat Sesi Acara Baru</option>
                </select>

                <button
                  type="button"
                  onClick={() => handleSelectEventInModal('__new__')}
                  className="min-h-[42px] px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>Acara Baru</span>
                </button>
              </div>
            </div>

            {eventFormError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {eventFormError}
              </div>
            )}

            {/* Live Preview of Heading & Banner Image */}
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-900 relative h-44">
              {!previewError && eventBannerImage ? (
                <img
                  src={eventBannerImage}
                  alt="Pratinjau Banner Buku Tamu"
                  referrerPolicy="no-referrer"
                  onError={() => setPreviewError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-teal-900 via-slate-800 to-slate-900 flex items-center justify-center">
                  <ImageIcon className="w-10 h-10 text-teal-300/60" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent" />
              <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
                <span className="text-xs font-medium text-white/90 bg-slate-950/50 backdrop-blur-xs px-2.5 py-1 rounded">
                  Pratinjau Langsung
                </span>
              </div>
              <div className="absolute bottom-3.5 left-4 right-4">
                <p className="text-xs font-medium text-teal-200 flex items-center gap-1.5">
                  <span className="font-semibold text-white">
                    {eventHeadingName || 'Nama Heading'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    <span>{eventLocation || 'Lokasi Acara'}</span>
                  </span>
                </p>
                <p className="text-lg font-bold text-white truncate mt-0.5">
                  {eventTitle || 'Judul Acara Buku Tamu'}
                </p>
              </div>
            </div>

            {isCreatingNewEvent && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  ID / Slug URL Acara (huruf kecil, angka, tanda hubung)
                </label>
                <input
                  type="text"
                  required
                  value={newEventSlug}
                  onChange={(e) => setNewEventSlug(e.target.value)}
                  placeholder="Contoh: rapat-tahunan-2026"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono text-slate-900"
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Heading (Header / Instansi / Brand)
                </label>
                <input
                  type="text"
                  required
                  minLength={SCHEMA_LIMITS.headingNameMin}
                  maxLength={SCHEMA_LIMITS.headingNameMax}
                  value={eventHeadingName}
                  onChange={(e) => setEventHeadingName(e.target.value)}
                  placeholder="Contoh: SMAN 1 Bandung / PT Nusantara"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Muncul di header atas, poster QR, dan judul laporan PDF.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Judul Acara / Sub-Heading
                </label>
                <input
                  type="text"
                  required
                  minLength={SCHEMA_LIMITS.eventTitleMin}
                  maxLength={SCHEMA_LIMITS.eventTitleMax}
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Contoh: Buku Tamu Kunjungan Kerja"
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                />
              </div>
            </div>

            {/* Banner Image Selector */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700">
                  Pilih atau Ganti Gambar Banner
                </span>
                <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setImageSourceMode('presets')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      imageSourceMode === 'presets'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Galeri Tema
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageSourceMode('upload')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      imageSourceMode === 'upload'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Unggah File
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageSourceMode('url')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                      imageSourceMode === 'url'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Tautan URL
                  </button>
                </div>
              </div>

              {imageSourceMode === 'presets' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {BANNER_PRESETS.map((preset) => {
                    const selected = eventBannerImage === preset.path;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setEventBannerImage(preset.path);
                          setPreviewError(false);
                        }}
                        className={`text-left rounded-lg border overflow-hidden transition-all cursor-pointer ${
                          selected
                            ? 'border-teal-700 ring-2 ring-teal-600/20'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="h-16 bg-slate-200 overflow-hidden">
                          <img
                            src={preset.path}
                            alt={preset.label}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-2">
                          <p className="text-xs font-semibold text-slate-900 truncate">
                            {preset.label}
                          </p>
                          <p className="text-[11px] text-slate-500 line-clamp-1">
                            {preset.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {imageSourceMode === 'upload' && (
                <div className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    <p className="font-semibold text-slate-800">
                      Unggah foto instansi, sekolah, atau poster acara
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      Format JPG, PNG, atau WebP. Gambar dikompresi otomatis agar ringan saat dibuka tamu.
                    </p>
                  </div>
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageFileChange}
                      className="hidden"
                      id="banner-upload-input"
                    />
                    <label
                      htmlFor="banner-upload-input"
                      className="min-h-[40px] px-4 py-2 bg-white border border-slate-300 text-slate-800 text-xs font-semibold rounded-lg hover:bg-slate-100 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <Upload className="w-4 h-4 text-teal-700" />
                      <span>{processingUpload ? 'Memproses...' : 'Pilih Gambar'}</span>
                    </label>
                  </div>
                </div>
              )}

              {imageSourceMode === 'url' && (
                <div className="relative">
                  <Link2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="url"
                    value={eventBannerImage.startsWith('data:') ? '' : eventBannerImage}
                    onChange={(e) => {
                      setEventBannerImage(e.target.value);
                      setPreviewError(false);
                    }}
                    placeholder="https://contoh-domain.id/gambar-banner.jpg"
                    className="w-full min-h-[42px] pl-10 pr-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Lokasi / Ruangan
              </label>
              <input
                type="text"
                maxLength={SCHEMA_LIMITS.eventLocationMax}
                value={eventLocation}
                onChange={(e) => setEventLocation(e.target.value)}
                placeholder="Contoh: Gedung Aula Utama Lantai 2"
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Pesan Sambutan untuk Pengunjung
              </label>
              <textarea
                rows={2}
                maxLength={SCHEMA_LIMITS.eventSubtitleMax}
                value={eventSubtitle}
                onChange={(e) => setEventSubtitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-lg border border-slate-200 bg-slate-50">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Terima Pengisian Buku Tamu
                </p>
                <p className="text-xs text-slate-500">
                  Matikan jika sesi acara telah berakhir agar formulir QR terkunci.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEventIsActive((prev) => !prev)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${
                  eventIsActive
                    ? 'bg-teal-700 border-teal-700 text-white'
                    : 'bg-white border-slate-300 text-slate-700'
                }`}
              >
                {eventIsActive ? 'Aktif' : 'Nonaktif'}
              </button>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
              {!isCreatingNewEvent ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowEventModal(false);
                    onOpenKioskForEvent(editingEventId);
                  }}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-teal-700 hover:text-teal-800 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Tampilkan QR Code Acara Ini</span>
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowEventModal(false)}
                  className="min-h-[40px] px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEvent || processingUpload}
                  className="min-h-[40px] px-4 py-2 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5"
                >
                  <span>{savingEvent ? 'Menyimpan...' : 'Simpan Pengaturan'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
