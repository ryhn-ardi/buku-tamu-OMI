import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { LayoutDashboard, QrCode, ClipboardPen } from 'lucide-react';
import { db, handleFirestoreError, OperationType } from './lib/firebase';
import {
  ADMIN_GATE_STORAGE_KEY,
  verifyAdminCredentials,
} from './lib/authUtils';
import {
  DEFAULT_BANNER_IMAGE,
  DEFAULT_EVENT_FALLBACK,
  DEFAULT_EVENT_ID,
  DEFAULT_STAND_SLOTS,
  normalizeStandSlots,
  SCHEMA_LIMITS,
  type AppViewMode,
  type GuestbookEvent,
  type GuestEntry,
  type GuestStatus,
  type KategoriAsal,
} from './types/guestbook';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GuestCheckInView } from './components/GuestCheckInView';
import { QrKioskView } from './components/QrKioskView';
import { AdminDashboardView } from './components/AdminDashboardView';

function parseInitialRoute(): {
  mode: AppViewMode;
  eventId: string;
  isQrDirect: boolean;
} {
  if (typeof window === 'undefined') {
    return { mode: 'checkin', eventId: DEFAULT_EVENT_ID, isQrDirect: false };
  }
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode');
  const rawEvent = params.get('event') || DEFAULT_EVENT_ID;
  const eventId = SCHEMA_LIMITS.idPattern.test(rawEvent)
    ? rawEvent
    : DEFAULT_EVENT_ID;

  if (rawMode === 'checkin') {
    return { mode: 'checkin', eventId, isQrDirect: true };
  }
  if (rawMode === 'kiosk') {
    return { mode: 'kiosk', eventId, isQrDirect: false };
  }
  if (rawMode === 'admin') {
    return { mode: 'admin', eventId, isQrDirect: false };
  }
  return { mode: 'checkin', eventId, isQrDirect: false };
}

