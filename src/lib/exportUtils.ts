import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { GuestEntry } from '../types/guestbook';

export function formatGuestTimestamp(timestamp: GuestEntry['createdAt']): string {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatGuestTimeOnly(timestamp: GuestEntry['createdAt']): string {
  if (!timestamp) return '--:--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function exportGuestsToExcel(guests: GuestEntry[], eventTitle: string): void {
  const rows = guests.map((guest, index) => ({
    No: index + 1,
    'Waktu Hadir': formatGuestTimestamp(guest.createdAt),
    'Nama Lengkap': guest.nama,
    'Kategori Asal': guest.kategoriAsal,
    'Asal Daerah / Instansi / Sekolah / Kantor': guest.asal,
    'Pesan dan Kesan': guest.pesan,
    Status: guest.status === 'terverifikasi' ? 'Terverifikasi' : 'Hadir',
    'ID Acara': guest.eventId,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 5 },
    { wch: 20 },
    { wch: 26 },
    { wch: 22 },
    { wch: 34 },
    { wch: 48 },
    { wch: 15 },
    { wch: 18 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Daftar Tamu');

  const safeSlug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'buku-tamu';
  const dateStamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${safeSlug}-${dateStamp}.xlsx`);
}

export function exportGuestsToPdf(
  guests: GuestEntry[],
  eventTitle: string,
  eventLocation?: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const nowStr = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text(`Laporan Buku Tamu Digital — ${eventTitle}`, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  const subtitleParts = [
    eventLocation ? `Lokasi: ${eventLocation}` : null,
    `Total Pengunjung: ${guests.length} orang`,
    `Diekspor: ${nowStr}`,
  ].filter(Boolean);
  doc.text(subtitleParts.join('   |   '), 14, 23);

  const tableBody = guests.map((guest, index) => [
    String(index + 1),
    formatGuestTimestamp(guest.createdAt),
    guest.nama,
    `${guest.asal}\n(${guest.kategoriAsal})`,
    guest.pesan,
    guest.status === 'terverifikasi' ? 'Terverifikasi' : 'Hadir',
  ]);

  autoTable(doc, {
    startY: 28,
    head: [[
      'No',
      'Waktu Hadir',
      'Nama Lengkap',
      'Asal Daerah / Instansi / Sekolah / Kantor',
      'Pesan dan Kesan',
      'Status',
    ]],
    body: tableBody,
    styles: {
      font: 'helvetica',
      fontSize: 9,
      cellPadding: 3,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'top',
    },
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 34 },
      2: { cellWidth: 44 },
      3: { cellWidth: 58 },
      4: { cellWidth: 'auto' },
      5: { cellWidth: 26, halign: 'center' },
    },
    didDrawPage: (data) => {
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `TamuKita Digital Guestbook · Halaman ${data.pageNumber} dari ${pageCount}`,
        14,
        doc.internal.pageSize.getHeight() - 8
      );
    },
  });

  const safeSlug = eventTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'buku-tamu';
  const dateStamp = new Date().toISOString().slice(0, 10);
  doc.save(`${safeSlug}-${dateStamp}.pdf`);
}
