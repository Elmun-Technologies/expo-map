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

**Bir gapda:** xaritani chizishni to'xtatdik — endi u hisoblanadi va tekshiriladi;
sotuv bitta umumiy bazada yuradi; mijozga doim bir xil, versiyalangan xarita ketadi.
Shu uchta qoida saqlansa, "yo'q joyni sotyapsiz" degan gap takrorlanmaydi.