function GuestbookApp() {
  const initialRoute = parseInitialRoute();
  const [viewMode, setViewMode] = useState<AppViewMode>(initialRoute.mode);
  const [activeEventId, setActiveEventId] = useState<string>(initialRoute.eventId);
  const [isQrDirectMode, setIsQrDirectMode] = useState<boolean>(initialRoute.isQrDirect);
  const [activeHeadingName, setActiveHeadingName] = useState<string>(
    DEFAULT_EVENT_FALLBACK.headingName
  );

  const [authReady] = useState<boolean>(true);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage.getItem(ADMIN_GATE_STORAGE_KEY) === 'true';
  });

  const [guests, setGuests] = useState<GuestEntry[]>([]);
  const [events, setEvents] = useState<GuestbookEvent[]>([]);
  const [loadingAdminData, setLoadingAdminData] = useState<boolean>(false);
  const [recentArrival, setRecentArrival] = useState<GuestEntry | null>(null);

  const initialGuestsLoadedRef = useRef(false);
  const arrivalTimerRef = useRef<number | null>(null);

  const handleHeadingSync = useCallback((heading: string) => {
    if (heading.trim()) {
      setActiveHeadingName(heading.trim());
    }
  }, []);

  // Sync URL query params cleanly without full page reload
  const navigateTo = (nextMode: AppViewMode, nextEventId?: string, directQr = false) => {
    const targetEvent = nextEventId || activeEventId;
    setViewMode(nextMode);
    setActiveEventId(targetEvent);
    setIsQrDirectMode(directQr);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', nextMode);
      url.searchParams.set('event', targetEvent);
      window.history.replaceState({}, '', url.toString());
    }
  };

  // Monitor active event heading in real time even on admin view
  useEffect(() => {
    const matched = events.find((ev) => ev.id === activeEventId);
    if (matched) {
      setActiveHeadingName(matched.headingName || DEFAULT_EVENT_FALLBACK.headingName);
    }
  }, [events, activeEventId]);

  // Attach real-time Firestore listeners when authenticated as Admin
  useEffect(() => {
    if (!authReady || !isAuthenticated) {
      initialGuestsLoadedRef.current = false;
      return;
    }

    setLoadingAdminData(true);

    async function ensureDefaultEvent() {
      try {
        const defaultRef = doc(db, 'events', DEFAULT_EVENT_ID);
        const snap = await getDoc(defaultRef);
        if (!snap.exists()) {
          await setDoc(defaultRef, {
            headingName: DEFAULT_EVENT_FALLBACK.headingName,
            bannerImage: DEFAULT_EVENT_FALLBACK.bannerImage,
            title: DEFAULT_EVENT_FALLBACK.title,
            subtitle: DEFAULT_EVENT_FALLBACK.subtitle,
            location: DEFAULT_EVENT_FALLBACK.location,
            isActive: true,
            standSlots: [...DEFAULT_STAND_SLOTS],
            createdBy: 'admin',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `events/${DEFAULT_EVENT_ID}`);
      }
    }

    void ensureDefaultEvent();

    const guestsQuery = query(
      collection(db, 'guests'),
      where('createdAt', '>=', Timestamp.fromMillis(0)),
      orderBy('createdAt', 'desc')
    );
    const unsubGuests = onSnapshot(
      guestsQuery,
      (snapshot) => {
        const nextGuests: GuestEntry[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            eventId: String(data.eventId || DEFAULT_EVENT_ID),
            nama: String(data.nama || ''),
            asal: String(data.asal || ''),
            kategoriAsal: (data.kategoriAsal || 'Umum / Daerah') as KategoriAsal,
            stand: String(data.stand || ''),
            pesan: String(data.pesan || ''),
            status: (data.status || 'hadir') as GuestStatus,
            createdAt: data.createdAt || null,
          };
        });

        if (initialGuestsLoadedRef.current) {
          const addedChanges = snapshot
            .docChanges()
            .filter((ch) => ch.type === 'added');
          if (addedChanges.length > 0 && nextGuests.length > 0) {
            const newestId = addedChanges[0].doc.id;
            const newestGuest = nextGuests.find((g) => g.id === newestId);
            if (newestGuest) {
              setRecentArrival(newestGuest);
              if (arrivalTimerRef.current) {
                window.clearTimeout(arrivalTimerRef.current);
              }
              arrivalTimerRef.current = window.setTimeout(() => {
                setRecentArrival(null);
              }, 8000);
            }
          }
        } else {
          initialGuestsLoadedRef.current = true;
        }

        setGuests(nextGuests);
        setLoadingAdminData(false);
      },
      (error) => {
        setLoadingAdminData(false);
        handleFirestoreError(error, OperationType.LIST, 'guests');
      }
    );

    const eventsQuery = query(
      collection(db, 'events'),
      where('createdAt', '>=', Timestamp.fromMillis(0)),
      orderBy('createdAt', 'desc')
    );
    const unsubEvents = onSnapshot(
      eventsQuery,
      (snapshot) => {
        const nextEvents: GuestbookEvent[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            headingName: String(
              data.headingName || DEFAULT_EVENT_FALLBACK.headingName
            ),
            bannerImage: String(data.bannerImage || DEFAULT_BANNER_IMAGE),
            title: String(data.title || DEFAULT_EVENT_FALLBACK.title),
            subtitle: String(data.subtitle || DEFAULT_EVENT_FALLBACK.subtitle),
            location: String(data.location || DEFAULT_EVENT_FALLBACK.location),
            isActive: typeof data.isActive === 'boolean' ? data.isActive : true,
            standSlots: normalizeStandSlots(data.standSlots),
            createdBy: String(data.createdBy || ''),
            createdAt: data.createdAt || null,
            updatedAt: data.updatedAt || null,
          };
        });
        setEvents(nextEvents);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'events');
      }
    );

    return () => {
      unsubGuests();
      unsubEvents();
      if (arrivalTimerRef.current) {
        window.clearTimeout(arrivalTimerRef.current);
      }
    };
  }, [authReady, isAuthenticated]);

  const handleAdminLogin = async (username: string, password: string) => {
    const ok = await verifyAdminCredentials(username, password);
    if (!ok) {
      throw new Error('Username atau password salah. Silakan periksa kembali.');
    }
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ADMIN_GATE_STORAGE_KEY, 'true');
    }
    setIsAuthenticated(true);
  };

  const handleAdminLogout = async () => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(ADMIN_GATE_STORAGE_KEY);
    }
    setIsAuthenticated(false);
    setGuests([]);
    setEvents([]);
    setRecentArrival(null);
  };

  const handlePrimaryHeaderAction = async () => {
    if (!isAuthenticated) {
      navigateTo('admin');
    } else if (viewMode === 'admin') {
      await handleAdminLogout();
    } else {
      navigateTo('admin');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar: Strict 3-Zone Contract */}
      {!isQrDirectMode && (
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 no-print">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
            {/* Zone 1: Single-line Dynamic Brand/Heading Wordmark */}
            <button
              type="button"
              onClick={() => navigateTo('checkin', activeEventId, false)}
              className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 max-w-[220px] truncate cursor-pointer"
            >
              {activeHeadingName}
            </button>

            {/* Zone 2: Clean Single-Line Navigation Links */}
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
              <button
                type="button"
                onClick={() => navigateTo('checkin', activeEventId, false)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'checkin'
                    ? 'border-teal-700 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Isi Buku Tamu
              </button>
              <button
                type="button"
                onClick={() => navigateTo('kiosk', activeEventId, false)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'kiosk'
                    ? 'border-teal-700 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Layar QR Kiosk
              </button>
              <button
                type="button"
                onClick={() => navigateTo('admin', activeEventId, false)}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  viewMode === 'admin'
                    ? 'border-teal-700 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                Dashboard Admin
              </button>
            </nav>

            {/* Zone 3: 1 Primary Action */}
            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => void handlePrimaryHeaderAction()}
                className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {!isAuthenticated
                  ? 'Masuk Admin'
                  : viewMode === 'admin'
                  ? 'Keluar Admin'
                  : 'Buka Dashboard'}
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Compact Guest Header when opened via QR Code */}
      {isQrDirectMode && (
        <header className="bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between gap-4">
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap truncate">
            {activeHeadingName}
          </span>
          <button
            type="button"
            onClick={() => navigateTo('kiosk', activeEventId, false)}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Mode Pengelola
          </button>
        </header>
      )}

      {/* Main Content */}
      <main className={`flex-1 ${!isQrDirectMode ? 'pb-20 md:pb-8' : 'pb-8'}`}>
        {viewMode === 'checkin' && (
          <GuestCheckInView
            eventId={activeEventId}
            isQrDirectMode={isQrDirectMode}
            onSwitchToKiosk={() => navigateTo('kiosk', activeEventId, false)}
            onHeadingSync={handleHeadingSync}
          />
        )}

        {viewMode === 'kiosk' && (
          <QrKioskView
            selectedEventId={activeEventId}
            events={events}
            isAdminSignedIn={isAuthenticated}
            liveGuests={guests}
            onSelectEventId={(evId) => navigateTo('kiosk', evId, false)}
            onOpenCheckInForm={(evId) => navigateTo('checkin', evId, false)}
            onHeadingSync={handleHeadingSync}
          />
        )}

        {viewMode === 'admin' && (
          <AdminDashboardView
            isAuthenticated={isAuthenticated}
            authReady={authReady}
            guests={guests}
            events={events}
            loadingData={loadingAdminData}
            recentArrival={recentArrival}
            onAdminLogin={handleAdminLogin}
            onAdminLogout={handleAdminLogout}
            onOpenKioskForEvent={(evId) => navigateTo('kiosk', evId, false)}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer
        className={`border-t border-slate-200 bg-white pt-5 px-4 sm:px-6 lg:px-8 no-print ${
          !isQrDirectMode ? 'pb-20 md:pb-5' : 'pb-5'
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500 text-center sm:text-left">
          <span>{activeHeadingName} · Buku Tamu Digital QR Real-Time</span>
          <span>
            Data tersimpan aman &amp; siap ekspor Excel / PDF ·{' '}
            <span className="font-medium text-slate-700">Created by ryhn_ardi</span>
          </span>
        </div>
      </footer>

      {/* Mobile Bottom Navigation Bar */}
      {!isQrDirectMode && (
        <nav
          aria-label="Navigasi Mobile"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-3 no-print"
        >
          <button
            type="button"
            onClick={() => navigateTo('checkin', activeEventId, false)}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              viewMode === 'checkin' ? 'text-teal-700' : 'text-slate-500'
            }`}
          >
            <ClipboardPen className="w-5 h-5" />
            <span>Buku Tamu</span>
          </button>
          <button
            type="button"
            onClick={() => navigateTo('kiosk', activeEventId, false)}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              viewMode === 'kiosk' ? 'text-teal-700' : 'text-slate-500'
            }`}
          >
            <QrCode className="w-5 h-5" />
            <span>QR Kiosk</span>
          </button>
          <button
            type="button"
            onClick={() => navigateTo('admin', activeEventId, false)}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
              viewMode === 'admin' ? 'text-teal-700' : 'text-slate-500'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span>Admin</span>
          </button>
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <GuestbookApp />
    </ErrorBoundary>
  );
}
