# learn.asaru.mn — Байршуулах компанид өгөх заавар

Зориулалт: Агаараас эрэн хайх, аврах 111 дүгээр ангийн сургалтын платформ.
Хаяг: **https://learn.asaru.mn**.
Бэлтгэсэн: 2026-10-21. DNS болон live серверт өөрчлөлт хараахан хийгээгүй.

## Компанийн хийх ажил

1. Linux сервер эсвэл Node/Docker ажиллуулах hosting, PostgreSQL сан гаргах. Зөвхөн статик файл эсвэл PHP hosting хангалтгүй.
2. Зөвхөн `learn.asaru.mn` дэд домэйны DNS-г тухайн серверт чиглүүлэх. `asaru.mn` үндсэн сайт болон одоогийн MX/имэйлийн бүртгэлийг хэвээр хадгалах. Сервер IPv6-гүй бол хуучин/буруу AAAA үлдээхгүй.
3. HTTPS сертификат, 80/443 портын хандалт тохируулах.
4. Доорх заавраар web/API ажиллуулж, PostgreSQL холбох.
5. Локал сургалтын өгөгдлийг хадгалах эсэхийг эзэмшигчтэй тохирч, шаардлагатай backup-г тусдаа хамгаалалттай сувгаар авах.
6. Туршилтын хэрэглэгчээр шалгаад backup, monitoring-ийг хариуцах.

## Багцын агуулга ба шалгалтын хязгаар

`learn-asaru-deployment.zip` нь одоогийн web/API source, SQL migrations (0021 хүртэл), lockfile, Dockerfile, Compose, Caddy HTTPS/proxy тохиргоо, заавар, SHA-256 manifest агуулна. Локал нууц тохиргоо, database dump, хэрэглэгчийн нууц үг, node_modules ороогүй. Код доторх `test` нэртэй файлууд нь тестийн код болохоос бодит өгөгдөл биш.

Локал API/web build, web тестийн үр дүнг тусдаа release validation файлаас үзнэ. Энэ компьютерт Docker суулгаагүй учраас container build/start, production PostgreSQL TLS болон HTTPS live шалгалтыг hosting компани өөрийн staging орчинд хийх шаардлагатай. Серверт асуулт/хичээл publish хийх автомат алхам байхгүй.

## Байршуулах бүтэц

- `/` болон React SPA замууд → web статик build.
- `/api/v1/*` → Node API, замын `/api/v1` угтварыг хадгална.
- `/health` → API + database холболтын шалгалт.
- API зөвхөн Docker дотоод сүлжээнд, 4000 портыг интернэтэд нээхгүй.
- PostgreSQL нь TLS-тэй, сертификат нь баталгааждаг production сан байна. Өгсөн тохиргоо self-signed сертификат болон TLS-гүй локал PostgreSQL-д шууд тохирохгүй. Private CA ашиглавал API-д итгэмжлэгдсэн CA-г тусад нь mount/configure хийнэ; сертификат шалгалтыг унтраахгүй.
- Caddy нь TLS-ийг дуусгаж API-д шаардлагатай forwarding headers дамжуулна. Нэмэлт load balancer/CDN proxy ашиглах бол client IP болон Express-ийн одоогийн `trust proxy=1` тохиргоог тухайн сүлжээтэй уялдуулж шалгана. Эхний нэвтрүүлэлтэд DNS-only байдлаар шууд Caddy руу чиглүүлэхэд тохирсон.

## Docker ашиглах үндсэн хувилбар

Серверийн шаардлага: Linux, Docker Engine + Compose v2, outbound package registry/имэйл/DB холболт, inbound 80/443. Docker images нь Node 22 Debian болон Caddy 2 ашиглана. Эцсийн ашигласан image digest-уудыг компанийн release бүртгэлд хадгална.

Багцыг `/opt/learn-asaru/releases/20261021` зэрэг тусдаа хавтаст задлаад:

