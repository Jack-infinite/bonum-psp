# bonum-psp

[English](./README.md) | **Монгол**

[![CI](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml/badge.svg)](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

**Bonum PSP V2**-д зориулсан TypeScript хэрэгслийн багц. Bonum PSP V2 нь Apple Pay болон Google Pay
төлбөрийг асинхрон байдлаар боловсруулдаг: та wallet токеноо илгээхэд банкны хариу дараа нь
webhook-ээр эсвэл төлөв шалгах хүсэлтээр ирдэг. Энэ урсгалыг зөв хэрэгжүүлэхэд ганц HTTP дуудлага
хангалтгүй. Түүхий (raw) body дээр гарын үсэг шалгах, захиалгыг давхар биелүүлэхгүй байх
(idempotency), 30 секундын дараа хаагддаг wallet цонх, удаан хугацаанд `PENDING` төлөвт үлддэг
төлбөрүүд гэх мэт нарийн зүйл олон бий. Энэ репо тэдгээрийг нэг дор багцалсан тул интеграц бүр
тэднийг дахин нээж олох шаардлагагүй.

| Багц                                                      | Юу вэ                                                                                                                                                                                        |                                                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [`bonum-psp`](./packages/sdk)                             | Сервер талын SDK: V2-ийн таван endpoint-д зориулсан төрөлжсөн (typed) client, webhook баталгаажуулалт, Fetch болон Express handler, тестийн туслах функцууд. Runtime dependency огт байхгүй. | [README](./packages/sdk/README.mn.md) · [npm](https://www.npmjs.com/package/bonum-psp)     |
| [`bonum-psp-mcp`](./packages/mcp)                         | AI кодлох агентуудад (Claude Code, Codex, Cursor, Claude Desktop, VS Code) зориулсан MCP сервер: төлбөр шалгах, webhook-ийн алдаа олох, өөрийн webhook endpoint-оо тестлэх.                  | [README](./packages/mcp/README.mn.md) · [npm](https://www.npmjs.com/package/bonum-psp-mcp) |
| [`bonum-psp-integration`](./skills/bonum-psp-integration) | Claude Code болон Codex-д SDK ашиглан Bonum V2-ийг зөв холбохыг заадаг Agent Skill.                                                                                                          | [SKILL.md](./skills/bonum-psp-integration/SKILL.md)                                        |

## 30 секундэд

```bash
npm install bonum-psp
```

```ts
import { BonumClient } from 'bonum-psp';

const bonum = new BonumClient(); // BONUM_MERCHANT_KEY, BONUM_ENV, BONUM_WEBHOOK_SECRET

const submission = await bonum.payments.submitApplePay({
  orderId: 'ORD-1001',
  token,
  amount: 150.5,
});
const result = await bonum.payments.waitForResult(submission); // AUTHORIZED | FAILED | PENDING

const event = await bonum.webhooks.verify(rawBody, req.headers); // in your webhook route
```

Кодлох агентаараа webhook endpoint-оо тестлүүлэх:

```bash
claude mcp add --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
# then: "Test my webhook at http://localhost:3000/webhooks/bonum"
```

## Agent Skill суулгах

Энэ skill нь нээлттэй [Agent Skills](https://agentskills.io) форматыг дагадаг тул нэг хавтас Claude
Code болон Codex-д адилхан ажиллана. `skills/bonum-psp-integration` хавтсыг төслийнхөө эсвэл
хэрэглэгчийн бүртгэлийнхээ skills хавтас руу хуулна:

| Агент       | Нэг төсөлд                              | Бүх төсөлд                                |
| ----------- | --------------------------------------- | ----------------------------------------- |
| Claude Code | `.claude/skills/bonum-psp-integration/` | `~/.claude/skills/bonum-psp-integration/` |
| Codex       | `.agents/skills/bonum-psp-integration/` | `~/.agents/skills/bonum-psp-integration/` |

Жишээ нь, төслийнхөө үндсэн хавтсаас:

```bash
git clone --depth 1 https://github.com/Jack-infinite/bonum-psp.git /tmp/bonum-psp
mkdir -p .claude/skills && cp -R /tmp/bonum-psp/skills/bonum-psp-integration .claude/skills/
```

Ингэснээр та Bonum интеграц дээр ажиллах бүрд агент энэ skill-ийг ашиглана. Claude Code дээр
`/bonum-psp-integration` гэж шууд дуудаж бас болно.

## Жишээнүүд

- [`examples/express`](./examples/express): Apple Pay endpoint болон webhook route бүхий Express 5.
- [`examples/nextjs-app-router`](./examples/nextjs-app-router): webhook хүлээн авах Next.js route
  handler.

Sandbox, production болон тестийг хэрхэн тохируулахыг
[`docs/environments.mn.md`](./docs/environments.mn.md) тайлбарласан.

## Bonum-ын албан ёсны баримт бичиг

- [Интеграцын заавар](https://psp.bonum.mn/v2/integration-guide.html)
- [API лавлах](https://psp.bonum.mn/v2/api-reference.html)
- [Webhook-ийн заавар](https://psp.bonum.mn/v2/webhook-guide.html)
- [V1-ээс шилжих заавар](https://psp.bonum.mn/v2/migration-guide.html)

Bonum-ын баримт бичиг тодорхой бус байгаа газруудад энэ төсөл ямар шийдвэр гаргасныг
[`docs/decisions.mn.md`](./docs/decisions.mn.md) файлд тэмдэглэсэн.

## Хувь нэмэр оруулах

Хувь нэмэр оруулахыг урьж байна. [CONTRIBUTING.mn.md](./CONTRIBUTING.mn.md) файлыг үзнэ үү.
Хөгжүүлэлтэд Node.js 26 болон pnpm 12 хэрэгтэй. Аюулгүй байдлын асуудлыг
[SECURITY.mn.md](./SECURITY.mn.md) файлд заасны дагуу нууцаар мэдэгдэнэ үү. Issue-д мерчант
түлхүүр эсвэл webhook-ийн нууц түлхүүрийг хэзээ ч бүү оруулаарай.

## Лиценз

[MIT](./LICENSE) © 2026 Jack Infinite. Bonum нэр нь BONUM ХХК-д хамаарах бөгөөд энд зөвхөн энэ
программ хангамж юутай ажилладгийг тайлбарлах зорилгоор ашиглагдсан.
