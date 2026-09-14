# Expo Map — ekspo zali xaritasi va sotuv paneli

**Muammo:** xarita Figma'da qo'lda chizilardi → bloklar ko'chib ketardi, stendlarda ID yo'q edi,
bitta joy ikki marta sotilardi, mijoz "men sotib olgan joy bu emas" deb shikoyat qilardi.

**Yechim:** xarita **qo'lda chizilmaydi** — u bitta `layout/*.json` fayldan **formula bo'yicha** chiziladi.
O'lchamlar qat'iy: **1 stend = 3×3 m = 9 m²**, **1 blok = 8 stend = 72 m²**.
Xato layout mijozga chiqib ketmasligi uchun har bir o'zgarish **validatordan** o'tadi.

```
layout/hall-A.json  ──validate──▶  OK bo'lsa:  ┌─ sotuv paneli (brauzer, hamma sotuvchi uchun umumiy holat)
  (yagona manba)                                ├─ mijozga yuboriladigan SVG/PDF
                                                └─ CSV eksport / hisobot
```

---

## 1. Tez boshlash

```bash
node server.mjs                 # yoki: npm start      → http://localhost:4173
```

Brauzerda ochiladi (telefonda ham ishlaydi). Demo loginlar (`data/sellers.example.json`):

| Sotuvchi | PIN | Huquq |
|---|---|---|
| Aziz Karimov | `1111` | oddiy sotuvchi |
| Dilnoza Yusupova | `2222` | oddiy sotuvchi |
| Menejer | `9999` | admin: jurnal, boshqalarning yozuvini bo'shatish |

Ishga tushirishdan oldin **albatta** `data/sellers.example.json` → `data/sellers.json` qilib nusxalab,
PIN'larni almashtiring (faylda `role: "admin"` — menejer).

## 2. Sotuvchi nima qiladi (3 qadam)

1. **Xaritadan bosadi** — bitta stend (9 m²) yoki blok yorlig'i `A-01 · 72 m²` (butun blok, 8 stend).
2. O'ng paneldagi **mijoz** maydonlarini to'ldiradi (ism, telefon, kompaniya).
3. **Bron qilish** (muddatli, muddat tugasa avtomatik bo'shaydi) yoki **Sotish**.
   Tasdiqlash oynasida aynan qaysi stend ID'lari ketayotgani va summa ko'rinadi → keyin **kvitansiya**.

Band joy ustiga bosilsa tizim ogohlantiradi: kim, qachon, qaysi sotuvchi band qilgani ko'rsatiladi.
Ikki sotuvchi bir vaqtda bir joyni sotsa — ikkinchisi **rad etiladi** (`409 conflict`), chalkashmaydi.

**Mijozga havola:** `Mijoz ko'rinishi` tugmasi `?mode=client` havolasini nusxalaydi —
u havolada faqat xarita va holat ko'rinadi (login, narx kiritish yo'q).
**Chop etish / PDF:** sahifadagi `Chop etish / PDF` tugmasi A3 landshaft varaq chiqaradi:
xarita + legenda + bo'sh joylar ro'yxati + bloklar jadvali (har biri 72 m²).

## 3. Layout — yagona haqiqat manbai

`layout/hall-A.json` — zalning o'lchamlari, obyektlari (kirish, sahna, WC, ustunlar) va bloklarning
**boshlanish nuqtasi + ustun/qator soni**. Stend koordinatalari shu yerdan hisoblanadi:

```
stend.x = blok.x + ustun × 3 m
stend.y = blok.y + qator  × 3 m
stend.id = "A-01-05"        (blok-raqam; mijoz shartnomasida ham aynan shu ID yoziladi)
```

```json
{ "id": "A-01", "x": 4, "y": 6, "cols": 4, "rows": 2 }
```

`cols × rows` **doim 8** bo'lishi kerak (72 m²). Nostandart shakl kerak bo'lsa:
`"stands": [{ "col": 0, "row": 0, "no": 1 }, ...]` — lekin stendlar uzluksiz (yonma-yon) bo'lishi shart,
aks holda validator blokni rad etadi.

### Validator nimalarni ushlaydi

`node tools/validate-layout.mjs layout/hall-A.json` (sert xato — xarita chiqmaydi):

* stend 9 m² emas / blok 72 m² emas / blokda 8 tadan boshqa stend;
* stendlar **ustma-ust tushishi** yoki **uzilib qolishi** (mapping xatolarining asosiy manbai);
* bloklar bir-biriga yopishib qolishi, **yo'lakcha 2 m dan tor** (ogohlantirish);
* stend ustun/sahna/devor ustiga chiqib ketishi, zal chegarasidan tashqariga chiqishi;
* ID takrorlanishi.

```bash
npm run check          # validator + 12 ta regressiya testi (tools/test-validator.mjs)
```

## 4. Mijozga yuboriladigan xarita fayli

```bash
node tools/export-svg.mjs                        # exports/hall-A.svg  (butun zal, hozirgi holat bilan)
node tools/export-svg.mjs --block A-01 --scale 40 # exports/hall-A-A-01.svg (faqat 72 m² blok kartasi)
node tools/export-svg.mjs --no-state              # barcha joylar bo'sh holda (katalog/bozor uchun)
```

SVG har qanday brauzerda ochiladi; undan PNG/PDF olish mumkin. Chop etishda "xarita versiyasi"
(`layout v1.0.0`) va sana faylda ko'rinadi — qaysi fayl yuborilganini keyin aniqlash oson.

