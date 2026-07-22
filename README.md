# WhatsApp Indonesia Dynamic QRIS & Invoicing Bot 🇮🇩

WhatsApp Bot untuk memproses pembayaran **QRIS Indonesia**, mengubah **QRIS Statis menjadi QRIS Dinamis** (dengan nominal transaksi yang tersemat otomatis secara sah sesuai spesifikasi EMVCo), membuat invoice terstruktur dengan timestamp presisi, mengelola riwayat transaksi, melakukan penolakan/pelunasan pembayaran, serta meneruskan foto bukti transfer ke Admin Toko secara real-time.

Dilengkapi dengan manajemen **PM2** untuk deployment server produksi yang handal 24/7.

---

## 🌟 Fitur Utama

- 🔄 **QRIS Statis ke Dinamis (EMVCo Compliant)**: 
  Mengubah QRIS Statis merchant menjadi QRIS Dinamis sesuai spesifikasi Bank Indonesia & EMVCo Standard. Mengubah Tag `01` ke `12`, menyisipkan Tag `54` (nominal tagihan) tepat setelah Tag `53` (mata uang IDR `360`), dan menghitung ulang **CRC16-CCITT Checksum (0x1021)**.
- 🖼️ **Gambar Kode QRIS Otomatis dalam 1 Pesan**: 
  Menghasilkan gambar QR code (PNG) resolusi tinggi dan mengirimkannya sebagai lampiran gambar di WhatsApp dengan caption deskripsi invoice terstruktur lengkap.
- 📋 **Nomor Invoice Monospaced (1-Tap Copy)**:
  Nomor invoice diformat sebagai inline code block (contoh: `INV-20260722-0001`) sehingga pelanggan atau admin cukup men-tap 1x di WhatsApp untuk menyalin nomor invoice secara instan.
- 🔖 **Pencarian Nomor Invoice Fleksibel (Tanpa Prefix `INV-`)**:
  Perintah bot seperti `!markpaid`, `!reject`, dan `!status` mendukung nomor invoice tanpa mengetik prefix `INV-` (contoh: `!markpaid 20260722-0001` atau `!markpaid INV-20260722-0001`).
- 🏷️ **Tag / Mention Pelanggan Otomatis**:
  Dalam obrolan grup (*group chat*), bot secara otomatis men-tag (`@nomor`) pengguna pelanggan saat menerbitkan invoice, mengonfirmasi bukti transfer, melunasi, atau menolak pembayaran agar pesan tidak tertukar antar-pelanggan.
- 👥 **Dukungan Banyak Admin (Multi-Admin)**:
  Mendukung lebih dari 1 nomor/JID Admin (LID JID `@lid` atau nomor HP `@s.whatsapp.net`). Seluruh Admin terdaftar dapat mengeksekusi perintah admin dan menerima notifikasi dengan deduplikasi pintar tanpa spam.
- ❌ **Fitur Penolakan Bukti Transfer (`!reject`)**:
  Admin dapat menolak bukti transfer yang tidak jelas atau tidak valid dengan memberikan alasan penolakan (`!reject <no_invoice> [alasan]`). Bot otomatis memperbarui status dan meminta pelanggan mengirim ulang bukti yang valid.
- 📊 **Perintah Rekap Transaksi (`!recap` / `!rekap`)**:
  Merangkum seluruh transaksi yang sedang **aktif (pending / verifikasi)** dan **ditolak** beserta akumulasi total nominal tagihan dan tag pengguna.
- 📸 **Deteksi & Forward Bukti Transfer**:
  Pelanggan cukup membalas (*reply*) foto pesan QRIS invoice dengan foto screenshot bukti pembayaran. Bot otomatis meneruskan foto bukti ke Admin toko.
- 💬 **Dukungan Group & Private Chat (DM)**: Bekerja di grup WhatsApp (`@g.us`) maupun Chat Pribadi (`@s.whatsapp.net`).
- 🚀 **PM2 Deployment Manager**: Konfigurasi `ecosystem.config.js` untuk manajemen proses background, auto-restart, dan rotasi log.

---

## 📁 Struktur Proyek

```
d:/goqris/
├── .env                  # Konfigurasi environment (Admin, Store Name, QRIS Statis)
├── .env.example          # Template contoh environment
├── ecosystem.config.js   # Konfigurasi deployment PM2
├── package.json          # Manifest dependensi & skrip npm
├── src/
│   ├── index.js          # Entry point utama aplikasi
│   ├── bot/              # Klien WhatsApp Baileys & Router Pesan
│   │   ├── client.js           # Socket WhatsApp & pairing QR terminal
│   │   ├── commands.js         # Logika penanganan perintah (!qris, !invoice, !reject, !recap, dll)
│   │   ├── message-handler.js  # Router pesan DM & Group
│   │   └── proof-handler.js    # Penanganan foto screenshot bukti transfer
│   ├── database/         # Penyimpanan database SQLite (Node native sqlite)
│   │   ├── db.js               # Koneksi & skema SQLite
│   │   └── invoice-repo.js     # Repository data invoice & statistik
│   ├── qris/             # Engine konversi QRIS & CRC16
│   │   ├── crc16.js            # Algoritma checksum CRC16-CCITT (0x1021)
│   │   ├── parser.js           # Parser & builder format TLV EMVCo
│   │   ├── converter.js        # Converter Statis -> Dinamis
│   │   ├── qr-generator.js     # Generator gambar QR Code (PNG Buffer)
│   │   └── qr-reader.js        # Reader QR Code dari gambar yang diupload
│   └── services/
│       └── invoice-service.js  # Formatter teks invoice, Rupiah, & Notifikasi Admin
└── test/
    └── test-qris.js      # Suite pengujian otomatis (Unit & Integration Tests)
```

