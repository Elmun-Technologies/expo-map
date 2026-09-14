# Xarita va sotuv jarayoni: tahlil + yechim

**Sana:** 2026-09-14 · **Loyiha:** Expo Map (ekspo zali xaritasi + sotuv paneli)
**Qisqa xulosa:** muammo xarita *chizilishida* emas — xaritaning **yagona manbasi yo'qligida** edi.
Endi xarita bitta JSON fayldan formula bo'yicha chiziladi, sotuvlar umumiy bazada yuritiladi va
mijozga doim *bir xil* xarita fayli ketadi.

---

## 1. Mijoz nima deyapti va aslida nima bo'layapti

| Mijoz shikoyati | Orqasida yotgan texnik sabab |
|---|---|
| "Men sotib olgan joy bu emas" | Stendning ID si yo'q — mijoz "3-qator, o'rtadagi blok" deb eslab qoladi, xaritada esa blok boshqa joyda |
| "Siz yo'q joyni sotyapsizla" | Bloklar real zaldagi masofaga mos emas: yo'lak/ustun/sahna ustiga tushib qolgan yoki bloklar bir-biriga yopishib ketgan |
| "Ikki marta sotib qo'yibsiz" | Bron/sotuv markazlashmagani uchun (Excel + Telegram + daftar) bir joy ikki mijozga ketgan |
| "72 m² olasan degan edingiz, 54 chiqdi" | Blokda 8 ta emas, 6–10 stend bo'lgan — ya'ni 72 m² qoidasi buzilgan, xaritada esa baribir "blok" deb ko'rsatilgan |
| "Menga yuborilgan xarita boshqa" | Eski versiya qo'lda yuborilgan (`map_final_v3.png`), keyin xarita o'zgargan |

Ya'ni **bitta** muammo emas: (a) geometriya ishonchsiz, (b) holat (kim band qilgan) ishonchsiz,
(c) mijozga boradigan fayl ishonchsiz. Uchtasi bir vaqtda tuzatilmasa, shikoyat qaytadi.

## 2. Ildiz sabab: xarita "chizilgan", "hisoblanmagan"

Sizda qoida aniq: **1 stend = 3×3 m = 9 m²**, **1 blok = 8 stend = 72 m²**.
Bu — matematik bog'lanish: `72 = 8 × 9`. Bunday bog'lanishni qo'lda chizishda saqlab bo'lmaydi:

* 6 ta blok 48 stend bo'lsa, 384 koordinata (x, y, eni, bo'yi) qo'lda yoziladi;
* bitta blok 2 m siljisa, u boshqa blokka yopishadi — ko'z ilg'amaydi, mijoz ilg'aydi;
* Figma layer nomlari (`Rectangle 127 copy 3`) stend ID bo'la olmaydi;
* fayl versiyalari `final`, `final2`, `oxirgi` deb ko'payadi.

Figma — *dizayn* vositasi, *ma'lumot* vositasi emas. Xarita ma'lumot bo'lishi kerak: har bir stend
o'z ID siga ega yozuv, joylashuvi esa shu yozuvdan hisoblanadigan natija.

**Shu sababli tizim shunday qurildi:** xarita qo'lda chizilmaydi — `layout/hall-A.json` dagi
blok boshlanish nuqtasi + ustun/qator sonidan **avtomatik** hisoblanadi, har bir o'zgarish
**validatordan** o'tadi. Validator xato topsa — xarita umuman chiqmaydi (server ko'tarilmaydi,
eksport yozilmaydi). Ya'ni "yo'q joyni sotish" texnik jihatdan imkonsiz bo'ladi.

## 3. Taklif etilgan yechim (3 qatlam)

```
   ① LAYOUT (manba)          ② HOLAT (sotuv)              ③ MIJOZGA KETADIGAN FAYL
   layout/hall-A.json        data/state.json              SVG / PDF / havola
   zal o'lchami, bloklar      bron, sotuv, mijoz          xarita + legenda + bo'sh joylar
   ustun/qator → 8×9=72       revision, audit.log          versiya raqami bilan
        │                          │                            │
        └────── bitta formula:  stend.id = "A-01-05" ───────────┘
                (shartnomada ham, xaritada ham, bazada ham aynan shu ID)
```

