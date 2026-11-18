import React, { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  Building2,
  CheckCircle2,
  GraduationCap,
  MapPin,
  MessageSquareText,
  Send,
  Sparkles,
  Store,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  DEFAULT_BANNER_IMAGE,
  DEFAULT_EVENT_FALLBACK,
  DEFAULT_EVENT_ID,
  DEFAULT_STAND_SLOTS,
  getActiveStands,
  KATEGORI_ASAL_OPTIONS,
  normalizeStandSlots,
  SCHEMA_LIMITS,
  type GuestbookEvent,
  type KategoriAsal,
} from '../types/guestbook';

interface GuestCheckInViewProps {
  eventId: string;
  isQrDirectMode: boolean;
  onSwitchToKiosk: () => void;
  onHeadingSync?: (headingName: string) => void;
}

interface SubmittedReceipt {
  id: string;
  nama: string;
  asal: string;
  kategoriAsal: KategoriAsal;
  stand: string;
  pesan: string;
  submittedAt: string;
}

export const GuestCheckInView: React.FC<GuestCheckInViewProps> = ({
  eventId,
  isQrDirectMode,
  onSwitchToKiosk,
  onHeadingSync,
}) => {
  const safeEventId = SCHEMA_LIMITS.idPattern.test(eventId) ? eventId : DEFAULT_EVENT_ID;

  const [eventInfo, setEventInfo] = useState<
    Pick<
      GuestbookEvent,
      | 'id'
      | 'headingName'
      | 'bannerImage'
      | 'title'
      | 'subtitle'
      | 'location'
      | 'isActive'
      | 'standSlots'
    >
  >({
    id: safeEventId,
    headingName: DEFAULT_EVENT_FALLBACK.headingName,
    bannerImage: DEFAULT_EVENT_FALLBACK.bannerImage,
    title: DEFAULT_EVENT_FALLBACK.title,
    subtitle: DEFAULT_EVENT_FALLBACK.subtitle,
    location: DEFAULT_EVENT_FALLBACK.location,
    isActive: true,
    standSlots: [...DEFAULT_STAND_SLOTS],
  });
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [bannerError, setBannerError] = useState(false);

  const [nama, setNama] = useState('');
  const [asal, setAsal] = useState('');
  const [kategoriAsal, setKategoriAsal] = useState<KategoriAsal>('Instansi / Kantor');
  const [selectedStand, setSelectedStand] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('stand')?.trim() || '';
  });
  const [pesan, setPesan] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmittedReceipt | null>(null);

  useEffect(() => {
    setLoadingEvent(true);
    const unsub = onSnapshot(
      doc(db, 'events', safeEventId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const headingName = String(
            data.headingName || DEFAULT_EVENT_FALLBACK.headingName
          );
          const bannerImage = String(
            data.bannerImage || DEFAULT_BANNER_IMAGE
          );
          setEventInfo({
            id: snap.id,
            headingName,
            bannerImage,
            title: String(data.title || DEFAULT_EVENT_FALLBACK.title),
            subtitle: String(data.subtitle || DEFAULT_EVENT_FALLBACK.subtitle),
            location: String(data.location || DEFAULT_EVENT_FALLBACK.location),
            isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
            standSlots: normalizeStandSlots(data.standSlots),
          });
          setBannerError(false);
          onHeadingSync?.(headingName);
        } else if (safeEventId === DEFAULT_EVENT_ID) {
          setEventInfo({
            id: DEFAULT_EVENT_ID,
            headingName: DEFAULT_EVENT_FALLBACK.headingName,
            bannerImage: DEFAULT_EVENT_FALLBACK.bannerImage,
            title: DEFAULT_EVENT_FALLBACK.title,
            subtitle: DEFAULT_EVENT_FALLBACK.subtitle,
            location: DEFAULT_EVENT_FALLBACK.location,
            isActive: true,
            standSlots: [...DEFAULT_STAND_SLOTS],
          });
          setBannerError(false);
          onHeadingSync?.(DEFAULT_EVENT_FALLBACK.headingName);
        } else {
          setEventInfo({
            id: safeEventId,
            headingName: DEFAULT_EVENT_FALLBACK.headingName,
            bannerImage: DEFAULT_BANNER_IMAGE,
            title: 'Acara Tidak Ditemukan',
            subtitle: 'Tautan QR Code acara ini belum terdaftar atau telah dihapus.',
            location: '-',
            isActive: false,
            standSlots: [...DEFAULT_STAND_SLOTS],
          });
        }
        setLoadingEvent(false);
      },
      (err) => {
        setLoadingEvent(false);
        handleFirestoreError(err, OperationType.GET, `events/${safeEventId}`);
      }
    );

    return () => unsub();
  }, [safeEventId, onHeadingSync]);

  const activeStands = getActiveStands(eventInfo.standSlots);

  useEffect(() => {
    if (activeStands.length === 0) {
      if (selectedStand) setSelectedStand('');
      return;
    }
    if (selectedStand && !activeStands.includes(selectedStand)) {
      const ciMatch = activeStands.find(
        (s) => s.toLowerCase() === selectedStand.toLowerCase()
      );
      setSelectedStand(ciMatch || '');
    }
  }, [activeStands, selectedStand]);

  const checkInUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=checkin&event=${encodeURIComponent(safeEventId)}`
      : '';

  const getKategoriIcon = (kat: KategoriAsal) => {
    switch (kat) {
      case 'Instansi / Kantor':
        return <Building2 className="w-4 h-4 shrink-0" />;
      case 'Sekolah / Universitas':
        return <GraduationCap className="w-4 h-4 shrink-0" />;
      case 'Mitra / Tamu VIP':
        return <Sparkles className="w-4 h-4 shrink-0" />;
      default:
        return <Users className="w-4 h-4 shrink-0" />;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!eventInfo.isActive) {
      setFormError('Penerimaan tamu untuk acara ini sedang ditutup oleh pengelola.');
      return;
    }

    const cleanNama = nama.trim().slice(0, SCHEMA_LIMITS.namaMax);
    const cleanAsal = asal.trim().slice(0, SCHEMA_LIMITS.asalMax);
    const cleanStand =
      activeStands.length > 0
        ? selectedStand.trim().slice(0, SCHEMA_LIMITS.standMax)
        : '';
    const cleanPesan = pesan.trim().slice(0, SCHEMA_LIMITS.pesanMax);

    if (cleanNama.length < SCHEMA_LIMITS.namaMin) {
      setFormError(`Nama lengkap minimal ${SCHEMA_LIMITS.namaMin} karakter.`);
      return;
    }
    if (activeStands.length > 0 && !activeStands.includes(cleanStand)) {
      setFormError('Silakan pilih stand expo yang Anda kunjungi.');
      return;
    }
    if (cleanAsal.length < SCHEMA_LIMITS.asalMin) {
      setFormError(
        `Asal daerah / instansi / sekolah / kantor minimal ${SCHEMA_LIMITS.asalMin} karakter.`
      );
      return;
    }
    if (cleanPesan.length < SCHEMA_LIMITS.pesanMin) {
      setFormError(`Pesan dan kesan minimal ${SCHEMA_LIMITS.pesanMin} karakter.`);
      return;
    }

    setSubmitting(true);
    try {
      const guestRef = doc(collection(db, 'guests'));
      await setDoc(guestRef, {
        eventId: safeEventId,
        nama: cleanNama,
        asal: cleanAsal,
        kategoriAsal,
        stand: cleanStand,
        pesan: cleanPesan,
        status: 'hadir',
        createdAt: serverTimestamp(),
      });

      const nowStr = new Intl.DateTimeFormat('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      setReceipt({
        id: guestRef.id,
        nama: cleanNama,
        asal: cleanAsal,
        kategoriAsal,
        stand: cleanStand,
        pesan: cleanPesan,
        submittedAt: nowStr,
      });
      setNama('');
      setAsal('');
      setSelectedStand('');
      setPesan('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('permission') || msg.includes('PERMISSION_DENIED')) {
        handleFirestoreError(err, OperationType.CREATE, 'guests');
      }
      setFormError('Gagal menyimpan data kehadiran. Silakan periksa koneksi Anda dan coba lagi.');
    } finally {
      setSubmitting(false);
    }
  };

  const activeBannerSrc = eventInfo.bannerImage || DEFAULT_BANNER_IMAGE;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        {/* Left Column: Reception Visual & QR Context */}
        <div className="lg:col-span-5 flex flex-col bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="relative h-56 sm:h-64 lg:h-72 bg-slate-900 shrink-0 overflow-hidden">
            {!bannerError ? (
              <img
                src={activeBannerSrc}
                alt={eventInfo.title || 'Banner Buku Tamu Digital'}
                referrerPolicy="no-referrer"
                onError={() => setBannerError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-teal-900 via-slate-800 to-slate-900 flex items-center justify-center p-6">
                <Building2 className="w-14 h-14 text-teal-300/70" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6">
              <p className="text-xs font-medium text-teal-200 mb-1.5 flex items-center gap-1.5 flex-wrap">
                <span className="font-semibold text-white">{eventInfo.headingName}</span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>{loadingEvent ? 'Memuat lokasi...' : eventInfo.location || 'Resepsionis'}</span>
                </span>
              </p>
              <h1 className="text-xl sm:text-2xl font-bold text-white leading-snug text-balance">
                {loadingEvent ? 'Memuat Acara...' : eventInfo.title}
              </h1>
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col justify-between gap-6">
            <div>
              <p className="text-sm text-slate-600 leading-relaxed">
                {eventInfo.subtitle}
              </p>
              <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Status Penerimaan</span>
                {eventInfo.isActive ? (
                  <span className="font-medium text-teal-700 inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Aktif Menerima Tamu</span>
                  </span>
                ) : (
                  <span className="font-medium text-red-700 inline-flex items-center gap-1.5">
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Pendaftaran Ditutup</span>
                  </span>
                )}
              </div>
            </div>

            {!isQrDirectMode && (
              <div className="pt-5 border-t border-slate-200 flex items-center gap-4">
                <div className="p-2 bg-white border border-slate-200 rounded-lg shrink-0">
                  <QRCodeSVG value={checkInUrl} size={76} level="M" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">Pindai dari Ponsel</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                    Arahkan kamera ponsel ke QR Code untuk membuka formulir ini secara langsung.
                  </p>
                  <button
                    type="button"
                    onClick={onSwitchToKiosk}
                    className="mt-2 text-xs font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-4 cursor-pointer"
                  >
                    Tampilkan Layar QR Kiosk
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Guest Check-In Form or Confirmation Receipt */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col justify-center">
          {receipt ? (
            <div className="py-4">
              <div className="inline-flex items-center gap-2 text-teal-700 mb-3">
                <CheckCircle2 className="w-6 h-6" />
                <span className="text-sm font-semibold">Kehadiran Tercatat Secara Real-Time</span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 text-balance">
                Terima Kasih Atas Kunjungan Anda, {receipt.nama}
              </h2>
              <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                Identitas dan pesan kesan Anda telah tersimpan ke dalam buku tamu digital.
              </p>

              <div className="mt-6 border border-slate-200 rounded-xl divide-y divide-slate-100 bg-slate-50/60">
                <div className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-500">Waktu Kehadiran</span>
                  <span className="font-mono text-xs sm:text-sm font-medium text-slate-900 tabular-nums">
                    {receipt.submittedAt}
                  </span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                  <span className="text-slate-500">Asal / Instansi</span>
                  <span className="font-medium text-slate-900 text-right">
                    {receipt.asal} · <span className="text-slate-500 font-normal">{receipt.kategoriAsal}</span>
                  </span>
                </div>
                {receipt.stand && (
                  <div className="px-4 py-3 flex items-center justify-between gap-4 text-sm">
                    <span className="text-slate-500">Stand Dikunjungi</span>
                    <span className="font-semibold text-teal-800 text-right">
                      {receipt.stand}
                    </span>
                  </div>
                )}
                <div className="px-4 py-3 text-sm">
                  <span className="text-slate-500 block mb-1">Pesan dan Kesan</span>
                  <p className="text-slate-800 leading-relaxed">&ldquo;{receipt.pesan}&rdquo;</p>
                </div>
                <div className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs text-slate-500">
                  <span>Referensi Catatan</span>
                  <span className="font-mono tabular-nums">{receipt.id}</span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="min-h-[44px] px-5 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 active:scale-[0.99] transition-all cursor-pointer whitespace-nowrap"
                >
                  Isi Buku Tamu Lagi
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                  Formulir Buku Tamu
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  Lengkapi identitas kehadiran Anda di bawah ini. Data langsung tampil pada monitor admin.
                </p>
              </div>

              {!eventInfo.isActive && !loadingEvent && (
                <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex items-start gap-3">
                  <XCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-600" />
                  <div>
                    <p className="font-semibold">Buku Tamu Sedang Ditutup</p>
                    <p className="mt-0.5 text-red-700">
                      Pengelola acara telah menonaktifkan pengisian kehadiran untuk sesi ini.
                    </p>
                  </div>
                </div>
              )}

              {formError && (
                <div className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700 flex items-center gap-2.5">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label
                  htmlFor="guest-nama"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Nama Lengkap <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="guest-nama"
                    type="text"
                    required
                    minLength={SCHEMA_LIMITS.namaMin}
                    maxLength={SCHEMA_LIMITS.namaMax}
                    value={nama}
                    onChange={(e) => setNama(e.target.value)}
                    disabled={!eventInfo.isActive || submitting}
                    placeholder="Contoh: Dr. Ratna Kusuma"
                    className="w-full min-h-[46px] pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                  />
                </div>
              </div>

              {activeStands.length > 0 && (
                <div>
                  <span className="block text-sm font-medium text-slate-800 mb-2">
                    Stand yang Dikunjungi <span className="text-red-600">*</span>
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {activeStands.map((standName) => {
                      const active = selectedStand === standName;
                      return (
                        <button
                          key={standName}
                          type="button"
                          disabled={!eventInfo.isActive || submitting}
                          onClick={() => setSelectedStand(standName)}
                          className={`min-h-[44px] px-3.5 py-2.5 rounded-lg border text-sm font-medium flex items-center gap-2.5 text-left transition-colors cursor-pointer disabled:opacity-50 ${
                            active
                              ? 'bg-teal-50 border-teal-700 text-teal-900'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className={active ? 'text-teal-700' : 'text-slate-400'}>
                            <Store className="w-4 h-4 shrink-0" />
                          </span>
                          <span className="truncate">{standName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <span className="block text-sm font-medium text-slate-800 mb-2">
                  Kategori Pengunjung <span className="text-red-600">*</span>
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {KATEGORI_ASAL_OPTIONS.map((option) => {
                    const active = kategoriAsal === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        disabled={!eventInfo.isActive || submitting}
                        onClick={() => setKategoriAsal(option)}
                        className={`min-h-[44px] px-3.5 py-2.5 rounded-lg border text-sm font-medium flex items-center gap-2.5 text-left transition-colors cursor-pointer disabled:opacity-50 ${
                          active
                            ? 'bg-teal-50 border-teal-700 text-teal-900'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className={active ? 'text-teal-700' : 'text-slate-400'}>
                          {getKategoriIcon(option)}
                        </span>
                        <span className="truncate">{option}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label
                  htmlFor="guest-asal"
                  className="block text-sm font-medium text-slate-800 mb-1.5"
                >
                  Asal Daerah / Instansi / Sekolah / Kantor <span className="text-red-600">*</span>
                </label>
                <div className="relative">
                  <Building2 className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="guest-asal"
                    type="text"
                    required
                    minLength={SCHEMA_LIMITS.asalMin}
                    maxLength={SCHEMA_LIMITS.asalMax}
                    value={asal}
                    onChange={(e) => setAsal(e.target.value)}
                    disabled={!eventInfo.isActive || submitting}
                    placeholder="Contoh: SMAN 3 Bandung / Dinas Pendidikan / Kota Surabaya"
                    className="w-full min-h-[46px] pl-10 pr-4 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700 disabled:bg-slate-100 disabled:text-slate-400 transition-colors"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="guest-pesan"
                    className="block text-sm font-medium text-slate-800"
                  >
                    Pesan dan Kesan <span className="text-red-600">*</span>
                  </label>
                  <span className="text-xs font-mono text-slate-400 tabular-nums">
                    {pesan.length}/{SCHEMA_LIMITS.pesanMax}
                  </span>
                </div>
                <div className="relative">
                  <MessageSquareText className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                  <textarea
                    id="guest-pesan"
                    required
                    rows={4}
                    minLength={SCHEMA_LIMITS.pesanMin}
                    maxLength={SCHEMA_LIMITS.pesanMax}
                    value={pesan}
                    onChange={(e) => setPesan(e.target.value)}
                    disabled={!eventInfo.isActive || submitting}
                    placeholder="Tuliskan pesan, kesan, atau ucapan Anda selama berkunjung..."
                    className="w-full pl-10 pr-4 py-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700 disabled:bg-slate-100 disabled:text-slate-400 transition-colors resize-y"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={!eventInfo.isActive || submitting || loadingEvent}
                className="w-full min-h-[48px] px-5 py-3 bg-teal-700 text-white text-sm font-semibold rounded-lg hover:bg-teal-800 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{submitting ? 'Menyimpan Kehadiran...' : 'Kirim & Catat Kehadiran'}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
