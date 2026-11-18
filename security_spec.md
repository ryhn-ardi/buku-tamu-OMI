# Security Specification — Buku Tamu Digital

## 1. Data Invariants
1. A `GuestEntry` in `/guests/{guestId}` MUST have a valid alphanumeric/dash/underscore `guestId` and `eventId`.
2. Guests submitting via QR code may create a `GuestEntry` only with `status == 'hadir'`, `createdAt == request.time`, bounded field lengths (`nama` 2–100, `asal` 2–150, `pesan` 2–1000), and valid `kategoriAsal` enum.
3. If the referenced `/events/{eventId}` exists, it MUST have `isActive == true` for a guest submission to succeed. Non-default event IDs MUST exist in `/events/{eventId}`.
4. Updates to `/guests/{guestId}` MUST preserve immutable fields (`createdAt`, `eventId`), enforce valid schema bounds, and restrict mutations via `affectedKeys().hasOnly(['nama', 'asal', 'kategoriAsal', 'pesan', 'status'])`.
5. Creating and updating `/events/{eventId}` MUST enforce valid schema bounds (`headingName` 1–80, `bannerImage <= 350000`, `title` 2–120), preserve `createdBy` and `createdAt`, set `updatedAt == request.time`, and restrict mutations via `affectedKeys().hasOnly(...)`. Deleting events remains restricted to `isAdmin()` and cannot delete `main-guestbook`.
6. `/admins/{adminId}` remains locked behind Firebase Auth `isAdmin()` checks, while admin dashboard authentication in the UI uses a dedicated username/password gate without Google Sign-In.

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on Guest Create**: `{ "eventId": "main-guestbook", "nama": "Budi", "asal": "Jakarta", "kategoriAsal": "Umum / Daerah", "pesan": "Sukses selalu", "status": "hadir", "createdAt": "<serverTime>", "isAdmin": true }` -> Rejected by `hasOnly(...)`.
2. **Pre-verified Status Escalation on Guest Create**: Same payload with `"status": "terverifikasi"` -> Rejected by `incoming().status == 'hadir'`.
3. **Timestamp Spoofing on Guest Create**: `"createdAt": "2020-01-01T00:00:00Z"` -> Rejected by `incoming().createdAt == request.time`.
4. **Denial of Wallet 1MB String on Guest Name**: `"nama": "<200KB string>"` -> Rejected by `nama.size() <= 100`.
5. **ID Poisoning on Document Path**: `/guests/invalid$id!with/spaces` -> Rejected by `isValidId(guestId)`.
6. **Submission to Paused/Closed Event**: `eventId: "seminar-2026"` where `events/seminar-2026.isActive == false` -> Rejected by `get(...).data.isActive == true`.
7. **Orphaned Non-Default Event**: `eventId: "nonexistent-event"` -> Rejected by `exists(...)`.
8. **Shadow Field Injection on Event Update**: Attempting to alter `createdBy` or inject arbitrary keys on `/events/{eventId}` -> Rejected by `incoming().createdBy == existing().createdBy` and `affectedKeys().hasOnly(...)`.
9. **Default Event Deletion**: Attempting to delete `/events/main-guestbook` -> Rejected by `eventId != 'main-guestbook'`.
10. **Email Spoofing Attack on `/admins`**: Auth token with `email == 'reyhan.masamune@gmail.com'` and `email_verified == false` -> Rejected by `isAdmin()`.
11. **Self-Assigned Admin Escalation**: Non-admin user creating `/admins/{uid}` -> Rejected by `allow create: if isAdmin()`.
12. **Immutable Field Mutation on Update**: Actor attempting to alter `createdAt` or `eventId` on `/guests/{guestId}` -> Rejected by `incoming().createdAt == existing().createdAt && incoming().eventId == existing().eventId`.
