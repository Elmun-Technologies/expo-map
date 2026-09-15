# Vercel deploy

Bu loyiha oddiy `node server.mjs` HTTP server sifatida yozilgan. Vercel esa `server.listen(...)` ishlatadigan doimiy Node serverni emas, serverless function handlerni kutadi. Shuning uchun `server.mjs` endi ikki rejimda ishlaydi:

- lokal: `npm start` → `server.listen(...)` bilan ishga tushadi;
- Vercel: default export handler orqali ishlaydi, `listen` chaqirilmaydi.

## Sozlash

Repo ichida `vercel.json` bor. Vercel uni avtomatik o‘qiydi va barcha so‘rovlarni `server.mjs` ga yo‘naltiradi.

Muhim environment variablelar:

- `STATE=/tmp/expo-map-state.json` — `vercel.json` da qo‘yilgan. Vercel filesystemi read-only bo‘lgani uchun holat fayli `/tmp` ga yoziladi.
- `SELLERS_JSON` — ixtiyoriy. `data/sellers.json` gitga kiritilmagan (`.gitignore`), shuning uchun production loginlarni Vercel Project Settings → Environment Variables orqali bering.

`SELLERS_JSON` formati:

```json
{
  "sellers": [
    { "id": "aziz", "name": "Aziz Karimov", "pin": "1111", "role": "seller" },
    { "id": "manager", "name": "Менеджер", "pin": "9999", "role": "admin" }
  ]
}
```

## Cheklov

`/tmp` Vercelda doimiy baza emas: cold start yoki yangi instance bo‘lsa, bron/sotuv holati yo‘qolishi mumkin. Haqiqiy production uchun state va auditni tashqi DB/KVga (masalan Postgres, Redis/KV va hokazo) chiqarish kerak.

## Tekshiruv

Lokal tekshiruv:

```bash
npm ci
npm run check
npm run smoke
```

Health endpoint:

```text
/api/healthz
```