```sh
cp deploy.env.example deploy.env
chmod 600 deploy.env
```

`deploy.env` дотор дараах утгыг компанийн нууц тохиргоогоор оруулна:

| Утга | Тайлбар |
|---|---|
| DATABASE_URL | Production PostgreSQL, TLS connection string |
| DIRECT_DATABASE_URL | Migration-д зориулсан direct connection; pooled DB хэрэглэвэл шаардлагатай |
| SESSION_SECRET | Шинээр үүсгэсэн санамсаргүй 64 hex тэмдэгт; локал утгыг хуулахгүй |
| RESEND_API_KEY | Имэйл холбох хүртэл хоосон байж болно |
| MAIL_FROM | Баталгаажсан домэйны илгээгч хаяг |

Нууц үүсгэх жишээ: `openssl rand -hex 32`. Secret болон DB холболтыг Git/чат/нийтийн log-д оруулахгүй. Compose config шалгахдаа нууц утга хэвлэх `config` биш `config -q` ашиглана.

```sh
docker compose --env-file deploy.env config -q
docker compose --env-file deploy.env build
```

### Өгөгдөл шилжүүлэх

ZIP-д одоогийн асуулт, хичээл, хэрэглэгч, ахицын database өгөгдөл **ороогүй**. Кодыг дангаар нь байрлуулахад хоосон сан дээр эдгээр үүсэхгүй.

Өгөгдөл хадгалах бол эхлээд локал PostgreSQL-ийн нийцтэй `pg_dump -Fc` backup гаргаж, жагсаалтыг шалгаад компанид хамгаалалттай сувгаар дамжуулна. Тасралтгүй хэрэглэж байгаа сан бол эцсийн backup авах богино хугацаанд бичилтийг зогсоож шилжүүлгийн мөчийг тохирно. Хоосон, шинэ production санд restore хийнэ; одоо ашиглагдаж буй сан дээр overwrite/clean хийхгүй. Drizzle migration journal болон хэрэглэгчийн password hash-уудыг хэвээр хадгална. `sessions`, ашиглагдаагүй password-reset token-уудыг production руу шилжүүлэхгүй, шинэ session secret ашиглана. Restore-ийн дараа сургалтын тоо, асуултын тоо, хэрэглэгч/ахиц/XP-г эх үүсвэртэй тулгана.

Хуучин тест хэрэглэгчид болон Administrator эрхтэй дансуудыг нэвтрүүлэхээс өмнө эзэмшигчтэй шалгаж, зөвшөөрсөн эрхээр идэвхжүүлнэ. Бодит password-г багцад бичихгүй. Админ болон суралцагчийн данснуудын сонголтыг эзэмшигч батална.

Restore дууссан эсвэл зориуд хоосон шинэ сан сонгосны дараа, app эхлүүлэхээс өмнө:

```sh
docker compose --env-file deploy.env run --rm --no-deps api corepack pnpm --filter @unit111/api db:migrate
docker compose --env-file deploy.env up -d
docker compose --env-file deploy.env ps
curl --fail https://learn.asaru.mn/health
```

Migration алдаа гарвал app эхлүүлэхгүй, journal/schema-г шалгана. Seed/reset командыг ажиллуулахгүй. Зориуд хоосон сан бол анхны админыг компанийн аюулгүй терминалаас `bootstrap:admin` интерактив командаар үүсгэнэ; одоо хэрэглэгчтэй сэргээсэн санд bootstrap хэрэггүй.

Caddy-ийн `/data`, `/config` volumes-ийг хадгална. DNS сервер рүү зааж, 80/443 хүрэх боломжтой бол Caddy HTTPS сертификат авна. Нэг серверт өөр сайт 80/443 ашиглаж байвал өгсөн compose-г шууд ажиллуулахгүй: компанийн одоогийн reverse proxy-д web/API маршрутыг нэгтгэх эсвэл тусдаа IP/сервер ашиглана.

