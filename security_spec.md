# Security Specification — Buku Tamu Digital

## 1. Data Invariants
1. A `GuestEntry` in `/guests/{guestId}` MUST have a valid alphanumeric/dash/underscore `guestId` and `eventId`.
2. Guests submitting via QR code may create a `GuestEntry` only with `status == 'hadir'`, `createdAt == request.time`, bounded field lengths (`nama` 2–100, `asal` 2–150, `pesan` 2–1000), and valid `kategoriAsal` enum.
3. If the referenced `/events/{eventId}` exists, it MUST have `isActive == true` for a guest submission to succeed. Non-default event IDs MUST exist in `/events/{eventId}`.
4. Reading (`get`, `list`), updating, and deleting `/guests/{guestId}` is strictly restricted to verified administrators (`isAdmin()`).
5. Creating, updating, deleting, and listing `/events/{eventId}` is restricted to verified administrators (`isAdmin()`), while single-document `get` on `/events/{eventId}` is permitted so the QR check-in page can load event details.
6. Admin privilege checks verify `request.auth.token.email_verified == true` and either an explicit record in `/admins/{uid}` or the bootstrapped admin email.

## 2. Dirty Dozen Adversarial Payloads
1. **Shadow Field Injection on Guest Create**: `{ "eventId": "main-guestbook", "nama": "Budi", "asal": "Jakarta", "kategoriAsal": "Umum / Daerah", "pesan": "Sukses selalu", "status": "hadir", "createdAt": "<serverTime>", "isAdmin": true }` -> Rejected by `hasOnly(...)`.
2. **Pre-verified Status Escalation on Guest Create**: Same payload with `"status": "terverifikasi"` -> Rejected by `incoming().status == 'hadir'`.
3. **Timestamp Spoofing on Guest Create**: `"createdAt": "2020-01-01T00:00:00Z"` -> Rejected by `incoming().createdAt == request.time`.
4. **Denial of Wallet 1MB String on Guest Name**: `"nama": "<200KB string>"` -> Rejected by `nama.size() <= 100`.
5. **ID Poisoning on Document Path**: `/guests/invalid$id!with/spaces` -> Rejected by `isValidId(guestId)`.
6. **Submission to Paused/Closed Event**: `eventId: "seminar-2026"` where `events/seminar-2026.isActive == false` -> Rejected by `get(...).data.isActive == true`.
7. **Orphaned Non-Default Event**: `eventId: "nonexistent-event"` -> Rejected by `exists(...)`.
8. **Public List Scraping of Guest PII**: Unauthenticated or non-admin `list` on `/guests` -> Rejected by `allow list: if isAdmin()`.
9. **Public Update/Delete Tampering**: Non-admin `update` or `delete` on `/guests/{guestId}` -> Rejected by `isAdmin()`.
10. **Email Spoofing Attack**: Auth token with `email == 'reyhan.masamune@gmail.com'` and `email_verified == false` -> Rejected by `isVerifiedUser()`.
11. **Self-Assigned Admin Escalation**: Non-admin user creating `/admins/{uid}` -> Rejected by `allow create: if isAdmin()`.
12. **Immutable Field Mutation on Update**: Admin or actor attempting to alter `createdAt` or `eventId` on `/guests/{guestId}` -> Rejected by `incoming().createdAt == existing().createdAt && incoming().eventId == existing().eventId`.
