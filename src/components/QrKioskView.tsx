import React, { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  MapPin,
  Printer,
  QrCode,
  Smartphone,
  Store,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  DEFAULT_BANNER_IMAGE,
  DEFAULT_EVENT_FALLBACK,
  DEFAULT_EVENT_ID,
  DEFAULT_STAND_SLOTS,
  getActiveStands,
  normalizeStandSlots,
  SCHEMA_LIMITS,
  type GuestbookEvent,
  type GuestEntry,
} from '../types/guestbook';
import { formatGuestTimeOnly } from '../lib/exportUtils';

interface QrKioskViewProps {
  selectedEventId: string;
  events: GuestbookEvent[];
  isAdminSignedIn: boolean;
  liveGuests: GuestEntry[];
  onSelectEventId: (eventId: string) => void;
  onOpenCheckInForm: (eventId: string) => void;
  onHeadingSync?: (headingName: string) => void;
}

export const QrKioskView: React.FC<QrKioskViewProps> = ({
  selectedEventId,
  events,
  isAdminSignedIn,
  liveGuests,
  onSelectEventId,
  onOpenCheckInForm,
  onHeadingSync,
}) => {
  const safeEventId = SCHEMA_LIMITS.idPattern.test(selectedEventId)
    ? selectedEventId
    : DEFAULT_EVENT_ID;

  const [eventDetail, setEventDetail] = useState<
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
  const [copied, setCopied] = useState(false);
  const [bannerError, setBannerError] = useState(false);
  const qrContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const matched = events.find((ev) => ev.id === safeEventId);
    if (matched) {
      setEventDetail({
        id: matched.id,
        headingName: matched.headingName || DEFAULT_EVENT_FALLBACK.headingName,
        bannerImage: matched.bannerImage || DEFAULT_BANNER_IMAGE,
        title: matched.title,
        subtitle: matched.subtitle,
        location: matched.location,
        isActive: matched.isActive,
        standSlots: normalizeStandSlots(matched.standSlots),
      });
      setBannerError(false);
      onHeadingSync?.(matched.headingName || DEFAULT_EVENT_FALLBACK.headingName);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'events', safeEventId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const headingName = String(
            data.headingName || DEFAULT_EVENT_FALLBACK.headingName
          );
          setEventDetail({
            id: snap.id,
            headingName,
            bannerImage: String(data.bannerImage || DEFAULT_BANNER_IMAGE),
            title: String(data.title || DEFAULT_EVENT_FALLBACK.title),
            subtitle: String(data.subtitle || DEFAULT_EVENT_FALLBACK.subtitle),
            location: String(data.location || DEFAULT_EVENT_FALLBACK.location),
            isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
            standSlots: normalizeStandSlots(data.standSlots),
          });
          setBannerError(false);
          onHeadingSync?.(headingName);
        } else {
          setEventDetail({
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
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `events/${safeEventId}`);
      }
    );

    return () => unsub();
  }, [safeEventId, events, onHeadingSync]);

  const activeStands = getActiveStands(eventDetail.standSlots);

  const checkInUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?mode=checkin&event=${encodeURIComponent(safeEventId)}`
      : '';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(checkInUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback ignored if clipboard permission unavailable
    }
  };

  const handleDownloadPoster = () => {
    const sourceCanvas = qrContainerRef.current?.querySelector('canvas');
    if (!sourceCanvas) return;

    const posterCanvas = document.createElement('canvas');
    posterCanvas.width = 960;
    posterCanvas.height = 1240;
    const ctx = posterCanvas.getContext('2d');
    if (!ctx) return;

    // White poster background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, posterCanvas.width, posterCanvas.height);

    // Top teal bar
    ctx.fillStyle = '#0F766E';
    ctx.fillRect(0, 0, posterCanvas.width, 28);

    // Brand / Heading label
    ctx.fillStyle = '#0F766E';
    ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(eventDetail.headingName || 'Buku Tamu Digital', 480, 110);

    // Event title
    ctx.fillStyle = '#0F172A';
    ctx.font = '700 44px "Plus Jakarta Sans", sans-serif';
    const titleWords = eventDetail.title.split(' ');
    let line = '';
    let yPos = 175;
    for (const word of titleWords) {
      const testLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(testLine).width > 780) {
        ctx.fillText(line, 480, yPos);
        line = word;
        yPos += 54;
      } else {
        line = testLine;
      }
    }
    if (line) {
      ctx.fillText(line, 480, yPos);
    }

    // Location
    ctx.fillStyle = '#475569';
    ctx.font = '500 24px "DM Sans", sans-serif';
    ctx.fillText(eventDetail.location || 'Resepsionis', 480, yPos + 46);

    // QR frame
    const qrBoxY = yPos + 96;
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 3;
    ctx.strokeRect(210, qrBoxY, 540, 540);

    ctx.drawImage(sourceCanvas, 240, qrBoxY + 30, 480, 480);

    // Footer instruction
    ctx.fillStyle = '#0F172A';
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('Pindai QR Code dengan Kamera Ponsel', 480, qrBoxY + 610);

    ctx.fillStyle = '#64748B';
    ctx.font = '400 21px "DM Sans", sans-serif';
    ctx.fillText('Isi nama, asal daerah/instansi, serta pesan dan kesan Anda', 480, qrBoxY + 652);

    const dataUrl = posterCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `qr-buku-tamu-${safeEventId}.png`;
    link.href = dataUrl;
    link.click();
  };

  const eventGuests = liveGuests.filter((g) => g.eventId === safeEventId);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Printable QR Poster Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden print-only-poster">
          {!bannerError && (
            <div className="h-36 sm:h-44 w-full bg-slate-900 relative overflow-hidden">
              <img
                src={eventDetail.bannerImage || DEFAULT_BANNER_IMAGE}
                alt={eventDetail.title}
                referrerPolicy="no-referrer"
                onError={() => setBannerError(true)}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-slate-950/20 to-transparent" />
              <div className="absolute bottom-3 left-6 right-6 text-left">
                <p className="text-xs font-semibold text-teal-200">
                  {eventDetail.headingName}
                </p>
              </div>
            </div>
          )}

          <div className="p-6 sm:p-10 text-center">
            <div className="max-w-md mx-auto">
              <p className="text-xs font-semibold tracking-wide text-teal-700 mb-2">
                {eventDetail.headingName} · Buku Tamu Digital
              </p>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 text-balance">
                {eventDetail.title}
              </h1>
              <p className="mt-2 text-sm text-slate-500 inline-flex items-center justify-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                <span>{eventDetail.location || 'Resepsionis'}</span>
              </p>

              <div
                ref={qrContainerRef}
                className="mt-7 inline-flex items-center justify-center p-5 bg-white border border-slate-200 rounded-xl"
              >
                <QRCodeCanvas
                  value={checkInUrl}
                  size={250}
                  level="H"
                  bgColor="#FFFFFF"
                  fgColor="#0F172A"
                />
              </div>

              <p className="mt-6 text-base font-semibold text-slate-900">
                Pindai QR Code untuk Mengisi Kehadiran
              </p>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                Arahkan kamera ponsel Anda pada kode di atas, lalu lengkapi nama, asal daerah/instansi, serta pesan dan kesan.
              </p>

              <div className="mt-6 pt-5 border-t border-slate-100 text-xs font-mono text-slate-500 break-all no-print">
                {checkInUrl}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Kiosk Controls & Live Feed */}
        <div className="lg:col-span-5 space-y-6 no-print">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <QrCode className="w-5 h-5 text-teal-700 shrink-0" />
              <h2 className="text-lg font-bold text-slate-900">Pengaturan Layar QR</h2>
            </div>

            {events.length > 0 && (
              <div>
                <label
                  htmlFor="kiosk-event-select"
                  className="block text-xs font-medium text-slate-600 mb-1.5"
                >
                  Pilih Sesi Acara
                </label>
                <select
                  id="kiosk-event-select"
                  value={safeEventId}
                  onChange={(e) => onSelectEventId(e.target.value)}
                  className="w-full min-h-[42px] px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-700"
                >
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.headingName ? `${ev.headingName} — ` : ''}
                      {ev.title} ({ev.isActive ? 'Aktif' : 'Tutup'})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeStands.length > 0 && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                  <span>Pilihan Stand Expo Aktif ({activeStands.length})</span>
                </div>
                <p className="text-slate-600 leading-relaxed">
                  {activeStands.join(' · ')}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleDownloadPoster}
                className="min-h-[44px] px-4 py-2.5 bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span>Unduh Poster PNG</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[44px] px-4 py-2.5 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>Cetak Poster</span>
              </button>

              <button
                type="button"
                onClick={handleCopyUrl}
                className="min-h-[44px] px-4 py-2.5 bg-white border border-slate-300 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-teal-700 shrink-0" />
                    <span className="text-teal-700">Tautan Tersalin</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 shrink-0" />
                    <span>Salin Tautan QR</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => onOpenCheckInForm(safeEventId)}
                className="min-h-[44px] px-4 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4 shrink-0" />
                <span>Buka Form Tamu</span>
              </button>
            </div>
          </div>

          {/* Live Guest Arrival Preview (Admin signed-in) OR Instructions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            {isAdminSignedIn ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-slate-900">
                    Kehadiran Terbaru (Real-Time)
                  </h3>
                  <span className="text-sm font-mono font-semibold text-teal-700 tabular-nums">
                    {eventGuests.length} Tamu
                  </span>
                </div>
                {eventGuests.length === 0 ? (
                  <p className="text-sm text-slate-500 py-4 text-center border border-dashed border-slate-200 rounded-lg">
                    Belum ada tamu yang mengisi untuk acara ini.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {eventGuests.slice(0, 5).map((guest) => (
                      <li key={guest.id} className="py-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">
                            {guest.nama}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {guest.asal} · {guest.kategoriAsal}
                            {guest.stand ? ` · ${guest.stand}` : ''}
                          </p>
                        </div>
                        <span className="text-xs font-mono text-slate-500 tabular-nums shrink-0">
                          {formatGuestTimeOnly(guest.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <Smartphone className="w-5 h-5 text-teal-700 shrink-0" />
                  <h3 className="text-base font-bold text-slate-900">Panduan Pengunjung</h3>
                </div>
                <ol className="space-y-2.5 text-sm text-slate-600 list-decimal list-inside leading-relaxed">
                  <li>Buka aplikasi kamera atau pemindai QR di ponsel Anda.</li>
                  <li>Arahkan ke QR Code di samping hingga tautan formulir muncul.</li>
                  <li>Isi Nama Lengkap, Asal Instansi/Daerah, serta Pesan & Kesan.</li>
                  <li>Tekan kirim — data kehadiran Anda langsung tercatat di dashboard panitia.</li>
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