## Docker ашиглахгүй бол

Node 22, төслийн packageManager-д заасан pnpm-ээр lockfile-тай суулгаж API/web build хийнэ. `apps/api/dist/index.js`-ийг supervisor/systemd-ээр ажиллуулж, `apps/web/dist`-ийг Nginx/Caddy-ээр үйлчилнэ. `NODE_ENV=production`, `API_PORT=4000`, дээрх secret-ууд, `APP_ORIGIN=https://learn.asaru.mn`, `PASSWORD_RESET_ORIGIN=https://learn.asaru.mn` шаардлагатай. Vite development серверийг production-д ажиллуулахгүй. SPA fallback зөвхөн web замд, `/api/*`-д хэрэглэхгүй. `render.yaml`/`vercel.json` хуучин тохиргоог өгсөн Compose-ийн оронд шууд хэрэглэхгүй.

## Нууц үг сэргээх имэйл

Resend account/API түлхүүр хараахан үүсээгүй. Илгээх дэд домэйн, жишээ нь `mail.asaru.mn`-ийг Resend-д баталгаажуулж, үйлчилгээний өгсөн SPF/DKIM DNS утгуудыг компанитай нэмүүлнэ. Үндсэн домэйны одоогийн MX/SPF-ийг давхардуулж солихгүй. Илгээгчийг баталгаажуулсны дараа `RESEND_API_KEY`, `MAIL_FROM` тохируулаад API-г дахин үүсгэнэ. Туршилтын имэйл эзэмшигчид хүрсэн, reset холбоос нь `https://learn.asaru.mn/reset-password#token=...` гэдгийг шалгана. Хоосон тохиргоотой үед UI үйлчилгээ тохируулаагүй гэсэн мэдэгдэл харуулна.

## Нэвтрүүлэхийн өмнөх шалгалт

- HTTPS сертификат хүчинтэй; HTTP → HTTPS; үндсэн asaru.mn сайт хэвийн.
- `/path`, `/lesson/...`, `/reset-password` шууд нээх/refresh ажиллах.
- Бүртгэл үүсгэх, нэвтрэх/гарах, session refresh, CSRF хамгаалалт ажиллах.
- Шинэ бүртгэл суралцагч эрхтэй, admin замд эрхгүй.
- Тест хэрэглэгчээр theory → practice, тайлбар, retry, давхар XP нэмэгдэхгүйг шалгах.
- Desktop/mobile, dark/light загвар, лого, Excel template таталт, admin import-ыг тусгаарласан тест агуулгаар шалгах.
- API /health 200, database холболт хэвийн; API хариу HTML fallback биш JSON.
- Имэйл холбосон бол reset-ийн 30 минутын хугацаа, нэг удаагийн хэрэглээ, хуучин session хүчингүй болохыг тест дансаар шалгах.
- Өдөр тутмын DB backup, хадгалалтын хугацаа, сэргээх туршилт, uptime/error хяналтыг тохируулах.

## Дараагийн шинэчлэлт ба буцах арга

Release бүрт тусдаа image tag хэрэглэж, өмнөх release image болон database backup-г хадгална. Migration хийхээс өмнө backup авна. Schema нийцтэй бол өмнөх release image рүү буцна; schema нийцэхгүй бол maintenance үед баталгаажсан backup сэргээх төлөвлөгөөг ашиглана. `docker compose down -v` хэрэглэвэл TLS volume устах тул ердийн шинэчлэлтэд ашиглахгүй.

## Компаниас буцааж авах мэдээлэл

Сервер/hosting төрөл, DNS тохируулсан эсэх, HTTPS төлөв, production DB болон backup хариуцагч, deploy шалгалтын дүн, нууц мэдээлэл дамжуулах хамгаалалттай суваг. Нууц үг, API түлхүүрийг энгийн имэйлээр дамжуулахгүй.

Тохиргооны лавлах: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [Docker Compose environment](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
