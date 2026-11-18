import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { GuestEntry } from '../types/guestbook';

export function toJsDate(timestamp: GuestEntry['createdAt'] | string): Date | null {
  if (!timestamp) return null;
  if (typeof timestamp === 'object' && 'toDate' in timestamp && typeof timestamp.toDate === 'function') {
    const d = timestamp.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof timestamp === 'string') {
    const d = new Date(timestamp);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatGuestTimestamp(timestamp: GuestEntry['createdAt'] | string): string {
  const date = toJsDate(timestamp);
  if (!date) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatGuestTimeOnly(timestamp: GuestEntry['createdAt'] | string): string {
  const date = toJsDate(timestamp);
  if (!date) return '--:--';
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
    'Stand Dikunjungi': guest.stand || '-',
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
    { wch: 24 },
    { wch: 46 },
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
    guest.stand || '-',
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
      'Stand Dikunjungi',
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
      1: { cellWidth: 32 },
      2: { cellWidth: 40 },
      3: { cellWidth: 50 },
      4: { cellWidth: 34 },
      5: { cellWidth: 'auto' },
      6: { cellWidth: 24, halign: 'center' },
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