---

## ⚙️ Persyaratan Sistem & Instalasi

### 1. Requirements
- **Node.js**: v20.x atau v24.x (menggunakan `node:sqlite` bawaan).
- **PM2**: `npm install -g pm2` (untuk deployment server).

### 2. Instalasi
```bash
# Clone atau buka direktori proyek
cd d:/goqris

# Install dependensi
npm install
```

### 3. Konfigurasi Environment (`.env`)
Buat file `.env` berdasarkan `.env.example`:
```ini
# Admin WhatsApp JID atau Nomor HP (Mendukung banyak admin, pisahkan dengan koma)
# Contoh admin tunggal: ADMIN_JID=197341567021139@lid
# Contoh banyak admin:  ADMIN_JID=197341567021139@lid, 628999888777@s.whatsapp.net
ADMIN_JID=197341567021139@lid

# String Payload QRIS Statis Toko
DEFAULT_STATIC_QRIS=00020101021126610014COM.GO-JEK.WWW01189360091434842069580210G4842069580303UMI51440014ID.CO.QRIS.WWW0215ID10265535641090303UMI5204899953033605802ID5925ABYN.XYZ, Digital & Kreat6006BANTUL61055575262070703A0163045B58

# Nama Toko / Usaha
STORE_NAME=ABYN.XYZ DIGITAL & KREATIF

# Prefix perintah bot (default: !)
BOT_PREFIX=!

# Lokasi penyimpanan database SQLite
DB_PATH=./data/qris_bot.db
```

---

## 🚀 Jalankan Aplikasi

### Modus Pengujian / Dev
```bash
# Jalankan suite pengujian unit & integrasi
npm test

# Jalankan bot dalam mode langsung
npm start
```

Saat pertama kali dijalankan, kode QR untuk login WhatsApp akan muncul di terminal. Scan kode QR tersebut menggunakan fitur **Perangkat Tertaut (Linked Devices)** di aplikasi WhatsApp HP Anda.

---

## 📦 Deployment dengan PM2

Untuk menjalankan bot secara terus-menerus di server produksi:

```bash
# Jalankan bot via PM2
npm run start:pm2

# Cek status proses PM2
npm run status:pm2

# Cek log aplikasi PM2 secara real-time
npm run logs

# Restart bot
npm run restart:pm2

# Hentikan bot
npm run stop:pm2
```

---

## 📖 Panduan Perintah (Commands Reference)

### Perintah Umum (Pelanggan & Admin di Group & DM)
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `!qris <nominal> [keterangan]` | Buat QRIS Dinamis cepat beserta gambar QR. | `!qris 15000 Kopi Susu` |
| `!invoice <nominal> \| <rincian> \| [catatan]` | Buat invoice terstruktur lengkap dengan rincian barang. | `!invoice 50000 \| Kopi Susu x2, Roti x1 \| Tanpa Gula` |
| `!status [no_invoice]` | Cek status invoice (Menunggu Pembayaran, Verifikasi Admin, Lunas, Ditolak). | `!status 20260722-0001` |
| `!recap` / `!rekap` | Rekap daftar transaksi aktif (pending) & ditolak (rejected). | `!recap` |
| `!history` | Lihat riwayat transaksi terakhir. | `!history` |
| `📸 Balas Foto` | Balas (reply) foto QRIS invoice dengan mengunggah screenshot bukti transfer. | *(Kirim gambar)* |
| `!help` | Tampilkan menu bantuan bot. | `!help` |

### Perintah Khusus Admin (`ADMIN_JID`)
| Perintah Admin | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `!markpaid <no_invoice>` | Konfirmasi pelunasan invoice menjadi **LUNAS** dan beri tahu pelanggan. | `!markpaid 20260722-0001` |
| `!reject <no_invoice> [alasan]` | Tolak bukti pembayaran dengan alasan penolakan dan minta screenshot baru. | `!reject 20260722-0001 Foto buram` |
| `!recap` / `!rekap` | Lihat rekap seluruh transaksi aktif & ditolak dari semua pelanggan toko. | `!recap` |
| `!stats` | Lihat ringkasan omset penjualan toko, total invoice lunas, pending, & ditolak. | `!stats` |
| `!setqris <string_atau_foto>` | Update QRIS Statis Toko dari teks atau foto QRIS dengan caption `!setqris`. | `!setqris 000201010211...` |
| `!history [limit]` | Lihat riwayat transaksi seluruh pelanggan. | `!history 10` |

---

## 🧪 Verifikasi Pengujian

Seluruh pengujian teknis mencakup:
1. **Perhitungan Checksum CRC16-CCITT**.
2. **Konversi Tag TLV EMVCo (01->12, Tag 54 nominal setelah Tag 53)**.
3. **Pembangkitan Buffer Gambar PNG Kode QR**.
4. **Pencarian Nomor Invoice Tanpa Prefix `INV-`**.
5. **Alur Penolakan (`!reject`) & Rekap Transaksi (`!recap`)**.
6. **Deduplikasi Notifikasi Multiple Admin (`ADMIN_JID`)**.

Untuk menjalankan pengujian:
```bash
npm test
```

---
*Copyright © abyn.xyz*
