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
| Sardor Umarov | `3333` | oddiy sotuvchi |
| Menejer | `9999` | admin: jurnal, boshqalarning yozuvini bo'shatish |

Ishlab turgan holda loginlar `data/sellers.json` faylidan olinadi (git'ga tushmaydi) —
fayl formati va izoh: `data/sellers.README.txt`.


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

## 2b. Real chizma (Крытый павильон) — qoralama holati

| Fayl | Nima |
|---|---|
| `layout/hall-A.json` | **Namuna zal** (8 blok × 72 m² = 576 m²) — tizimni sinash va o'rgatish uchun, tasdiqlangan |
| `layout/hall-real.json` | **Sizning real zaliingiz qoralamasi** — 12 guruh (A–F ustunlar = 108 m², pastki qator 72/36 m²) + 6 nostandart stend (A1–A6) |
| `docs/CHIZMA-ANKETA.md` | Tasdiqlash uchun savollar ro'yxati (o'lchamlar, raqamlash, narx) |
| `exports/hall-real-DRAFT.svg` | Qoralama xarita (suv belgisi bilan) — ko'rib chiqish uchun |

Panelni real zaл bilan ochish:

```bash
LAYOUT=layout/hall-real.json STATE=data/state-real.json PORT=4174 node server.mjs
```

**Muhim:** real chizmada asosiy zal kataklari 2×6 = **12 ta** (108 m²) — ya'ni 72 m² (8 stend) qoidasidan
farq qiladi. Shuning uchun bu layoutda `meta.enforceBlockRule = false` (ogohlantirish, xato emas) va
`meta.status = "draft"`. Tasdiqlangach `approved` qilinadi va suv belgisi/havola blokirovkasi o'chadi.

## 3. Layout — yagona haqiqat manbai

`layout/hall-A.json` — zalning o'lchamlari, obyektlari (kirish, sahna, WC, ustunlar) va bloklarning
**boshlanish nuqtasi + ustun/qator soni**. Stend koordinatalari shu yerdan hisoblanadi:

```
stend.x = blok.x + ustun × 3 m
stend.y = blok.y + qator  × 3 m
stend.id = "A-01-05"        (blok-raqam; mijoz shartnomasida ham aynan shu ID yoziladi)
```

```json
{ "id": "A-01", "x": 4, "y": 5, "cols": 2, "rows": 4 }   → 6 m × 12 m = 72 m²
```

**Qoidalar:** standart blokda `cols × rows = 8` (72 m²). Real zalda guruhlar boshqacha bo'lishi mumkin
(masalan 2×6 = 12 stend = 108 m²) — bunday holda `meta.enforceBlockRule = false` qilinadi va tizim
ogohlantirish bilan ishlaydi, har bir guruhning aniq maydonini ko'rsatib.
Nostandart **yakka** stendlar `customStands` bo'limida beriladi (maydoni aniq yoziladi, geometriyasi tekshiriladi):

```json
"customStands": [
  { "id": "A3", "x": 1, "y": 15.3, "w": 6, "h": 4.23, "areaM2": 25.4, "group": "Chap qanot", "color": "#e8a33d" }
]
```

