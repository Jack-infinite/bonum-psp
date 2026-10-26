# Орчнууд: sandbox, production болон тест

[English](./environments.md) | **Монгол**

Таны код хаана ч ижил. Аль сервертэй харилцахыг гурван орчны хувьсагч шийднэ.

## Гурван хувьсагч

| Хувьсагч               | Юу вэ                                              | Хаанаас авах                          |
| ---------------------- | -------------------------------------------------- | ------------------------------------- |
| `BONUM_ENV`            | Тестэд `sandbox`, бодит мөнгөнд `production`       | Та өөрөө сонгоно                      |
| `BONUM_MERCHANT_KEY`   | `x-merchant-key` header-ээр илгээгддэг API түлхүүр | Bonum, орчин бүрт тус тусад нь        |
| `BONUM_WEBHOOK_SECRET` | Webhook үнэхээр Bonum-аас ирснийг шалгана          | Bonum, таныг webhook URL бүртгүүлэхэд |

`BONUM_ENV` серверийг сонгоно: `sandbox` бол `https://testpsp.bonum.mn`, `production` бол
`https://psp.bonum.mn`. Анхдагч утга байхгүй: үүнгүйгээр `new BonumClient()` `BonumConfigError`
шиднэ. Тиймээс тохиргоо дутсанаас болж тестийн хүсэлт production руу, эсвэл эсрэгээрээ, хэзээ ч
очихгүй.

**Sandbox болон production өөр өөр түлхүүр, нууц түлхүүртэй.** Тэдгээрийг хэзээ ч бүү холь,
production орчны нууц түлхүүрийг хөгжүүлэгчийн компьютерт хэзээ ч бүү хадгал.

```ts
import { BonumClient } from 'bonum-psp';

const bonum = new BonumClient(); // reads all three variables
```

## Локал хөгжүүлэлт (sandbox)

1. Аппдаа `.env` файл үүсгэ (Next.js-д `.env.local`):

   ```bash
   BONUM_ENV=sandbox
   BONUM_MERCHANT_KEY=mk_test_example
   BONUM_WEBHOOK_SECRET=test_webhook_secret
   ```

   Placeholder-уудыг Bonum-аас авсан sandbox-ийн утгуудаар соль.

2. Git түүнийг үл тоох эсэхийг шалга: `.gitignore`-д `.env` болон `.env.*`-г нэм (энэ репод
   аль хэдийн бий).
3. Ачаалах:
   - Node.js 22+: `node --env-file=.env server.js`
   - Next.js: `.env.local`-г өөрөө уншдаг.
4. Bonum таны webhook-д зөвхөн HTTPS-ээр хандаж чадна. Webhook-ийг өөрийн компьютер дээр хүлээн
   авахын тулд туннель ашиглаж, түүний URL-ийг **sandbox**-ийн webhook URL болгон бүртгүүл;
   [Туннель ашиглан webhook-ийг локал орчинд тестлэх](../packages/sdk/README.mn.md#туннель-ашиглан-webhook-ийг-локал-орчинд-тестлэх)
   хэсгийг үз.

## Production

`.env` файл бүү байршуул. Production-ий утгуудыг хостын нууц тохиргоонд оруул, жишээ нь Vercel →
Settings → Environment Variables, эсвэл Railway, Render, Fly.io дээрх ижил хуудас, Docker эсвэл
Kubernetes secret, эсвэл үүлэн нууц мэдээллийн менежер:

```bash
BONUM_ENV=production
BONUM_MERCHANT_KEY=<production key from Bonum>
BONUM_WEBHOOK_SECRET=<production webhook secret from Bonum>
```

Production-ий webhook URL-ээ (HTTPS) Bonum-д бүртгүүлж, анхны бодит төлбөрөөс өмнө go-live
шалгах жагсаалтыг дуусга. MCP сервер үүнийг `bonum://checklists/go-live` гэж өгдөг.

SDK мерчант түлхүүр болон webhook-ийн нууц түлхүүрийн эхэн, төгсгөлийн хоосон зайг арилгадаг тул
нууц мэдээллийн менежерийн нэмсэн шинэ мөрийн тэмдэгт асуудал үүсгэхгүй. `BONUM_ENV` нь яг
`sandbox` эсвэл `production` байх ёстой.

## Тест

| Юуг тестлэх                    | Хэрхэн                                                                                             | Bonum-ын түлхүүр хэрэгтэй юу?           |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Webhook route-аа unit тестэд   | `bonum-psp/testing` хуурамч үйл явдал үүсгэж гарын үсэг зурна                                      | Үгүй: ямар ч хуурамч нууц түлхүүр болно |
| Ажиллаж буй серверээ бүхэлд нь | MCP хэрэгсэл `send_test_webhook`: "http://localhost:3000/webhooks/bonum дээрх webhook-оо тестлээч" | Sandbox-ийн webhook-ийн нууц түлхүүр    |
| Бодит API дуудлага             | `BONUM_ENV=sandbox` болон sandbox-ийн мерчант түлхүүр                                              | Sandbox-ийн мерчант түлхүүр             |
| Энэ репо                       | `pnpm test`                                                                                        | Үгүй                                    |

`bonum-psp/testing` ашигласан unit тест:

```ts
import { createTestWebhookEvent, signTestWebhook } from 'bonum-psp/testing';

const { body, headers } = await signTestWebhook({
  payload: createTestWebhookEvent({ orderId: 'ORD-1001' }),
  secret: 'test_webhook_secret', // the same value your app reads from BONUM_WEBHOOK_SECRET
});
// POST body and headers to your webhook route and expect 200.
```

Bonum-ын wallet-ийн жишээнүүдээс харахад sandbox төлбөр ч бодит картаас мөнгө татаж магадгүй.
Өөрийн картаар төлөхөөсөө өмнө Bonum-аас тестийн карт асуугаарай.

## MCP сервер

MCP сервер ижил гурван хувьсагчийг MCP client-ийнхээ тохиргооноос уншдаг. Түүнд **зөвхөн
sandbox-ийн утга** өг: таны агенттай ярьж чадах хэн ч production орчны webhook-ийн нууц түлхүүрээр
хуурамч webhook үүсгэж чадна. Client бүрийн тохиргоог
[`packages/mcp/README.mn.md`](../packages/mcp/README.mn.md)-ээс үз.

## Жишээнүүдээр туршиж үзэх

- [`examples/express`](../examples/express): `.env.example`-г `.env` болгон хуулж, sandbox-ийн
  утгуудаа бөглөөд, репогийн үндсэн хавтсанд `pnpm install`, жишээний хавтсанд `pnpm start`
  ажиллуул.
- [`examples/nextjs-app-router`](../examples/nextjs-app-router): `.env.example`-г `.env.local`
  болгон хуулаад, жишээний хавтсанд `pnpm dev` ажиллуул.
