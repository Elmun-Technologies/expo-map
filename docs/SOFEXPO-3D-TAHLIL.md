# SOF EXPO 3D turi → xaritani aniqroq qilish (tahlil)

Manbalar:
- 3D tur: <https://my.cybermuseum.art/ru/tour/sofexpo> (Wonderport / cybermuseum.art)
- Tur ichidagi interaktiv plan: `.../ru/pano/x36rtq6ggm` → plan rasmi `file.mpskin.com/img/crm/.../20260327-033714-sofexpo-plan.png`
- Rasmiy sxema: <https://sofexpo.uz/exhibition-center-scheme> → «Indoor pavilion layout» (`wp-content/uploads/2022/07/222.png`)
- Nusxa: `docs/sofexpo-krytiy-pavilion-sxema.png` (+ 2x kattalashtirilgan variant)

## Tur va maydon haqida faktlar

| Fakt | Qiymat |
|---|---|
| Expo | **SOF EXPO SAMARKAND** (Jomboy tumani, Samarqand) |
| FOODERA EXPO 2026 sanasi | **20–22 oktyabr 2026** (saytdagi "BOOK A STAND" banneri) |
| Yopiq pavilyon maydoni | **> 4 500 m²** (bizning chizmada 96 × 50 = 4 800 m²) |
| Stend turlari | **9 m² (3×3)** — standart · **18 m² (3×6)** — premium · **36 m²+** — faqat maydon |
| Narx modeli | bizda 1 250 000 so'm/m² (tasdiqlanishi kerak) |

## Real sxemaning tuzilishi (ko'rilgan katak raqamlari bilan)

- **7 ustun: A B C D E F G** (har biri 2 ta kichik ustundan iborat). Ranglari: A — sariq,
  B — ko'k, C — qizil, D — feruza, E — yashil, F — binafsha, G — ko'k.
- Kataklar **9 m²** va **12 m²** (pastki qatorlarda), ayrimlari **18 m²**; o'qilgan ID'lar:
  `A5…A10`, `A13…A15`, `B1…B3`, `B8…B12`, `C5`, `C6`, `C12…C20`, `E…`, `F4…F13`, `G5…G20`.
  (Aniq ro'yxat yuqori aniqlikdagi sxemadan olinadi — quyida "Kerak" bo'limiga qarang.)
- **O'ng tomonda 3 ta katta stend: `G9/72m²`, `G10/72m²`, `G11/72m²`.**
- **Chap qanot (devor bo'ylab xonalar): A1–A6** = 27,41 · 26,23 · 25,4 · 22,67 · 20,32 · 19,15 m².
  A3–A2 orasida **«Выход к открытому павильону»**, tepada **«Техническая комната»**.
- **O'ng tomon (yuqoridan pastga):** Техническая комната · **ГРУЗОВЫЕ ВОРОТА (L GATE, W‑5,6 m H‑5 m)** ·
  **B2B** ×3 · **Hall** · **Переговорная** · **WC** (pastda).
- **Pastda:** **РЕГИСТРАЦИЯ** (ro'yxatga olish, oldida kirish strelkalari) · **BOOKED** (ko'k quti) ·
  **ГЛАВНЫЙ ВХОД** (soyabon) · chap tomonda **WC**, ochiq pavilyonga chiqish yo'lagi.
- Zal bo'ylab **konstruktiv ustunlar** (kichik qora kvadratlar) — xaritada ko'rsatilishi kerak.

## Hozirgi xarita bilan farqi

| | Hozir (`layout/foodera-2026.json`) | Real sxema (`sofexpo`) |
|---|---|---|
| Tuzilma | 18 blok **A–R** (har biri 72 m² shablon) + EQ qatori + chap qanot | **A–G ustunlar** (2 kichik ustun) + pastki qatorlar |
| Stend o'lchamlari | hammasi 9 m² (12/18/36/40 m² → 9 m² kataklarga keltirilgan) | 9 · 12 · 18 · **72 m²** aralash |
| Katak raqamlari | ketma-ket (A‑01 … A‑08) | sxemadagi haqiqiy raqamlar (A5, B12, G9 …) |
| O'ng tomon | B2B / Conference-Hall zonasi | 3 × 72 m² stend + B2B ×3 + Hall + переговорная + yuk darvozasi |

Ya'ni: **geometriya va raqamlashni real sxema bo'yicha qayta qurish kerak** — shundan keyin
xarita "aniq" bo'ladi, chunki har bir stend o'z ID'si va o'z o'lchami bilan chiqadi.

## Reja (qanday qilaman)

1. **`layout/sofexpo-2026.json`** — real sxemadan yangi layout: A–G ustunlar (2 kichik ustun),
   pastki qatorlar, 3 × 72 m² stend, chap qanot A1–A6, barcha zonalar (WC, ro'yxatga olish,
   B2B, Hall, переговорная, yuk darvozasi, ustunlar) va **haqiqiy stend ID'lari**.
2. Ustun/fon ranglari sxemadagidek (A sariq, B ko'k, C qizil, D feruza, E yashil, F binafsha, G ko'k).
3. FOODERA kompaniyalarini **haqiqiy stendlarga** bog'lash (kompaniya ↔ stend ID ro'yxati bo'yicha).
4. Panel, `01-план-зала-весь.pdf`, bo'lim varaqlari, CSV'lar — hammasi yangi layoutdan
   avtomatik qayta yasaladi. Validator 9 m²/72 m² va yo'lak qoidalarini tekshiradi.
5. Natijani siz bilan solishtiramiz: har bir stend ID + o'lcham + kompaniya.

## Kerak bo'lgan fayllar (aniqlik uchun)

1. **Interaktiv plan / katta o'lchamdagi sxema** — turdagi «Интерактивный план» rasmi yoki
   `sofexpo.uz` dagi «Indoor pavilion layout» (222.png) **katta** varianti (PDF/DWG/PNG).
2. **Turdagi «Каталог» PDF** (tur sahifasidagi Каталог tugmasi, `&t=pdf`) — stendlar katalogi.
3. **FOODERA kompaniya ↔ stend ro'yxati** (Excel yoki katta o'lchamdagi chizma) — hozirgi
   43 kompaniya qaysi real ID'da turishini ko'rsatadi.

Fayl bo'lmasa ham 1–2-qadamni boshlash mumkin: geometriyani sxemadan o'lchab quraman, ID'larni
o'qilgan joyigacha yozaman, siz tuzatib berasiz.
