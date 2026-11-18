import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutDashboard, QrCode, ClipboardPen } from 'lucide-react';
import {
  adminBootstrap,
  adminCheckSession,
  adminLogin,
  adminLogout,
  setStoredAdminToken,
  subscribeAdminStream,
} from './lib/apiClient';
import {
  DEFAULT_EVENT_FALLBACK,
  DEFAULT_EVENT_ID,
  SCHEMA_LIMITS,
  type AppViewMode,
  type GuestbookEvent,
  type GuestEntry,
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

  const [authReady, setAuthReady] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);

  const [guests, setGuests] = useState<GuestEntry[]>([]);
  const [events, setEvents] = useState<GuestbookEvent[]>([]);
  const [loadingAdminData, setLoadingAdminData] = useState<boolean>(false);
  const [recentArrival, setRecentArrival] = useState<GuestEntry | null>(null);

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

  // Verify existing admin session on initial load
  useEffect(() => {
    let cancelled = false;
    void adminCheckSession()
      .then((valid) => {
        if (!cancelled) {
          setIsAuthenticated(valid);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Load initial admin data & attach SSE real-time stream when authenticated
  useEffect(() => {
    if (!authReady || !isAuthenticated) {
      return;
    }

    let cancelled = false;
    setLoadingAdminData(true);

    void adminBootstrap()
      .then((data) => {
        if (cancelled) return;
        setGuests(data.guests);
        setEvents(data.events);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Gagal memuat data admin:', err);
        setStoredAdminToken(null);
        setIsAuthenticated(false);
        setGuests([]);
        setEvents([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingAdminData(false);
        }
      });

    const unsubStream = subscribeAdminStream((evt) => {
      if (cancelled) return;
      if (evt.type === 'guest-added') {
        const added = evt.payload;
        setGuests((prev) => {
          if (prev.some((g) => g.id === added.id)) return prev;
          return [added, ...prev];
        });
        setRecentArrival(added);
        if (arrivalTimerRef.current) {
          window.clearTimeout(arrivalTimerRef.current);
        }
        arrivalTimerRef.current = window.setTimeout(() => {
          setRecentArrival(null);
        }, 8000);
      } else if (evt.type === 'guest-updated') {
        const updated = evt.payload;
        setGuests((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      } else if (evt.type === 'guest-deleted') {
        const deletedId = evt.payload.id;
        setGuests((prev) => prev.filter((g) => g.id !== deletedId));
      } else if (evt.type === 'event-updated') {
        const savedEvent = evt.payload;
        setEvents((prev) => {
          const exists = prev.some((e) => e.id === savedEvent.id);
          if (exists) {
            return prev.map((e) => (e.id === savedEvent.id ? savedEvent : e));
          }
          return [savedEvent, ...prev];
        });
      }
    });

    return () => {
      cancelled = true;
      unsubStream();
      if (arrivalTimerRef.current) {
        window.clearTimeout(arrivalTimerRef.current);
      }
    };
  }, [authReady, isAuthenticated]);

  const handleAdminLogin = async (username: string, password: string) => {
    await adminLogin(username, password);
    setIsAuthenticated(true);
  };

  const handleAdminLogout = async () => {
    await adminLogout();
    setIsAuthenticated(false);
    setGuests([]);
    setEvents([]);
    setRecentArrival(null);
  };

  const handleGuestUpdated = (updated: GuestEntry) => {
    setGuests((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
  };

  const handleGuestDeleted = (guestId: string) => {
    setGuests((prev) => prev.filter((g) => g.id !== guestId));
  };

  const handleEventSaved = (savedEvent: GuestbookEvent) => {
    setEvents((prev) => {
      const exists = prev.some((e) => e.id === savedEvent.id);
      if (exists) {
        return prev.map((e) => (e.id === savedEvent.id ? savedEvent : e));
      }
      return [savedEvent, ...prev];
    });
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
            onGuestUpdated={handleGuestUpdated}
            onGuestDeleted={handleGuestDeleted}
            onEventSaved={handleEventSaved}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-6 lg:px-8 no-print hidden md:block">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-slate-500">
          <span>{activeHeadingName} · Buku Tamu Digital QR Real-Time</span>
          <span>Data tersimpan aman &amp; siap ekspor Excel / PDF</span>
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
