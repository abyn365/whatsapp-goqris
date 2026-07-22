# WhatsApp Indonesia Dynamic QRIS & Invoicing Bot 🇮🇩

WhatsApp Bot untuk memproses pembayaran **QRIS Indonesia**, mengubah **QRIS Statis menjadi QRIS Dinamis** (dengan nominal transaksi yang tersemat otomatis), membuat invoice terstruktur dengan timestamp presisi, mengelola riwayat transaksi, serta meneruskan foto bukti transfer ke nomor WhatsApp Admin.

Dilengkapi dengan manajemen **PM2** untuk deployment server produksi yang handal 24/7.

---

## 🌟 Fitur Utama

- 🔄 **QRIS Statis ke Dinamis**: Mengubah QRIS Statis merchant menjadi QRIS Dinamis sesuai spesifikasi EMVCo / Bank Indonesia. Mengubah Tag `01` ke `12`, menyisipkan Tag `54` (nominal tagihan), dan menghitung ulang **CRC16-CCITT Checksum**.
- 🖼️ **Gambar Kode QRIS Otomatis**: Menghasilkan gambar QR code (PNG) resolusi tinggi dan mengirimkannya sebagai lampiran gambar di WhatsApp.
- 🧾 **Sistem Invoicing Terstruktur**:
  - Timestamp waktu transaksi presisi (`DD/MM/YYYY HH:mm:ss WIB`).
  - Mendukung rincian barang/layanan (`!invoice <nominal> | <rincian> | [catatan]`).
  - Nomor Invoice unik otomatis (contoh: `INV-20260722-0001`).
- 📸 **Deteksi & Forward Bukti Transfer**:
  - Pelanggan cukup mengirimkan / membalas pesan invoice dengan foto screenshot bukti pembayaran.
  - Bot otomatis mendeteksi invoice pending pelanggan, mengunggah bukti ke folder lokal, dan **meneruskan foto bukti ke WhatsApp Admin** beserta detail transaksi dan tombol konfirmasi cepat.
- 👑 **Fitur khusus Admin**:
  - Konfirmasi pelunasan invoice (`!markpaid <no_invoice>`).
  - Cek statistik omset / penjualan (`!stats`).
  - Lihat riwayat transaksi (`!history`).
  - Update QRIS Statis toko langsung dari pesan atau foto QRIS (`!setqris`).
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
│   │   ├── commands.js         # Logika penanganan perintah (!qris, !invoice, dll)
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
# Nomor WhatsApp Admin (format internasional tanpa +, contoh: 6281234567890)
ADMIN_NUMBER=6281234567890

# String Payload QRIS Statis Toko
DEFAULT_STATIC_QRIS=00020101021126680016ID.CO.QRIS.WWW01189360091400000000000215ID10265535641090303A0151440014ID.LINKAJA.WWW01189360091400000000005204581253033605802ID5910ABYN.XYZ, 6013KOTA JAKARTA 61051234562070703A0163048D64

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

### Perintah Umum (Dapat digunakan Pelanggan di Group & DM)
| Perintah | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `!qris <nominal> [keterangan]` | Buat QRIS Dinamis cepat beserta gambar QR. | `!qris 15000 Kopi Susu` |
| `!invoice <nominal> \| <rincian> \| [catatan]` | Buat invoice terstruktur lengkap dengan rincian barang. | `!invoice 50000 \| Kopi Susu x2, Roti x1 \| Tanpa Gula` |
| `!status [no_invoice]` | Cek status invoice (PENDING, PROOF_SUBMITTED, PAID). | `!status INV-20260722-0001` |
| `!history` | Lihat riwayat transaksi terakhir. | `!history` |
| `📸 Kirim Foto` | Balas/kirim screenshot bukti transfer ke chat. | *(Kirim gambar)* |
| `!help` | Tampilkan menu bantuan bot. | `!help` |

### Perintah Khusus Admin (`ADMIN_NUMBER`)
| Perintah Admin | Deskripsi | Contoh |
| :--- | :--- | :--- |
| `!markpaid <no_invoice>` | Konfirmasi pembayaran invoice menjadi **PAID / LUNAS** dan beri tahu pelanggan. | `!markpaid INV-20260722-0001` |
| `!stats` | Lihat ringkasan omset penjualan, total invoice lunas & pending. | `!stats` |
| `!setqris <string_qris>` | Perbarui string QRIS Statis Toko. Bisa juga dengan mengirim foto QRIS + caption `!setqris`. | `!setqris 000201010211...` |

---

## 🧪 Verifikasi Pengujian

Seluruh pengujian teknis mencakup:
1. **Perhitungan Checksum CRC16-CCITT**.
2. **Konversi Tag TLV EMVCo (01->12, Tag 54 nominal)**.
3. **Pembangkitan Buffer Gambar PNG Kode QR**.
4. **Pencatatan Timestamp & Status Invoice pada Database SQLite**.

Untuk menjalankan pengujian:
```bash
npm test
```
