# Хувь нэмэр оруулах

[English](./CONTRIBUTING.md) | **Монгол**

Тусалж байгаад баярлалаа! Энэ бол Bonum PSP V2-т зориулсан, албан ёсны бус, олон нийтийн
хөгжүүлдэг төсөл. Алдааны мэдэгдэл, засвар, баримт бичгийн сайжруулалт, framework-ийн жишээ бүгдийг
хүлээн авна.

Оролцсоноороо та [Ёс зүйн дүрэм](./CODE_OF_CONDUCT.md)-ийг (англи хэлээр) зөвшөөрч байна. Аюулгүй
байдлын асуудлыг нийтэд нээлттэй issue-д биш, [SECURITY.mn.md](./SECURITY.mn.md) файлд заасны
дагуу нууцаар мэдэгдээрэй.

## Орчин бэлтгэх

Хөгжүүлэлтэд **Node.js 26** (`.nvmrc` файлыг үзнэ үү; багцууд өөрсдөө Node 22.12+ дэмждэг) болон
**pnpm 12** хэрэгтэй:

```bash
npm install --global pnpm@12   # the exact version is pinned in package.json ("packageManager")
git clone https://github.com/Jack-infinite/bonum-psp.git
cd bonum-psp
pnpm install
pnpm check                     # everything CI runs; must be green before you open a PR
```

Bonum-ын нууц мэдээлэл шаардлагагүй: бүх тест хуурамч өгөгдөл дээр ажилладаг. Ганц үл хамаарах зүйл
бол `packages/sdk/test/sandbox.test.ts` бөгөөд `BONUM_SANDBOX_MERCHANT_KEY` тохируулсан үед л
ажиллана. Энэ нь санамсаргүй payment id-аар нэг удаа хор хөнөөлгүй хайлт хийдэг.

## Скриптүүд

| Скрипт                          | Юу хийдэг                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| `pnpm check`                    | lint + build + typecheck + test + багцын шалгалт (publint, attw) |
| `pnpm build`                    | Хоёр багцыг бүтээнэ (`src/version.ts` файлыг ч дахин үүсгэнэ)    |
| `pnpm test` / `pnpm test:watch` | Coverage-тэй Vitest / watch горим                                |
| `pnpm typecheck`                | TypeScript, багц тус бүрээр                                      |
| `pnpm lint` / `pnpm format`     | Biome болон knip / Biome-ийн засвар, форматыг хэрэгжүүлэх        |
| `pnpm changeset`                | Changelog болон дараагийн release-д зориулж өөрчлөлтөө тэмдэглэх |

[AGENTS.md](./AGENTS.md) (англи хэлээр) нь архитектур болон кодын дүрмийг тайлбарладаг: strict
TypeScript, `any` хэрэглэхгүй, нийтэд гаргасан export бүрт жишээтэй TSDoc, гаралтад нууц мэдээлэл
гаргахгүй гэх мэт. Том өөрчлөлт хийхээсээ өмнө уншаарай.
[`docs/decisions.mn.md`](./docs/decisions.mn.md) нь гайхмаар санагдаж болох шийдвэрүүдийг
тайлбарладаг.

## Багцуудад өөрчлөлт оруулах

- **Тест:** зан төлөвийн өөрчлөлт бүрт тест нэмэх эсвэл шинэчлэх. Coverage-ийн босго заавал
  хангагдах ёстой (SDK ≥ 95 % мөр, ≥ 90 % салаа (branch); MCP ≥ 85 % мөр).
- **Changeset:** `bonum-psp` эсвэл `bonum-psp-mcp` багцад хэрэглэгчдэд нөлөөлөх өөрчлөлт, түүний
  дотор MCP серверийн dependency шинэчлэл, changeset шаарддаг. `pnpm changeset` ажиллуулж, багцууд
  болон bump-ийг сонгоод changelog-д нэг хоёр өгүүлбэр бичнэ. Багцууд 0.x хувилбартай байх хугацаанд
  эвдэх (breaking) өөрчлөлтөд `minor`, бусад бүх зүйлд `patch` ашиглана. Зөвхөн баримт бичиг эсвэл
  зөвхөн тестийн өөрчлөлтөд changeset хэрэггүй.
- **Баримт бичиг:** зан төлөв эсвэл public API өөрчлөхдөө багцын README-г шинэчилнэ. `.mn.md`
  гэсэн монгол хувилбартай баримт бичгийг (README, CONTRIBUTING, SECURITY, RELEASING,
  `docs/decisions`) өөрчилбөл монгол хувилбарыг нь ч мөн шинэчилнэ.
- **Bonum-ын баримт бичиг:** түүний текстийг энэ репо руу хэзээ ч хуулж болохгүй, учир нь тэдний
  хуудсууд нууцлалын мэдэгдэлтэй. Өөрийн үгээр тайлбарлаж, <https://psp.bonum.mn/v2/> руу холбоос
  тавина. Талбарын нэр, endpoint-ийн зам, гарын үсгийн алгоритм нь баримт тул ашиглахад зүгээр.
- **Нууц мэдээлэл:** бодит мерчант түлхүүр эсвэл webhook-ийн нууц түлхүүрийг, хугацаа нь дууссан
  байсан ч, хэзээ ч commit хийж эсвэл paste хийж болохгүй. `mk_test_example`,
  `test_webhook_secret` гэх мэт илт хуурамч утга ашиглана.

## Commit болон pull request

Commit мессеж нь [Conventional Commits](https://www.conventionalcommits.org/) стандартыг дагана.
Хэрэгтэй бол scope нэмнэ:

```
feat(sdk): accept ArrayBuffer bodies in verify()
fix(mcp): explain ECONNRESET in send_test_webhook
docs(skill): add a Fastify snippet
chore(deps): bump zod to 4.7.0
```

Түгээмэл scope-ууд: `sdk`, `mcp`, `skill`, `docs`, `examples`, `ci`, `deps`. Pull request-ээ нэг
сэдэвт төвлөрүүлээрэй: нэг PR-т нэг сэдэв, яагаад хийснээ товч тайлбарлана. CI нь `pnpm check`
командыг Node 22, 24, 26 дээр ажиллуулдаг.

## Release

Maintainer нь Changesets ашиглан release хийдэг; [RELEASING.mn.md](./RELEASING.mn.md) файлыг
үзнэ үү. Хувь нэмэр оруулагчид зөвхөн changeset нэмнэ.
