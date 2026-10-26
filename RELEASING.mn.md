# Хувилбар гаргах (release)

[English](./RELEASING.md) | **Монгол**

Хоёр багц [Changesets](https://changesets.dev) хэрэгслээр тус тусдаа хувилбарлагдаж, GitHub
Actions-ээс npm-ийн **trusted publishing** (OIDC) ашиглан publish хийгддэг. Репод npm токен
хадгалагддаггүй бөгөөд release бүр provenance баталгаатай гардаг.

Trusted publishing-ийг зөвхөн npm дээр аль хэдийн байгаа багцад тохируулж болно. Тиймээс хамгийн
анхны хувилбарыг (хоёр багцын `0.1.0`) нэг удаа гараар publish хийнэ.

## Нэг удаагийн тохиргоо

### 1. 0.1.0 хувилбарыг гараар publish хийх

Хоёр шатлалт баталгаажуулалт (2FA) асаалттай npm бүртгэл ашиглаарай.

```bash
npm login
pnpm install
pnpm check                 # everything green, including the tarball checks

cd packages/sdk
pnpm publish --access public
cd ../mcp
pnpm publish --access public   # pnpm turns `workspace:^` into ^0.1.0 in the published package.json
```

Эхлээд SDK багцыг publish хий, учир нь MCP сервер түүнээс хамаардаг. `npm publish` биш
`pnpm publish` ашигла: `workspace:^` хүрээг зөвхөн pnpm л бодит хувилбараар сольдог. Үр дүнг
`npm view bonum-psp-mcp dependencies` командаар шалгаарай. `main` салбарт upstream салбар хараахан
байхгүй гэж pnpm татгалзвал `--no-git-checks` нэмээрэй. Гэхдээ үүнийг зөвхөн дөнгөж шалгасан,
өөрчлөлтгүй working tree дээр хий.

Үүнийг GitHub дээрх `main` руу анхны push хийхээс **өмнө** хий. Эс бөгөөс release workflow `0.1.0`
хувилбарыг өөрөө publish хийх гэж оролдоод, trusted publisher хараахан байхгүй тул бүтэлгүйтнэ. Энэ
бүтэлгүйтэл хор хөнөөлгүй: доорх тохиргоог хийсний дараах ажиллагаа амжилттай болно.

### 2. Release workflow-д итгэл олгох

Үүнд npm CLI 11.15 буюу түүнээс хойшхи хувилбар (`npm --version`) болон хоёр шатлалт
баталгаажуулалт хэрэгтэй:

```bash
npm trust github bonum-psp --file release.yml --repo Jack-infinite/bonum-psp --allow-publish
npm trust github bonum-psp-mcp --file release.yml --repo Jack-infinite/bonum-psp --allow-publish
```

Хүсвэл дараа нь багц бүрийн npm тохиргоонд **Require two-factor authentication and disallow
tokens** сонголтыг асааж болно. Trusted publishing үргэлжлэн ажиллана.

### 3. GitHub-ийн тохиргоо

- Репо **public** байх ёстой: npm зөвхөн public репод provenance нэмдэг.
- **Settings → Actions → General:** GitHub Actions-д pull request үүсгэж, батлах эрх өгнө. Version
  job нь "Version Packages" pull request-ийг нээдэг.
- **Settings → Rules:** `main` салбарыг хамгаална (pull request болон CI шалгалт заавал).
- **Settings → Security:** private vulnerability reporting (`SECURITY.mn.md` файлыг үзнэ үү) болон
  Dependabot alerts-ийг асаана.

## Цаашдын release бүр

1. Хэрэглэгчдэд нөлөөлөх өөрчлөлттэй pull request бүрт `pnpm changeset` ажиллуулж, багцууд болон
   хувилбарын өсгөлтийн төрлийг (bump) сонгоод `.changeset/` доторх үүссэн файлыг commit хийнэ.
2. Ийм pull request merge хийгдэхэд release workflow **"chore: version packages"** нэртэй pull
   request-ийг нээж эсвэл шинэчилнэ. Энэ нь хувилбаруудыг өсгөж, `CHANGELOG.md` файлуудыг бичиж,
   `src/version.ts` файлыг шинэчилдэг.
3. GitHub нь built-in токеноор нээгдсэн pull request дээр бусад workflow-ийг ажиллуулдаггүй. Тэр
   pull request дээр CI шалгалт ажиллуулахын тулд түүнийг хаагаад дахин нээнэ.
4. Түүнийг merge хийнэ. Дараа нь workflow `pnpm check` ажиллуулж, багц бүрийг `pnpm pack` командаар
   савлаж, OIDC ашиглан `pnpm publish` хийнэ. Мөн `bonum-psp@0.2.0` гэх мэт git tag push хийж,
   GitHub release үүсгэнэ.

Workflow хэрхэн бүтэцлэгдсэн бэ (`.github/workflows/release.yml`):

| Job           | Хэзээ ажиллах                      | Эрх                                       |
| ------------- | ---------------------------------- | ----------------------------------------- |
| `select-mode` | `main` руу push бүрт               | `contents: read`                          |
| `version`     | changeset байгаа үед               | `contents: write`, `pull-requests: write` |
| `pack`        | хувилбарууд npm дээр хараахан алга | `contents: read`                          |
| `publish`     | `pack` дууссаны дараа              | `contents: write`, `id-token: write`      |

Зөвхөн `publish` job л OIDC токен авч чадна. Тэр нь `pack` дээр бүтээж, шалгасан tarball-уудад
зөвхөн publish алхмыг ажиллуулдаг. Release job-ууд dependency cache ашигладаггүй бөгөөд
`--ignore-scripts` тохиргоотойгоор суулгадаг.

## Ямар нэг зүйл буруу болбол

- **`publish` 404 эсвэл 403 алдаагаар бүтэлгүйтвэл:** trusted publisher таарахгүй байна.
  npmjs.com дээр багц бүрийн **Settings → Trusted publishing** хэсэгт багцын нэр, репо
  (`Jack-infinite/bonum-psp`), workflow файлын нэрийг (`release.yml`) шалгаарай.
- **Хувилбар publish хийгдсэн ч tag үүсгэх үед алдаа гарвал:** бүтэлгүйтсэн job-ийг дахин
  ажиллуулна. Changesets нь npm дээр аль хэдийн байгаа хувилбарыг алгасдаг.
- Хүмүүс суулгасан байж болзошгүй хувилбарыг **хэзээ ч unpublish бүү хий**. Оронд нь зассан patch
  хувилбар гаргаж, эвдэрхий хувилбарыг `npm deprecate bonum-psp@<version> "<reason>"` командаар
  deprecate болгоно.