**Qoida:** mijozga faqat shu skript chiqargan fayl yuboriladi. Figma/Photoshop'dan saqlangan
rasm yuborilmaydi — aks holda xarita bilan holat yana ajralib ketadi.

## 5. Yangi zal yoki mavjud ro'yxatni ko'chirish

Excel/CSV ni to'g'ridan-to'g'ri layout'ga aylantirish:

```csv
blok,x,y,ustunlar,qatorlar,guruh,izoh
A-01,4,6,4,2,1-qator,
A-02,22,6,4,2,1-qator,Sahnaga yaqin
```

```bash
node tools/import-csv.mjs blocks.csv --hall "A zal" --width 66 --height 44 \
     --price 1250000 --out layout/hall-A.json
```

Skript oxirida validator natijasini ko'rsatadi. Xato bo'lsa — fayl yozilgan bo'lsa ham xarita chiqmaydi,
to'g'rilab qayta ishga tushirasiz. Nostandart shakl uchun: `--mode stands` (`stend,blok,x,y`).

## 6. Server: API va ma'lumot

Server — bitta Node fayli, tashqi kutubxonasiz (`server.mjs`). Ma'lumot `data/` da:

| Fayl | Nima |
|---|---|
| `data/state.json` | barcha bron/sotuvlar (yagona haqiqat), `revision` bilan |
| `data/audit.log` | har bir amal jurnali: kim, qachon, qaysi joy, kimga (JSON lines, o'chirilmaydi) |
| `data/sellers.json` | sotuvchilar va PIN'lar (`role: admin` — menejer) |

| Endpoint | Vazifa |
|---|---|
| `POST /api/login` | `{name, pin}` → token |
| `GET /api/layout` | zal, bloklar, stendlar (koordinatalar bilan) |
| `GET /api/state` | bron/sotuv holati + `revision` |
| `POST /api/action` | `reserve` \| `sell` \| `release` \| `block` (atomik, konfliktni rad etadi) |
| `GET /api/audit` | amallar jurnali (faqat admin) |
| `GET /api/export.csv` | to'liq ro'yxat: stend, holat, mijoz, summa, sotuvchi (Excel uchun) |

**Demo holat:** `node tools/demo.mjs --seed` bir nechta bron/sotuv qo'shadi (ranglar ko'rinadi),
`node tools/demo.mjs --reset` hammasini bo'shatadi — sinovdan keyin toza holat kerak bo'lsa.

**Zaxira (backup):** har kuni ish oxirida `data/state.json` va `data/audit.log` nusxalanadi
(`cp data/state.json backups/state-$(date +%F).json`). Fayllar kichik, 1 daqiqada bajariladi.

## 7. Xavfsizlik va cheklovlar (hozirgi bosqich)

* PIN — oddiy himoya, ichki foydalanish uchun; internetga ochiq qo'yishdan oldin **HTTPS + kuchli
  parol/SSO** qilinishi kerak.
* Server bitta jarayonda — kichik jamoa (5–10 sotuvchi) uchun yetarli. Katta yuklamada keyingi bosqich:
  PostgreSQL (yoki SQLite) + WebSocket (jonli yangilanish).
* Hozir yangilanish 8 sekundda bir marta (so'rov orqali). Ishlab chiqarishda WebSocket qilinadi.

## 8. Keyingi bosqichlar (taklif)

1. **Shartnoma moduli** — stend ID, maydon (9/72 m²), narx va xarita versiyasi avtomatik shartnomaga tushadi.
2. **Mijoz portali** — shaxsiy havola: o'zi to'lagan joylar, to'lov holati, QR-check-in (kelganda skaner).
3. **To'lov integratsiyasi** (Payme/Click yoki bank), hisob-faktura va akt generatsiyasi.
4. **Zallar boshqaruvi** — bir nechta zal, tadbir sanasi bo'yicha alohida holat (bugun A zal, keyingi hafta B zal).
5. **Excel'dan import** — mavjud shartnomalar bazasini bir marta ko'chirish (`tools/import-csv.mjs` kengaytmasi).

## 9. Fayllar

```
server.mjs              # API + statik fayllar (bog'liqliksiz)
lib/layout.mjs          # layout yadrosi: 9 m²/72 m² qoidalari, expand + validate
layout/hall-A.json      # A zalning yagona manbasi (namuna)
app/index.html|style.css|app.js   # sotuv paneli (vanilla JS, build yo'q)
tools/validate-layout.mjs         # CLI validator (CI uchun)
tools/test-validator.mjs          # 12 ta buzilgan layout testi
tools/export-svg.mjs              # mijozga yuboriladigan xarita (SVG)
tools/import-csv.mjs              # Excel/CSV → layout JSON
tools/demo.mjs                    # demo holat: --seed / --reset
tests/smoke.mjs                   # UI smoke-test (jsdom; ishlab turgan serverga qarshi)
exports/                # chiqarilgan xaritalar
data/                   # holat + jurnal (git'ga tushmaydi)
```

## 10. Ishga tushirish (server)

```bash
# oddiy holatda
node server.mjs

# systemd (Linux server) misoli
# /etc/systemd/system/expo-map.service
[Unit]
Description=Expo Map sotuv paneli
After=network.target
[Service]
WorkingDirectory=/srv/expo-map
ExecStart=/usr/bin/node server.mjs
Restart=always
Environment=PORT=4173
[Install]
WantedBy=multi-user.target
```

Oldinda nginx + HTTPS + ichki tarmoq (faqat ofis/sotuvchilar uchun) — mijoz portali esa alohida
subdomen orqali. Bu bosqichga o'tishdan oldin `data/sellers.json` ni kuchli parolga o'tkazamiz.
