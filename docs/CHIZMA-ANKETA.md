# Real chizma bo'yicha savollar (tasdiqlash anketasi)

Manba: siz yuborgan `Screenshot 2026-09-14 at 1.53.34 PM.png` — **Крытый павильон** (yopiq pavilyon) chizmasi.
PDF sandbox'ga yetib kelmadi (yuklash muammosi), shuning uchun hozircha **rasm nisbatlaridan** o'qib
`layout/hall-real.json` **qoralamasi** tayyorlandi (status: `draft`, mijozga eksport bloklangan).

Draftni ochish: `node tools/export-svg.mjs --layout layout/hall-real.json --out exports/draft.svg --force`
yoki panelni shu layout bilan ishga tushirish:
`LAYOUT=layout/hall-real.json STATE=data/state-real.json PORT=4174 node server.mjs`

Quyidagi 10 ta javob kelsa — qoralama **tasdiqlangan** xaritaga aylanadi.

## A. O'lchamlar

| # | Savol | Nima uchun kerak |
|---|---|---|
| A1 | Zalning aniq o'lchamlari (chizmadagi mm raqamlar: 62 786 · 18 782 · 2 762 · 875 · W=5.6 m kabi). Metrga aylantirib bering yoki PDF/DWG da ko'rsating. | Xaritaning masshtabi va yo'lak kengliklari to'g'ri chiqishi uchun |
| A2 | Asosiy zaldagi **A–F ustunlar** orasidagi yo'lak kengligi qancha? | Yo'lak 2 m dan tor bo'lsa, mijoz "siqib qo'yilgan" deb shikoyat qiladi |
| A3 | Chap qanot (A1, A2) maydonlari — chizmada yozuvi ko'rinmadi. A3=25.4, A4=22.67, A5=20.32, A6=19.15 m² | Bu stendlar nostandart o'lchamda, narxi maydon bo'yicha hisoblanadi |

## B. Guruhlar (eng muhim qism)

| # | Savol | Nima uchun kerak |
|---|---|---|
| B1 | **Asosiy zaldagi har bir ustun (A, B, C, D, E, F) 12 ta stendmi?** Chizmada 2 ustun × 6 qator = 12 ta katak ko'rinadi (har biri 9 m²) | 12 × 9 = **108 m²** — bu **72 m² (8 stend) qoidasidan farq qiladi**. Ya'ni bu ustunni "1 blok" deb sotib bo'lmaydi: yo 8+4 ga bo'lish, yo narxni 108 m² bo'yicha aytish kerak |
| B2 | Pastdagi qatorda: B=4 ta, C/D/E/F=8 ta, G=4 ta — to'g'rimi? (chizmada `B4..B1`, `C1..C4 + C15..C18`, `D1..D4 + D15..D18`, `E1..E4 + E15..E18`, `F1..F4 + F15..F18`, `G3..G(?)`) | 8 talik guruhlar = 72 m² (qoidaga mos), 4 taliklar = 36 m² (alohida sotiladi) |
| B3 | Har bir katakda **ikkita raqam** bor: `A7/9м` va `B9/9м` kabi. Qaysi biri **stend raqami** (mijoz shartnomasida yoziladigan), qaysi biri **texnik/ustun raqami**? | Mijozga aytiladigan ID bitta bo'lishi shart — aks holda "men A7 ni oldim" degan mijoz bilan chalkashlik qaytadi |
| B4 | Ustun ichida raqamlash **1..12 ketma-ket**mi yoki chizmadagidek `A7,A8 / A7,A8 / B9,B9 / B8,B8` (takrorlanadigan) shakldami? | Takrorlanadigan raqamlar bilan xarita-mijoz mosligi buziladi; yagona ID berilishi kerak |
| B5 | Aralash o'lchamli guruh (chizmada 12м², 9м², 6м², 18м², 108м² kataklar) — qaysi guruh va qanday sotiladi (maydon birligida?) | Ular uchun ham aniq ID va narx kerak |
| B6 | `B2B` blokchalari (o'ng tomonda) — alohida stendlar yoki shunchaki xona? | Rejaga qarab B2B zonasi alohida narxlanadi |

## C. Narx va shartlar

| # | Savol | Nima uchun kerak |
|---|---|---|
| C1 | Narx: **so'm/m²** yoki **stend uchun**? (hozir tizimda so'm/m²) | 108 m² va 22.67 m² stendlar uchun to'g'ri summa chiqishi uchun |
| C2 | Bron muddati (hozir 72 soat qilib qo'yilgan) qancha bo'lsin? | Bron avtomatik bo'shashi uchun |
| C3 | Sotuvchilar ro'yxati va PIN'lar (`data/sellers.json`) | Hozir demo: Aziz 1111, Dilnoza 2222, Sardor 3333, Menejer 9999 |

## D. Texnik

| # | Savol | Nima uchun kerak |
|---|---|---|
| D1 | PDF yoki **DWG/DXF** ni qayta yuklay olasizmi? (PDF ham yetarli — vektor bo'lsa koordinatalarni aniq o'qiyman) | Rasm nisbatlaridan o'qilgan raqamlar ±0.5 m xato bo'lishi mumkin; DXF'da esa aniq |
| D2 | Chizmada bloklar qanday chizilgan: yopiq polyline (bitta to'rtburchak) yoki alohida chiziqlar? Qaysi layer'da? | `tools/dxf-to-layout.py` bloklarni avtomatik topib olishi uchun (`--block-layer BLOK`) |
| D3 | `грузовые ворота` (yuk ko'tarish yo'lagi) va texnik xona chegaralari stendlarga tegadimi? | Yo'lak 2 m dan tor bo'lmasligi uchun |

## Javob bergandan keyin nima bo'ladi

1. `layout/hall-real.json` — aniq raqamlar bilan to'ldiriladi va `status: "approved"` qilinadi;
2. `node tools/validate-layout.mjs layout/hall-real.json` — xatosiz o'tishi shart;
3. Panelda sotuvchilar sinab ko'radi (`LAYOUT=layout/hall-real.json ... node server.mjs`);
4. Eksport: `exports/hall-real.svg` (mijozga yuboriladigan versiya) + har bir guruh uchun alohida karta
   (`--block A`, `--block A-01`, `--block A6` ...);
5. Keyin shartnoma moduli: stend ID, maydon (9/19.15/108 m²), narx, xarita versiyasi avtomatik tushadi.
