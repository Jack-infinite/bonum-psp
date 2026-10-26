# bonum-psp-mcp

[English](./README.md) | **Монгол**

[![npm](https://img.shields.io/npm/v/bonum-psp-mcp)](https://www.npmjs.com/package/bonum-psp-mcp)
[![CI](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml/badge.svg)](https://github.com/Jack-infinite/bonum-psp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/bonum-psp-mcp)](./LICENSE)

**Bonum PSP V2**-д зориулсан [MCP](https://modelcontextprotocol.io) сервер. Энэ нь таны AI кодлох
агентад төлбөр шалгах, webhook яагаад татгалзагдсаныг тайлбарлах, мөн таны webhook endpoint-ийг
жинхэнэ, хуурамч, хуучирсан, давхардсан webhook-уудаар тестлэх боломж олгоно. Claude Code, Codex,
Cursor, Claude Desktop, VS Code болон бусад аливаа MCP client-тэй ажиллана. Сервер хаана ч ижил,
зөвхөн тохиргоо нь ялгаатай.

Энэ сервер төлбөр илгээх, нэхэмжлэх үүсгэх боломжгүй: wallet токен зөвхөн бодит төхөөрөмжөөс ирдэг
бөгөөд Bonum PSP V2-д нэхэмжлэхийн API байхгүй. Интеграцаа
бүтээхдээ [`bonum-psp`](https://github.com/Jack-infinite/bonum-psp/blob/main/packages/sdk/README.mn.md) SDK-г ашиглаарай.

- [Хурдан эхлэх](#хурдан-эхлэх) · [Client бүрийн тохиргоо](#client-бүрийн-тохиргоо) ·
  [Тохиргооны хувьсагчид](#тохиргооны-хувьсагчид) · [Хэрэгслүүд](#хэрэгслүүд) ·
  [Resource болон prompt](#resource-болон-prompt)
- [Хүсэлтийн жишээ](#хүсэлтийн-жишээ) · [Аюулгүй байдлын загвар](#аюулгүй-байдлын-загвар) ·
  [Алдаа илрүүлэх](#алдаа-илрүүлэх) · [Library болгон ашиглах](#library-болгон-ашиглах)

## Хурдан эхлэх

Node.js 22.12 эсвэл түүнээс хойшхи хувилбар хэрэгтэй. Серверийг Claude Code-д **sandbox**-ийн нууц
мэдээллээрээ нэмнэ:

```bash
claude mcp add --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
```

Дараа нь асуугаарай: _"Bonum-ын холболтоо шалгаач."_

Бүх хувьсагч заавал биш. Мерчант түлхүүргүй бол төлбөрийн хэрэгслүүд түүнийг хэрхэн тохируулахыг
тайлбарлах бөгөөд webhook хэрэгслүүд ажилласаар байна. Webhook-ийн нууц түлхүүргүй бол эсрэгээрээ.

## Client бүрийн тохиргоо

MCP серверт **зөвхөн sandbox-ийн нууц мэдээлэл** өгөөрэй. Яагаад гэдгийг
[аюулгүй байдлын загвар](#аюулгүй-байдлын-загвар) хэсгээс үзнэ үү.

### Claude Code

```bash
claude mcp add --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
```

- Анхдагчаар сервер зөвхөн одоогийн төсөлд, зөвхөн танд нэмэгдэнэ (`--scope local`). Бүх төсөлдөө
  ашиглах бол `--scope user` нэмнэ.
- Сүүлийн `--env` болон `bonum` нэрийн хооронд өөр нэг тохиргоо (энд `--transport stdio`)
  байлгаарай. Эс бөгөөс CLI нэрийг дахиад нэг `KEY=value` хос гэж уншина.
- Серверийн төлөв болон хэрэгслүүдийг харахын тулд Claude Code дотор `/mcp` ажиллуулна.

#### Түлхүүрээ солих

`claude mcp add` аль хэдийн байгаа серверийг хэзээ ч солихгүй: "MCP server bonum already exists" гэж
зогсдог. Серверийг устгаад, хүссэн **бүх** утгатайгаар дахин нэм. `read -s` нууц мэдээллийг shell-ийн
түүхэнд үлдээхгүй:

```bash
claude mcp remove bonum -s local
read -s BONUM_MERCHANT_KEY     # paste the key and press Enter; nothing is shown
read -s BONUM_WEBHOOK_SECRET
claude mcp add --env BONUM_MERCHANT_KEY="$BONUM_MERCHANT_KEY" \
  --env BONUM_WEBHOOK_SECRET="$BONUM_WEBHOOK_SECRET" --env BONUM_ENV=sandbox \
  --transport stdio bonum -- npx -y bonum-psp-mcp
```

Дараа нь Claude Code-ийг дахин эхлүүл, эсвэл `/mcp` дотор `bonum`-ыг дахин холбо: ажиллаж буй сервер
хуучин утгуудаа хадгалсаар байдаг. Аль утга тохируулагдсаныг (утгыг өөрийг нь биш) харахын тулд
_"Bonum-ын холболтоо шалгаач."_ гэж асуу.

### Claude Code: `.mcp.json` ашигласан багийн тохиргоо

Энэ `.mcp.json` файлыг төслийн үндсэн хавтсанд commit хий. Хөгжүүлэгч бүр өөрийн нууц мэдээллийг
shell орчиндоо хадгална:

```json
{
  "mcpServers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${BONUM_MERCHANT_KEY}",
        "BONUM_WEBHOOK_SECRET": "${BONUM_WEBHOOK_SECRET}",
        "BONUM_ENV": "${BONUM_ENV:-sandbox}"
      }
    }
  }
}
```

Claude Code нь `${VAR}` утгыг өөрийг нь эхлүүлсэн орчноос бөглөдөг бөгөөд төслийн серверийг анх
ашиглахаас өмнө хөгжүүлэгч бүрээс зөвшөөрөл асуудаг. Хувьсагч тохируулагдаагүй бол Claude Code
`${VAR}` текстийг үгчлэн дамжуулдаг. Сервер үүнийг таньж, утгыг үл тоож, `check_connection` аль
хувьсагчийг export хийхийг хэлнэ. Нууц мэдээлэлд `claude mcp add --scope project` бүү ашигла: энэ
нь утгуудыг `.mcp.json` руу бичдэг.

### Codex

Codex CLI, IDE өргөтгөл болон апп нэг тохиргоог хуваалцдаг:

```bash
codex mcp add bonum --env BONUM_MERCHANT_KEY=... --env BONUM_WEBHOOK_SECRET=... --env BONUM_ENV=sandbox -- npx -y bonum-psp-mcp
```

Энэ команд утгуудыг `~/.codex/config.toml` файлд хадгална. Нууц мэдээллийг файлд хадгалахгүйн
тулд оронд нь `~/.codex/config.toml` (эсвэл итгэмжлэгдсэн төсөл дэх `.codex/config.toml`) файлыг
засаж, нууц мэдээллээ shell-ээсээ дамжуулна:

```toml
[mcp_servers.bonum]
command = "npx"
args = ["-y", "bonum-psp-mcp"]
env_vars = ["BONUM_MERCHANT_KEY", "BONUM_WEBHOOK_SECRET"]  # forwarded from your shell
default_tools_approval_mode = "writes"                     # read-only tools run without prompts

[mcp_servers.bonum.env]
BONUM_ENV = "sandbox"
```

`"writes"` үед Codex зөвхөн унших гэж тэмдэглэгдээгүй хэрэгслийг ажиллуулахаас өмнө асуудаг. Энд
тийм хэрэгсэл ганцхан: таны endpoint руу хүсэлт илгээдэг `send_test_webhook`.

### Claude Desktop

**Settings → Developer → Edit Config** цэсийг нээх, эсвэл `claude_desktop_config.json` файлыг шууд
засна (macOS дээр `~/Library/Application Support/Claude/`, Windows дээр `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "bonum": {
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "mk_test_example",
        "BONUM_WEBHOOK_SECRET": "test_webhook_secret",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

Placeholder-уудыг sandbox-ийн утгуудаараа солиорой; Claude Desktop хувьсагч задалдаггүй. Дараа нь
Claude Desktop-ийг дахин эхлүүлнэ. `npx` олдохгүй бол (nvm ашигладаг үед түгээмэл) `which npx`
командын өгөх бүтэн замыг `command` болгон ашиглаарай.

### Cursor

Төсөлдөө `.cursor/mcp.json`, бүх төсөлд `~/.cursor/mcp.json` ашиглана. Cursor нь `${env:NAME}`
утгыг таны орчноос уншдаг:

```json
{
  "mcpServers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${env:BONUM_MERCHANT_KEY}",
        "BONUM_WEBHOOK_SECRET": "${env:BONUM_WEBHOOK_SECRET}",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

### VS Code

VS Code-ийн `.vscode/mcp.json` нь `mcpServers` биш `servers` ашигладаг. Нууц мэдээллийг нэг удаа
асууж, аюулгүй хадгалж чадна:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "bonum-merchant-key",
      "description": "Bonum sandbox merchant key",
      "password": true
    },
    {
      "type": "promptString",
      "id": "bonum-webhook-secret",
      "description": "Bonum sandbox webhook secret",
      "password": true
    }
  ],
  "servers": {
    "bonum": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "bonum-psp-mcp"],
      "env": {
        "BONUM_MERCHANT_KEY": "${input:bonum-merchant-key}",
        "BONUM_WEBHOOK_SECRET": "${input:bonum-webhook-secret}",
        "BONUM_ENV": "sandbox"
      }
    }
  }
}
```

### Бусад аливаа MCP client

`npx -y bonum-psp-mcp` командыг доорх орчны хувьсагчидтай stdio сервер болгон ажиллуулна. Эсвэл
`npm install -g bonum-psp-mcp` командаар нэг удаа суулгаад `bonum-psp-mcp` ажиллуулна.

## Тохиргооны хувьсагчид

| Хувьсагч                                 | Юунд хэрэгтэй                                                                        | Анхдагч   |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------- |
| `BONUM_MERCHANT_KEY`                     | Төлбөрийн хэрэгслүүд (`check_connection`, `get_payment*`, `wait_for_payment_result`) | —         |
| `BONUM_WEBHOOK_SECRET`                   | Webhook хэрэгслүүд (`verify_webhook`, `create_test_webhook`, `send_test_webhook`)    | —         |
| `BONUM_ENV`                              | Төлбөрийн хэрэгслүүд аль Bonum API-г дуудах: `sandbox` эсвэл `production`            | `sandbox` |
| `BONUM_BASE_URL`                         | Bonum-ын API-гийн өмнө байрлах proxy (`https:`, localhost бол `http:`)               | —         |
| `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS` | `send_test_webhook`-ийг локалаас бусад хост руу хандуулах                            | `false`   |

Сервер үргэлж эхэлдэг. Дутуу эсвэл буруу утга нь зөвхөн түүнийг шаарддаг хэрэгслүүдийг унтраах
бөгөөд тэр хэрэгслүүд юу тохируулахыг тайлбарлана. `check_connection` тохиргооны бүх анхааруулгыг
жагсаадаг бөгөөд сервер эхлэхдээ тэдгээрийг stderr-д хэвлэдэг. Утгуудын эхэн, төгсгөлийн хоосон
зайг арилгадаг бөгөөд утгууд өөрсдөө хэзээ ч хэвлэгддэггүй.

## Хэрэгслүүд

| Хэрэгсэл                  | Юу хийдэг                                                                                                                                                                                                                         | Шаардлага       | Тэмдэглэгээ                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------- |
| `check_connection`        | Орчин, base URL болон аль нууц мэдээлэл тохируулагдсаныг (зөвхөн тийм/үгүй) харуулна. Санамсаргүй payment id хайж түлхүүр ажиллаж байгааг батална: хүчинтэй түлхүүрт Bonum 404, хүчингүй түлхүүрт 401 гэж хариулдаг. Эндээс эхэл. | —               | зөвхөн унших, idempotent        |
| `get_payment`             | Bonum-ын `paymentId`-аар (UUID) төлбөрийг `isTerminal` болон нормчилсон валюттай хамт авна.                                                                                                                                       | мерчант түлхүүр | зөвхөн унших, idempotent        |
| `get_payment_by_order_id` | Мөн адил, гэхдээ таны `order_id`-аар.                                                                                                                                                                                             | мерчант түлхүүр | зөвхөн унших, idempotent        |
| `wait_for_payment_result` | PENDING төлбөрийн банкны хариуг `waitMs` хүртэл (1–28 000, анхдагч 25 000) хүлээнэ.                                                                                                                                               | мерчант түлхүүр | зөвхөн унших                    |
| `verify_webhook`          | Барьж авсан webhook-ийг (яг тэр raw body, `X-PSP-Signature`, `X-PSP-Timestamp`) шалгаж, аливаа бүтэлгүйтлийг тайлбарлана. `ignoreTimestamp` нь хуучин бичлэгийг дахин шалгахад зориулагдсан.                                      | webhook secret  | зөвхөн унших, idempotent, локал |
| `create_test_webhook`     | Бодитой төстэй AUTHORIZED эсвэл FAILED webhook-д гарын үсэг зурж, body, header болон бэлэн `curl` командыг буцаана. Гарын үсэг 5 минут хүчинтэй.                                                                                  | webhook secret  | зөвхөн унших, локал             |
| `send_test_webhook`       | Таны endpoint руу тестийн webhook илгээж, хариу бүрийг дүгнэнэ. Сценари: `authorized`, `failed`, `duplicate`, `invalid_signature`, `stale_timestamp` эсвэл `all` (анхдагч).                                                       | webhook secret  | хүсэлт илгээдэг, локал          |

`send_test_webhook` нь жинхэнэ үйл явдалд болон давхардсан илгээлтийн хоёр хуулбарт 2xx, хуурамч
болон 10 минутын настай webhook-д 4xx хариу хүлээдэг. Тэр хоёрын аль нэгэнд 2xx хариулбал
**аюулгүй байдлын бүтэлгүйтэл** гэж мэдээлнэ: хэн ч төлбөрийг хуурамчаар үүсгэж чадна гэсэн үг.
4xx хүлээж байхад 5xx ирвэл анхааруулга, учир нь Bonum дахин дахин оролдох байсан.

Төлбөрийн үр дүн `environment` талбартай. `BONUM_ENV=production` үед тэдгээрийн текст production
анхааруулгаар эхэлнэ.

## Resource болон prompt

Resource-ууд (энэ төсөлд зориулж англиар бичсэн Markdown; тус бүр Bonum-ын албан ёсны хуудсууд
руу холбоостой):

| URI                          | Агуулга                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bonum://guides/integration` | V2 урсгал, түлхүүрийг сервер дээр хадгалах, `waitForResult` ашигласан Apple Pay болон Google Pay, тулгалт  |
| `bonum://guides/webhooks`    | Баталгаажуулалт, framework тус бүрийн raw body, хоёр түвшний idempotency, дахин илгээх хуваарь, локал тест |
| `bonum://reference/api`      | Endpoint, талбар, төлөв, алдаа                                                                             |
| `bonum://checklists/go-live` | Бодит төлбөр авахаас өмнө юуг шалгах                                                                       |

Claude Code дээр `@bonum:bonum://guides/webhooks` гэж дурдаж ашиглана.

Prompt-ууд:

| Prompt                     | Аргумент                                                                                     | Юу хийдэг                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `integrate_bonum`          | `framework` (express, nextjs, hono, fastify, nestjs, other), `wallets` (apple, google, both) | Одоогийн төсөлд `bonum-psp` нэмж, дараа нь webhook-ийг `send_test_webhook`-ээр шалгана.                                             |
| `debug_webhook`            | `symptom`                                                                                    | `verify_webhook` ашиглан raw body, нууц түлхүүр ба орчин, цагийн зөрүү, proxy болон глобал JSON parser-уудыг алхам алхмаар шалгана. |
| `review_bonum_integration` | —                                                                                            | Одоо байгаа интеграцыг go-live дүрмийн дагуу аудит хийнэ.                                                                           |

Claude Code дээр prompt-ууд slash команд байдаг: `/mcp__bonum__integrate_bonum nextjs both`.

## Хүсэлтийн жишээ

Агенттайгаа монголоор ч, англиар ч ярьж болно:

- _"Bonum-ын холболтоо шалгаач."_
- _"ORD-1001 захиалгын төлөв ямар байна?"_
- _"3f0c2c8e-… төлбөр дуусахыг хүлээгээд өгөөч."_
- _"http://localhost:3000/webhooks/bonum дээрх webhook-оо тестлээч."_
- _"Миний webhook signature mismatch гэж байна. Log-доо бичсэн raw body болон header-ууд энд байна: …"_
- _"ORD-7 захиалгад гарын үсэгтэй FAILED тестийн webhook үүсгээд curl командыг өгөөч."_

## Аюулгүй байдлын загвар

- **Bonum-ын хувьд зөвхөн уншина.** Төлбөрийн хэрэгслүүд зөвхөн төлбөр хайдаг. Юу ч илгээх, буцаах,
  өөрчлөх хэрэгсэл байхгүй.
- **Нууц мэдээлэл зөвхөн орчноос.** Ямар ч хэрэгсэл түлхүүр эсвэл нууц түлхүүрийг аргумент болгон
  авдаггүй бөгөөд аль нь ч тэдгээрийг давтаж хэлдэггүй. Хамгаалалтын сүүлчийн шугам болгож гаралт
  бүр тохируулсан түлхүүр болон нууц түлхүүрийг арилгадаг redactor-оор дамждаг.
- **Тестийн webhook локалдаа үлдэнэ.** `send_test_webhook` зөвхөн нэвтрэх мэдээлэлгүй
  `http`/`https` URL хүлээн авах бөгөөд анхдагчаар зөвхөн дараах хостуудыг зөвшөөрнө: `localhost`,
  `127.0.0.1`, `[::1]`, `*.localhost`, `*.test`. Бусад хостод
  `BONUM_MCP_ALLOW_REMOTE_WEBHOOK_TARGETS=true` хэрэгтэй. Redirect хэзээ ч дагадаггүй бөгөөд хүсэлт
  бүрийг 10 секундын дараа (Bonum-ын өөрийн хязгаар) зогсооно.
- **Production-д гарын үсэг зурахгүй.** `BONUM_ENV=production` үед `create_test_webhook` болон
  `send_test_webhook` ажиллахаас татгалзана. Гэхдээ `BONUM_ENV` зөвхөн API хостыг сонгодог тул
  жинхэнэ хамгаалалт бол энэ серверт **production орчны webhook-ийн нууц түлхүүрээ хэзээ ч бүү
  өгөх**. Таны агенттай ярьж чадах хэн ч түүгээр хүчинтэй production webhook хуурамчаар үүсгэж чадна.
- **Шударга тэмдэглэгээ.** Зөвхөн уншдаг хэрэгслүүдийг read-only гэж тэмдэглэсэн тул client-ууд
  тэднийг асуулгүй ажиллуулж болно. `send_test_webhook` тийм биш тул client юу ч илгээхээс өмнө
  асууна.
- **stdout дээр чимээгүй.** Сервер зөвхөн stderr-д log бичдэг; stdout MCP протоколыг дамжуулдаг.

## Алдаа илрүүлэх

- `check_connection`-оос эхлээрэй: сервер юу харж байгааг болон тохиргооны бүх анхааруулгыг
  харуулна.
- Сервер эхлэхдээ stderr-д нэг мөр хэвлэдэг, жишээ нь
  `0.1.0 serving MCP on stdio; Bonum sandbox (https://testpsp.bonum.mn); merchant key set, webhook secret set.`
  Claude Code серверийн алдааг `/mcp` дотор харуулдаг. Claude Desktop серверийн log-ийг macOS дээр
  `~/Library/Logs/Claude/` хавтсанд бичдэг.
- Серверийг [MCP Inspector](https://github.com/modelcontextprotocol/inspector) ашиглан судлах:

  ```bash
  npx @modelcontextprotocol/inspector -e BONUM_ENV=sandbox npx -y bonum-psp-mcp
  ```

- `npx -y bonum-psp-mcp --help` хувьсагчдыг жагсаадаг, `--version` хувилбарыг хэвлэдэг.

## Library болгон ашиглах

Багц нь серверийн factory-г бас export хийдэг. Серверийг өөр програмд суулгах, HTTP-ээр үйлчлэх,
эсвэл process дотор тестлэх боломжтой:

```ts
import { createBonumMcpServer, depsFromEnv } from 'bonum-psp-mcp';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

const deps = depsFromEnv(process.env); // never throws; problems become deps.warnings
serveStdio(() => createBonumMcpServer(deps));
```

## Лиценз

[MIT](./LICENSE) © 2026 Jack Infinite