Zonalar (`zones`) — xaritada rangli fon: asosiy zal, chap qanot, B2B, sahna, konferens-zal. Standart shakl — **2 ustun × 4 qator** (6 m × 12 m),
lekin har bir blok o'z shakliga ega bo'lishi mumkin: `cols: 4, rows: 2` (12×6 m), `cols: 8, rows: 1`
(24×3 m) va h.k. Raqamlash standart bo'yicha chapdan-o'ngga, yuqoridan-pastga (`"numbering": "col-major"`
bilan ustun bo'ylab raqamlash ham mumkin). Nostandart shakl kerak bo'lsa:
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

**Eng oson yo'l — tayyor paket** (17–20 fayl bir buyruqda):

```bash
node tools/package.mjs                            # exports/foodera-2026/ ichiga hammasi
node tools/package.mjs --layout layout/hall-A.json --out exports/A-zal
```

Paket ichida:
| Fayl | Kim uchun |
|---|---|
| `01-план-зала-весь.svg` | mijoz/rahbariyat: bo'limlar, bron va sotilgan joylar bilan |
| `01-план-зала-весь.pdf` | shu xaritaning **bitta varaqli** PDF'i (A3 landscape) — yuborish uchun |
| `02-план-свободные-места.svg` | sotuvchi: faqat bo'sh joylar |
| `02-план-свободные-места.pdf` | bo'sh joylar xaritasining bitta varaqli PDF'i |
| `03-раздел-<ID>-*.svg` | mijozga aynan o'z bo'limi (A, B, ... EQ, WING) |
| `04-компании.csv` | band joylar: kompaniya, stend ID lari, summa — **bitta kompaniya = bitta qator** (Excel) |
| `05-свободные-места.csv` | bo'sh joylar ro'yxati narxi bilan |
| `00-ПОЯСНЕНИЕ.txt` | versiya, qoidalar, bo'limlar jadvali |

Paket faqat layout validatordan o'tgan va `meta.status: "approved"` bo'lsa yasaladi
(qoralamadan mijozga ketmaydi).

Bitta fayl kerak bo'lsa:

```bash
node tools/export-svg.mjs                         # exports/foodera-2026.svg (butun zal)
node tools/export-svg.mjs --section A              # faqat A bo'limi
node tools/export-svg.mjs --block EQ-1 --scale 40  # bitta blok kartasi
node tools/export-svg.mjs --no-state               # barcha joylar bo'sh holda (katalog uchun)
```

SVG har qanday brauzerda ochiladi; undan PNG/PDF olish mumkin. Chop etishda "xarita versiyasi"
(`layout v1.0.0`) va sana faylda ko'rinadi — qaysi fayl yuborilganini keyin aniqlash oson.

**Asosiy qoida (xarita o'qilishi):** bitta kompaniya nechta joy olgan bo'lsa (9, 18, 36 m² yoki
butun blok) — xaritada ular alohida yacheykalar emas, **bitta umumiy quti** bo'lib chiziladi va
kompaniya nomi o'sha qutining **ichida** yoziladi. Yonma-yon tushgan keyingi xaridlar ham shu
qutiga qo'shiladi. Buni `app/groups.js` hisoblaydi (brauzer ham, eksport ham, boshqaruv ro'yxati ham
shu bitta hisobdan foydalanadi).

**Qoida:** mijozga faqat shu skript chiqargan fayl yuboriladi. Figma/Photoshop'dan saqlangan
rasm yuborilmaydi — aks holda xarita bilan holat yana ajralib ketadi.

## 4b. Mavjud band ro'yxatini Excel'dan yuklash (manager qayta terib chiqmasin)

```bash
node tools/import-bookings.mjs band-royxat.csv             # avval sinov (dry-run)
node tools/import-bookings.mjs band-royxat.csv --apply     # haqiqiy yuklash
```

CSV ustunlari (nomlar tanish bo'lsa yetadi): `Blok/Stend | Holat | Kompaniya | Mijoz | Telefon | Summa | Sotuvchi | Izoh`.
Ajratgich `;` yoki `,` — avtomatik aniqlanadi; Excel'da "CSV UTF-8" qilib saqlash kifoya.
Qolgan parametrlar: `--ttl 48`, `--user Menejer --pin 9999`. Allaqachon band qilingan qatorlar
o'tkazib yuboriladi va hisobotda ko'rsatiladi.

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

## 5b. DWG/DXF chizma bo'lsa (real zal fayli)

```bash
pip install ezdxf                                  # bir marta

# 1) chizmada nima borligini ko'rish (layerlar, to'rtburchaklar, yozuvlar)
python3 tools/inspect-dxf.py zal.dxf --min-area 4

# 2) avtomatik layout yasash
python3 tools/dxf-to-layout.py zal.dxf --block-layer BLOK --hall-layer ZAL \
        --feature XONA:room --feature USTUN:column --label-layer YOZUV \
        --out layout/hall-A.json --hall "A zal" --project "Ekspo Markazi" --price 1250000
```

Konvertor nimalarni o'zi ushlaydi (mijozga xato ketmasligi uchun):

* **Y o'qini teskari qiladi** — DXF'da Y pastdan tepaga, layout'da tepadan pastga
  (xaritaning "oynadagidek teskari" chiqishi eng ko'p uchraydigan mapping xatosi);
* 72 m² **bo'lmagan** to'rtburchaklarni alohida ro'yxat qilib ko'rsatadi (masalan 6×9 m = 54 m²);
* blok koordinatasi 3 m to'rga tushmasa, yo'lak 2 m dan tor bo'lsa, bloklar ustma-ust tushsa — ogohlantiradi;
* oxirida `tools/validate-layout.mjs` ni ishga tushirib yakuniy hukmni beradi.

DXF kerak bo'lsa: AutoCAD/LibreCAD'da "Save As → DXF", yoki DWG→DXF konvertor.
Alternativa — `tools/import-csv.mjs` (Excel ro'yxat bo'lsa).

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
app/groups.js                     # band joylarni birlashtirish: bitta kompaniya = bitta quti
lib/groups.mjs                    # app/groups.js ni Node'dan ishlatish (eksport, paket)
tools/validate-layout.mjs         # CLI validator (CI uchun)
docs/CHIZMA-ANKETA.md             # real chizma bo'yicha tasdiqlash savollari
tools/test-validator.mjs          # 18 ta buzilgan layout testi
tools/export-svg.mjs              # mijozga yuboriladigan xarita (SVG)
tools/import-csv.mjs              # Excel/CSV → layout JSON
tools/inspect-dxf.py              # DXF: layerlar, to'rtburchaklar, yozuvlar ro'yxati (ezdxf)
tools/dxf-to-layout.py            # DXF → layout JSON (Y o'qini teskari qiladi, xatolarni sanaydi)
tools/demo.mjs                    # demo holat: --seed / --reset
tools/import-bookings.mjs         # Excel/CSV → serverga ommaviy yuklash (dry-run default)
tools/package.mjs                 # mijozga tayyor paket: xarita + bo'limlar + CSV + izoh
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