1. **Manba bitta.** Zal o'lchami, ustunlar, sahna, kirish — hammasi JSON'da, metrda.
2. **Hisoblash bitta.** `lib/layout.mjs` — 9 m²/72 m² qoidalari va tekshiruv faqat shu yerda.
3. **Holat bitta.** Barcha sotuvchilar bitta bazaga yozadi; bitta joy ikki marta sotilmaydi
   (konfliktda tizim rad etadi va kim band qilganini ko'rsatadi).
4. **Chiqish bitta.** Mijozga faqat `tools/export-svg.mjs` chiqargan fayl yoki panelning
   "Chop etish / PDF" tugmasi orqali olingan hujjat yuboriladi.

## 4. Endi ishlaydigan narsa (shu omborda tayyor)

**Sotuv paneli** (`node server.mjs` → brauzer, telefon va kompyuterda):

* Xaritadan **stend** (9 m²) yoki **blok yorlig'i** (`A-01 · 72 m²` → butun blok, 8 stend) bosiladi;
  savat sifatida yig'iladi — blok to'liq bo'lmasa, faqat bo'sh joylari tanlanadi va ogohlantiradi.
* Mijoz maydonlari (ism, telefon, kompaniya, izoh) → **Bron** (muddatli, tugasa avtomatik bo'shaydi)
  yoki **Sotish** → tasdiqlash oynasida *aynan qaysi ID'lar* va summa → **kvitansiya** (chop etiladi).
* Band joy: kim, qachon, qaysi sotuvchi, qaysi mijoz — ko'rinadi. Boshqa sotuvchining bronini yoki
  sotilgan joyni faqat **menejer** bo'shata oladi.
* Jonli statistika: bo'sh/bron/sotilgan stend va m², sotuv summasi.
* **Mijoz ko'rinishi** havolasi (`?mode=client`) — mijoz o'zi qarab turadi, narx maydonlari yo'q.
* **Chop etish / PDF** — A3 varaq: xarita + legenda + bo'sh joylar ro'yxati + bloklar jadvali (72 m²).
* **Jurnal** (admin) va **CSV eksport** (buxgalteriya/hisobot uchun).

**Nazorat vositalari:**

| Buyruq | Vazifa |
|---|---|
| `npm run validate` | Layout qoidalarga mosmi (9 m², 72 m², ustma-ust tushish, yo'lak, ID) |
| `npm test` | 12 ta "buzilgan layout" testi — har biri ushlanishi shart |
| `npm run export` | Mijozga yuboriladigan SVG (butun zal / bitta blok kartasi) |
| `npm run import` | Excel/CSV → layout JSON (mavjud ro'yxatni ko'chirish) |
| `npm run smoke` | UI smoke-test: login → tanlash → sotish → konflikt → mijoz rejimi (22 ta tekshiruv) |

## 5. Ish reglamenti (qisqa, sotuvchilar uchun)

1. **Joy har doim ID bilan aytiladi**: "A-01-05, 9 m²" — "o'rtadagi blok" emas.
2. **72 m² = butun blok (8 ta stend)**. Blokdan bo'lak sotilsa, mijozga aynan qaysi ID'lar
   o'tgani kvitansiyada ko'rsatiladi.
3. **Bron muddati** (standart 72 soat) tugasa joy avtomatik bo'shaydi — qo'lda "esdan chiqarish" yo'q.
4. **Mijozga faqat tizim chiqargan xarita** yuboriladi (versiya raqami va sanasi faylda ko'rinadi).
5. **Sotilgan joyni bo'shatish** — menejer vakolati (yozuv jurnalga tushadi).
6. Layout o'zgarsa (`layout/hall-A.json`) — avval `npm run check`, keyin mijozlarga yangi versiya.

## 6. Keyingi qadamlar

**0–1 hafta (hozir tayyor qism + sizning ma'lumot):**
1. Siz real zal faylini (DWG/PDF/Figma/Excel) berasiz → men `layout/hall-*.json` ni to'ldiraman
   (import skripti tayyor: blok boshlanish nuqtasi + ustun/qator yetarli).
2. `data/sellers.json` — haqiqiy sotuvchilar ro'yxati va PIN'lar.
3. Narx (`pricePerM2`) va bron muddatini tasdiqlaymiz; ekspo sanalari kiritiladi.
4. Sinov kuni: 2–3 sotuvchi panelda ishlab ko'radi; biz ularning e'tirozlarini yig'amiz.

**1–3 oy:**
* PostgreSQL (yoki SQLite) + WebSocket — ikki sotuvchi bir joyni bir vaqtda ochsa darhol ko'rinadi.
* Shartnoma moduli: stend ID, maydon, narx, xarita versiyasi avtomatik shartnomaga tushadi.
* Mijoz portali: shaxsiy havola, to'lov holati, QR check-in (tadbir kunida skaner).
* Excel'dan mavjud shartnomalarni bir marta ko'chirish.
* Zaxira (backup) avtomatik: har kuni `data/*` nusxasi + o'zgarishlar jurnali.

**3–12 oy:**
* Bir nechta zal / bir nechta tadbir sanasi (har tadbirga alohida holat).
* Onlayn to'lov (Payme/Click yoki bank), hisob-faktura/akt avtomatik.
* Analitika: qaysi bloklar tez sotiladi, qaysi narx ishlaydi, sotuvchilar reytingi.
* Tadbir kunida QR orqali kelganini belgilash, kassa/badge tizimi bilan bog'lash.

## 6b. Real chizma tahlili (Крытый павильон) — 2026-09-14

Siz yuborgan chizma (rasm) o'rganildi va `layout/hall-real.json` **qoralamasi** shu asosda tayyorlandi.
Chizmadan o'qilgan tuzilma:

| Element | Chizmada | Izoh |
|---|---|---|
| Chap qanot | A1–A6 stendlari | Nostandart o'lchamlar: A3=25.4, A4=22.67, A5=20.32, A6=19.15 m² (A1, A2 yozuvi ko'rinmadi) |
| Asosiy zal | A, B, C, D, E, F ustunlar | Har birida 2×6 = **12 ta katak** (9 m²) → **108 m²**, ya'ni 72 m² qoidasidan **katta** |
| Pastki qator | B (4), C (8), D (8), E (8), F (8), G (4) | 8 talik guruhlar = 72 m² (qoidaga mos), 4 taliklar = 36 m² |
| Boshqa | Sahna, B2B zona, Small Conference Hall, Registratsiya, 2×WC, zina, texnik xona, yuk ko'tarish yo'lagi | Zonalar xaritada alohida rang bilan ko'rsatildi |

**Muhim xulosa (mijoz shikoyatining ildizi shu yerda):** chizmadagi asosiy zal kataklari 12 tadan —
ya'ni bir ustun 108 m². Agar sotuvchi buni "bir blok / 72 m²" deb aytsa, mijoz **36 m²** kam joy oladi
yoki ortiqcha pul to'laydi. Tizim endi buni o'zi aytadi: har bir guruh maydoni (`108 m²`, `72 m²`,
`36 m²`, `25.4 m²`...) xaritada va hisob-kitobda **ko'rinib turadi**, 72 m² dan farq qilgani
uchun ogohlantirish beriladi (`meta.enforceBlockRule`).

Chizmada yana bir xatarli joy bor: har bir katakda **ikkita raqam** yozilgan (`A7/9м` va `B9/9м` kabi).
Qaysi biri mijozga aytiladigan stend ID si ekani tasdiqlanishi shart — aks holda chizmadagi chalkashlik
yana panelga ko'chadi. Savollar ro'yxati: **`docs/CHIZMA-ANKETA.md`** (D1 — PDF/DWG ni qayta yuklash).

**Qoralamada nima qilingan:** 6 ta nostandart stend + 12 guruh (A–F, pastki qator), zonalar, obyektlar
(registratsiya, kirish, WC, zina, yuk yo'lagi, texnik xona) joylashtirildi; validator xatosiz o'tadi;
`exports/hall-real-DRAFT.svg` — ko'rish uchun (suv belgisi bilan, chunki qoralama).
Panelda draft holati ko'rsatiladi va **mijozga havola bloklanadi** — noto'g'ri raqam mijozga ketmasligi uchun.

## 7. Men sizdan kutayotgan fayl va undan kerak bo'ladigan ma'lumot

Fayl istalgan formatda bo'lishi mumkin (DWG/DXF chizma, PDF, Figma havola, Excel ro'yxat, hatto qo'lda
chizilgan eskiz skaneri). **Hozirgi holat:** siz DWG (yoki PDF) chizmani tanladingiz — uni shu yerga
tashlang, o'lchamlarni o'qib layout'ni real ma'lumot bilan to'ldiraman. DWG'ni bevosita o'qish qiyin
bo'lsa, undan **PDF yoki yuqori aniqlikdagi rasm** chiqarib yuborish yetarli (o'lcham yozuvlari
ko'rinib turishi kerak). Undan quyidagilar kerak:

- [ ] Zalning umumiy o'lchami (m) va shakli (to'g'ri to'rtburchakmi yoki burchak/aylana bor);
- [ ] Har bir blokning **boshlanish nuqtasi** (zalning chap-tepa burchagidan, metrda) va ustun/qator soni;
- [ ] Ustunlar, sahna, kirish, WC, food-zone joylashuvi (stendlar ustiga tushmasligi uchun);
- [ ] Bloklar orasidagi yo'lak kengligi (standart 2 m qabul qilindi — boshqa bo'lsa ayting);
- [ ] Blok nomlash tartibi (masalan `A-01` … `A-12`) — mijoz shartnomasida shu nom ishlatiladi;
- [ ] Narx (so'm/m²) va bron uchun muddat (soat/kun).

**Muhim:** agar ro'yxatda stendlar soni 8 tadan farq qiladigan bloklar bo'lsa (6 yoki 10),
ularni **72 m² deb ko'rsatib bo'lmaydi** — yo blok 8 taga yetkaziladi, yo mijozga aniq maydon
(54/90 m²) aytiladi. Validator aynan shu holatni ushlab, xatoni sotuvchiga yetib bormasdan to'xtatadi.

## 8. Kim nima qiladi

| Rol | Vazifa |
|---|---|
| Siz (loyiha egasi) | Real o'lchamlar/narx tasdiqlash, sotuvchilarni o'rgatish, mijozga yuboriladigan fayl qoidasi |
| Sotuvchi | Panelda bron/sotuv, mijoz ma'lumotini to'ldirish, kvitansiyani mijozga berish |
| Menejer (admin) | Jurnal nazorati, xato yozuvlarni bo'shatish, kunlik zaxira |
| Men (texnik) | Layout'ni to'ldirish, keyingi modullar (shartnoma, portal, to'lov) |


---

## 9. FOODERA EXPO 2026 — qilingan ishlar (v2, hozirgi holat)

Chizma bo'yicha zal qayta chizildi va **hamma narsa bitta manbadan** (`layout/foodera-2026.json`) hisoblanadi.

| Nima | Holat |
|---|---|
| Zal o'lchami | 96 × 50 m (chizmadagi o'lchamlarni 72 m² shablonga moslab tekisladik) |
| Bloklar | 11 blok (A–F yuqori qator, G I J K L pastki qator) — har biri 8 stend · 72 m² |
| Uskunalar qatori | EQ-1, EQ-2: 6 stend + bitta birlashtirilgan katak (kompaniya bir necha joyni qo'shib olgan) = 72 m² |
| Chap qanot | A1–A6 nostandart stendlar (19,15–27,41 m², chizmadan olingan) |
| Bo'limlar | A HoReCa · B Konserva · C Baliq · D Meva-sabzavot · E Sog'lom taom · F Eko · G Yarim tayyor · I Ichimliklar · J Bakaleya · K Qandolat · L Shirinliklar · EQ Uskunalar · WING Chap qanot |
| Jami | **106 stend · 1 041,18 m²** · eng tor yo'lak 2 m · validator: xato yo'q |
| Narx | 1 250 000 so'm/m² (tasdiqlash kutilmoqda) |
| Band joylar | Panel orqali kiritiladi; hozircha 18 ta **namunaviy** kompaniya bilan ko'rsatilgan |

### Xarita o'qilishi (mijoz talabi bo'yicha)

- Bitta kompaniya nechta joy olgan bo'lsa — **bitta umumiy quti**, ichida kompaniya nomi va
  "N stend · X m²". 4 ta yacheyka emas, 1 ta quti; 8 ta bo'lsa ham 1 ta.
- Kompaniya nomi endi **stendning o'zida** yoziladi (umumiy ro'yxatga chiqarilmaydi).
- Bo'sh joylar stend raqami bilan yacheyka bo'lib qoladi — sotuvchi qaysi joy bo'shligini darhol ko'radi.
- Boshqaruvda ham xuddi shunday: yon panelda «Band joylar» ro'yxati — har bir kompaniya uchun bitta qator.
- Bron tugasa yoki joy bo'shatilsa quti avtomatik yacheykalarga bo'linadi.

### Mijozga yuboriladigan tayyor paket

```bash
node tools/package.mjs
```

`exports/foodera-2026/` ichida 18 fayl: butun zal xaritasi, faqat bo'sh joylar xaritasi,
har bir bo'lim uchun alohida varaq (13 ta), kompaniyalar CSV, bo'sh joylar CSV va izoh fayli.
Paket **faqat** validatordan o'tgan va tasdiqlangan layout'dan yasaladi — xato xarita
mijozga chiqib ketmaydi.

### Band ro'yxatni Excel'dan yuklash

Manager tayyor ro'yxatni qayta terib chiqmasin:

```bash
node tools/import-bookings.mjs band-royxat.csv           # sinov
node tools/import-bookings.mjs band-royxat.csv --apply   # yuklash
```

### Sizdan kutilayotgan 3 narsa

1. **Kompaniyalar ↔ stend ro'yxati** (qaysi kompaniya qaysi stendni olgan) — hozirgi 18 nom faqat namuna.
2. **Narx** (so'm/m²) va bron muddati (hozir 72 soat qo'yildi).
3. Chizmadagi o'lchamlar mos kelmagan joylar: blok boshlanish nuqtalari va yo'lak kengligi
   chizmada boshqacha bo'lsa — ayting, 5 daqiqada tuzatiladi.

---

**Bir gapda:** xaritani chizishni to'xtatdik — endi u hisoblanadi va tekshiriladi;
sotuv bitta umumiy bazada yuradi; mijozga doim bir xil, versiyalangan xarita ketadi.
Shu uchta qoida saqlansa, "yo'q joyni sotyapsiz" degan gap takrorlanmaydi.
