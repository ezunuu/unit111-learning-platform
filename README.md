# UNIT 111 AVIATION QUIZ

Админ нэмэх/засах шинэ минимал урсгал: [docs/ADMIN-AUTHORING.md](docs/ADMIN-AUTHORING.md).


Web readiness, шинэ шалгалт болон release-ийн тайлан: [docs/WEB-READINESS.md](docs/WEB-READINESS.md).

Агаараас эрэн хайх, аврах 111 дүгээр ангийн сургалтын порталын эх код.

## Төлөв ба өгөгдлийн зарчим

React/TypeScript клиент, Express/TypeScript API, PostgreSQL/Drizzle ORM ашиглана. Ангиллын суурь өгөгдөл орно. Нисдэг тэрэгний техникийн асуултыг зориудаар seed хийгээгүй: тухайн агаарын хөлгийн одоогийн RFM, зөвшөөрөгдсөн ажиллагааны баримтаар шалгаж баталсны дараа эрх бүхий ажилтан оруулна.

## Шаардлага

- Node.js 22.x (pnpm 11.25.0 шаардана)
- PostgreSQL 15+ эсвэл Neon PostgreSQL
- pnpm 11.25.0 (үндсэн `package.json`-д pin хийсэн)

## Орон нутагт ажиллуулах

1. PostgreSQL өгөгдлийн сан үүсгэнэ.
2. Репозиторийн үндсэн хавтаснаас `.env.example` файлыг `.env` болгон хуулж, DATABASE_URL болон дор хаяж 32 тэмдэгтийн санамсаргүй SESSION_SECRET бөглөнө.
3. `pnpm install`
4. `pnpm --filter @unit111/api db:generate`
5. `pnpm --filter @unit111/api db:migrate`
6. `pnpm --filter @unit111/api db:seed`
7. `pnpm --filter @unit111/api bootstrap:admin` командын заавраар анхны админыг үүсгэнэ.
8. `pnpm dev` — web http://localhost:5173, API http://localhost:4000.

Анхны админы нууц үгийг репозиторт хадгалахгүй. Bootstrap команд нууц үгийг нууцлалтай prompt-оор авна.

### Хичээл ба асуултын сан

- `lessons` нь гарчиг, ангилал, тайлбар, сургалтын агуулга, төлөвийг хадгална. `lesson_questions` нь асуултын холбоос ба дарааллыг хадгална. `quizzes.lesson_id` нь сургалтын сорилыг хичээлтэй нэг-нэгээр холбож, нэг асуултын санг ашиглана; сургалтын оролдлого, оноо, XP нь давхар attempt үүсгэлгүй `learning_attempts` болон `lesson_progress`-д хадгалагдана.
- Асуулт шинээр үүсэхэд `draft` байна. Сервер нь асуултын төрөл, сонголтын давхардал, зөв хариултын index болон эх сурвалжийн талбарыг validate хийнэ. Хяналт, баталгаа, нийтлэх үеийн role policy өөрчлөгдөөгүй.
- Асуулт оруулах form-ийн түр ноорог зөвхөн тухайн browser-ийн `localStorage`-т автоматаар хадгалагдана. Sensitive мэдээлэл оруулахгүй; хадгалсны дараа ангиллыг дараагийн асуултад үлдээнэ.
- Асуулт импортлох UI CSV болон `.xlsx` файлын эхний worksheet-ийг preview хийж, мөрөөр validate хийнэ. CSV загварын баганууд: `category`, `questionText`, `questionType`, `difficulty`, `options`, `correctIndexes`, `explanation`, `sourceDocument`, `sourceRevision`, `sourceLocation`. `options` нь `|` тэмдэгтээр, `correctIndexes` нь 0-ээс эхэлсэн дугаараар бичигдэнэ. Ангиллын нэр project-ийн идэвхтэй ангилалтай таарах ёстой.
- Workbook импортод `Source Version` эсвэл `Source Revision` багана байвал mapping хийнэ; байхгүй бол revision-ийг хоосон үлдээнэ. Reviewer нь дөрвөн сонголт, зөв хариулт, тайлбар, source document болон page/location-ийг шалгаж pending асуултыг нэг нэгээр эсвэл сонголтоор батална. Source Version болон review note нь заавал биш; эх сурвалжийн нэр, хуудас/байршлын лавлагаа болон мэргэжлийн reviewer-ийн баталгаа нийтлэхэд шаардлагатай.
- Импортын мөрүүд Draft-д орно. API нь файл fingerprint хадгалж давхар импортлолтыг хориглоно; төстэй асуулт илэрвэл импорт хийхийн өмнө мөрийг preview-гээс хасна.

### Сургалтын замнал (development phase)

- Өгөгдлийн бүтэц нь `courses → chapters → lessons` шатлалтай. Одоо байгаа `lessons` болон `lesson_questions` нь хичээл, хичээл-асуултын холбоосыг; одоо байгаа `quizzes.chapter_id` нь бүлгийн эцсийн үнэлгээний сорилыг ашиглана. Шинэ тусдаа асуулт, сорил, үнэлгээний систем үүсгээгүй.
- Админ сургалтын бүтэц `/admin/courses` хэсэгт хөтөлбөр, бүлэг үүсгэж, өмнө үүсгэсэн хичээл болон бүлгийн сорилтой холбоно. Хичээл үүсгэх, асуулт сонгож холбох, асуулт нийтлэх readiness-г `/admin/content` болон `/admin/manage` хэвээр хариуцна.
- `lesson_content_blocks` нь зөвхөн schema-гаар validate хийсэн JSON block хадгална. HTML/JavaScript ажиллуулахгүй. Текст, зурагны HTTPS эсвэл `/media/` зам, гол ойлголт, нэр томьёо, техникийн үзүүлэлт, knowledge-check холбоос, хураангуйг дэмжинэ. Суралцагчид зөвхөн `approved` block харагдана; approve хийхэд эх баримт ба хуудасны лавлагаа шаардана.
- Курс нийтлэхэд дор хаяж нэг нийтэлсэн бүлэг, бүлэг бүрийн нийтэлсэн хичээл, асуултын холбоосууд нийтэлсэн, үүсгэсэн агуулгын бүх block хянагдсан байх шаардлагатай. Курс/бүлгийг нийтлэх эрх `admin`-д; `training_manager` агуулга үүсгэж, засаж, draft бэлтгэнэ. Draft хөтөлбөр суралцагчийн `/learning/path` API-д гарахгүй.
- Хичээлийн дарааллын unlock шалгалтыг сервер давхар хийнэ. Нэг бүлгийн хичээлүүд дарааллаар нээгдэж, дараагийн бүлэг өмнөх бүлгийн шаардлагатай хичээл болон нийтэлсэн бүлгийн сорилыг давахаас өмнө түгжээтэй байна. Хичээлийн босго болон эцсийн сорилын босгыг Lesson/Quiz-ийн одоо байгаа тохиргоогоор удирдана; quiz-ийн албан ёсны оноо өөрчлөгдөхгүй.
- Сургалтын XP нь тусдаа `xp_transactions` ledger-д idempotency key-ээр бичигдэнэ. `lesson_progress`-ийн өмнөх XP-г migration нэг удаа ledger рүү нөхөж оруулна. Давтан оролдлого, refresh нь анхны төгсөлтийн XP-г дахин олгохгүй. Өдөр тутмын идэвхийг хэрэглэгчийн `timezone`-аар огноолж, streak болон долоо хоногийн хураангуй гаргана. Албан ёсны шалгалтын оноог XP-д хувиргахгүй.
- Буруу хариулсан нийтлэгдсэн хичээлийн асуулт хэрэглэгч бүрийн review queue-д орно. `/review` хэсгээс давтаж болно; зөв хариулсан тохиолдолд queue-г `mastered` болгоно. Энэ нь албан сорилын түүх, snapshot болон оноог өөрчлөхгүй.

#### Migration ба rollback

Development phase-ийн additive migration-ууд: `0014_learning_path_phase.sql`, `0015_lesson_content_review.sql`, `0016_chapter_completion_badge.sql`. 0014/0015-ын өмнө `backups/unit111_admin_test_2026-10-19_learning-path-pre-migration.dump`, 0016-ын өмнө `backups/unit111_admin_test_2026-10-19_10-01-47_pre_0016.dump` custom-format backup-ийг үүсгэж `pg_restore --list`-аар шалгасан. Зорилтот санг `unit111_admin_test` болон `127.0.0.1:5432` гэдгийг нууц утга хэвлэхгүйгээр тулгаж байж миграцыг ажиллуулсан.

Эдгээр migration-д өгөгдөл устгах down migration байхгүй. Аппын кодыг өмнөх хувилбар руу буцаахад нэмэгдсэн хүснэгт, баганууд хэвээр үлдэнэ (хуучин кодын өмнөх schema-тай нийцнэ). Өгөгдлийн санг migration-оос өмнөх төлөвт сэргээх шаардлага гарвал backup-ийг эхлээд тусдаа сэргээх database-д restore хийж шалгаад, дараа нь зориудаар өөрийн локал `.env`-ийг тэр тусгаарласан сан руу чиглүүлнэ. Одоогийн migrated database дээр шинэ progress/XP/content үүссэн бол 0014/0015-ийн хүснэгт, баганыг гараар drop хийхгүй; шаардлагатай бол тухайн additive migration-д зориулсан тусгай сэргээх төлөвлөгөө гаргана.

Migration хийсний дараа локал:

```powershell
pnpm --filter @unit111/api db:migrate
pnpm dev
```

Локал өгөгдлийн тоо орчин бүрд өөр байна. Migration болон seed нь техникийн сургалтын агуулгыг баталж нийтлэхгүй; одоо байгаа өгөгдлийг reset хийхгүй.

Migration-уудыг локал test database дээр ажиллуулж, хөгжүүлэлтийн серверийг асаах PowerShell команд:

```powershell
pnpm --filter @unit111/api db:migrate
pnpm dev
```

Админ `/admin/content` → “Хичээлүүд” хэсэгт хичээлүүдийг сонгоод “Сургалтын сорилтой холбох / үүсгэх” үйлдлийг давтан ажиллуулж болно; lesson ID-д тавьсан unique constraint болон транзакц давхардсан холбоос үүсгэхгүй. Үүний дараа нийтлэх readiness-г шалгаж, зөвхөн асуултууд нь `published` болсон хичээлийг бөөнөөр нийтэлнэ. Нийтлэхэд сургалтын сорил мөн нийтлэгдэж, суралцагчийн `/quizzes` жагсаалтад Learning Path-тэй ижил ахиц, XP-тайгаар гарна. Хяналт баталгаажаагүй асуулттай draft хичээлийг суралцагчид харуулахгүй.

UI дахь “Асуултын сан” tab-аас нэг нэгээр нь үүсгэх эсвэл CSV/XLSX сонгож preview хийх; “Хичээлүүд” tab-аас хичээл үүсгэж, нийтлэгдсэн асуулттай холбох; “Сорилууд” tab-аас нийтлэгдсэн асуултыг checkbox-оор сонгож, хугацаа, тэнцэх босго, оролдлогын тоо болон зөв хариултын оноог preview-д шалгасны дараа хадгалах боломжтой. Онооны тохиргоо нь асуулт бүрийн `quiz_questions.points` утгыг өөрчилнө; серверийн онооллын алгоритм болон өмнөх attempt/answer оноог өөрчлөхгүй.

### Орчны хувьсагчид

`.env.example`-ийг `.env` болгон хуулж зөвхөн өөрийн локал орчинд бөглөнө. Жишээ файлд жинхэнэ нууц байхгүй.

- `DATABASE_URL` — PostgreSQL-ийн холболтын URL. API, Drizzle migration болон seed энэ утгыг ашиглана.
- `SESSION_SECRET` — cookie session-ийн гарын үсгийн нууц; хамгийн багадаа 32 санамсаргүй байт хэрэглэнэ. Нууцын менежерт хадгалж, Git-д commit хийхгүй.
- `APP_ORIGIN` — browser клиент байрлах яг origin; CORS тохиргоо үүнтэй таарах ёстой.
- `API_PORT` — локал API портын fallback (4000). Hosting platform-ийн `PORT` үүнийг давж, API-г `0.0.0.0` дээр сонсгоно.
- `NODE_ENV` — `development` эсвэл `production`; production үед cookie Secure болон PostgreSQL TLS тохиргоо идэвхжинэ.
## Production deployment бэлтгэх

Энэ репозиторт deployment хийгдээгүй. GitHub, Vercel, Render эсвэл Neon account байхыг урьдчилан таамаглахгүй. `render.yaml`, root `vercel.json`, CI workflow нь тохиргооны загвар бөгөөд үйлчилгээ үүсгэх эсвэл account-д өөрчлөлт хийхгүй.

### Шаардлагатай орчны хувьсагч

- Render API: `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`. Render-ийн `PORT`-ийг API автоматаар ашиглана.
- `DATABASE_URL` нь зөвхөн API service дээрх нууц байг. Neon runtime connection pooling endpoint тохируулж болно; migration хийхэд Neon-ийн direct endpoint ашиглахыг зөвлөнө. Vercel-д database URL бүү оруул.
- `SESSION_SECRET` нь дор хаяж 32 санамсаргүй байттай, үйлчилгээнүүдэд давтагдашгүй байх ёстой.
- `APP_ORIGIN` нь API зөвшөөрөх frontend origin-уудын яг жагсаалт; олон origin-ийг таслалаар тусгаарлана. Wildcard ашиглахгүй.
- Vercel: `VITE_API_BASE_URL=https://<render-api-host>/api/v1` гэж Preview ба Production орчинд тус тус тохируулна. Энэ нь backend нууц биш. API нь зөвхөн тухайн орчинд хэрэглэгдэх frontend origin-ийг `APP_ORIGIN`-д зөвшөөрсөн байна.

Render/Vercel-ийн default домэйнүүд өөр site тул browser-ийн гуравдагч талын cookie хязгаарлалтаас нэвтрэлт найдвартай ажиллахгүй байж болно. Production-д нэг домэйн эзэмшиж, жишээ нь `quiz.example.org` ба `api.example.org` зэрэг нэг site-ийн дэд домэйн ашиглана. DNS/TLS-г тус тусын үйлчилгээ дээр тохируулж, яг frontend домэйнийг `APP_ORIGIN` болгоно. Preview-д тогтвортой тусдаа домэйн эсвэл тухайн Preview origin-ийг allowlist-д тодорхой оруулна.

### GitHub ба CI

Орон нутгийн өөрийн private repository үүсгээд commit хийнэ. GitHub remote болон push энд тохируулагдаагүй.

```sh
git add .
git commit -m "Prepare Unit111 production deployment"
git remote add origin <private-repository-url>
git push -u origin master
```

`.github/workflows/ci.yml` нь push болон pull request дээр install, typecheck, unit test, API/web build ажиллуулах загвар. CI амжилттай болохыг GitHub дээрээс шалгана.

### Render API

1. GitHub private repository-г Render-д холбоод `render.yaml` Blueprint-оор service үүсгэнэ. Энэ YAML нь build/start, `/health` check болон нууц утга шаардах env vars-ийг зарлана.
2. Render service settings дээр `DATABASE_URL`, `SESSION_SECRET`, `APP_ORIGIN`-ийг dashboard-ийн нууц Environment хэсэгт тохируул. Нууцыг GitHub, чат, frontend build vars-д бүү хадгал.
3. Production service-ээс өмнө Neon-ийн тусдаа staging database болон тусдаа Render staging service үүсгэ. Staging `APP_ORIGIN`-ийг тусдаа тогтвортой frontend домэйнд тохируул.
4. Deploy дууссаны дараа `https://<api-host>/health` JSON `{"status":"ok"}` буцааж буйг шалга.

### Vercel web

1. Ижил repository-г Vercel-д холбо; root directory-г репозиторийн үндэс хэвээр үлдээ. `vercel.json` нь pnpm install, web build, `apps/web/dist`, SPA fallback-ийг тохируулна.
2. Preview болон Production тус бүрд `VITE_API_BASE_URL` тавь. Production-д API host; Preview-д staging API host ашиглана.
3. Custom domain ба TLS-г тохируулж, API дахь `APP_ORIGIN`-д яг frontend origin-ийг бүртгэ. Vercel deploy URL өөрчлөгдвөл шаардлагатай origin-ийг шинэчил.
4. Vercel-ийн Preview болон Production deployment тус бүрийг нэвтрэлтээр шалгахаас өмнө CI болон staging acceptance тестийг амжилттай болго.

### Neon, migration, bootstrap

1. Neon дээр тусдаа staging болон production database үүсгэ. Render runtime connection-д pooled URL, migration хийхэд direct URL-ийг нууц удирдлагаар хэрэглэ.
2. Эхлээд staging-ийн тусдаа backup хийгээд staging `DATABASE_URL`-аар migration ажиллуул:
   `pnpm --filter @unit111/api db:migrate`
3. Staging дээр seed болон урсгалын тест амжилттай бол production deployment-ийн өмнө Neon backup/snapshot үүсгэ. Дараа нь production database URL-г зөвхөн нэг удаагийн migration command ажиллуулах локал эсвэл хамгаалагдсан runner-д түр тохируулж `pnpm --filter @unit111/api db:migrate` ажиллуул. API startup migration ажиллуулдаггүй.
4. Ангиллын seed давтан ажиллуулахад аюулгүй (`onConflictDoNothing`). Зөвхөн staging дээр эхлээд ажиллуул: `pnpm --filter @unit111/api db:seed`.
5. Хэрэв өмнөх migration-аар `competitions` мөрүүд үүссэн бол `0001`-ийн `quiz_id NOT NULL` нэмэх алхамд quiz-ийн холбоос тодорхойгүй тул production migration-ийг шууд ажиллуулахгүй; backup/staging дээр мөр тус бүрийн холбоосыг аюулгүй тогтоох migration төлөвлөгөө гарга. Одоогийн шинэ DB суулгалтад хүснэгт хоосон тул энэ зөрчил үүсэхгүй.
6. Зөвхөн зөвшөөрөгдсөн админ production DB бэлэн болсны дараа `pnpm --filter @unit111/api bootstrap:admin`-г нэг удаа ажиллуулж, prompt-д түр нууц үгээ оруулна. Энэ нууц үг shell command history/Git/chat-д орох ёсгүй. Эхний нэвтрэлт password change шаардана. Команд users хүснэгт хоосон үед л ажиллана; анхны админыг үүсгэх эрхтэй оператор үүнийг гүйцэтгэнэ.

### Backup, restore, rollback

Database backup/restore нь одоогоор орчинд туршигдаагүй. PostgreSQL client tools бүхий хамгаалагдсан орчноос backup ав:

```sh
pg_dump --format=custom --no-owner "$DATABASE_URL" --file unit111-backup.dump
```

Restore-ийг production өгөгдөл дээр биш, тусдаа хоосон сэргээх database-д турш:

```sh
pg_restore --no-owner --dbname "$RESTORE_DATABASE_URL" unit111-backup.dump
```

Хандалтыг хязгаарлаж, backup файлыг шифрлэн хадгалж restore-ийг тогтмол шалга. Application rollback нь Render/Vercel дээр өмнөх ажиллаж байсан deploy руу буцах; энэ нь database schema-г буцаахгүй. Одоогийн migration-уудад автоматаар буцаах migration байхгүй тул schema өөрчлөлтийн өмнө backup хийж, rollback шаардлагатай бол тусгаарласан сэргээсэн DB дээр засварыг баталгаажуул. Production database-г `DROP`, reset, overwrite хийхгүй.
## PWA

HTTPS дээр нээж browser-ийн Install app үйлдлийг ашиглана. Статик файлуудыг service worker кэшлэнэ; API болон хувийн хариултыг кэшлэхгүй. Албан ёсны сорилын хариултыг offline үед илгээхгүй.

## Техникийн тэмдэглэл

- Зөв хариултын хүснэгтийг quiz fetch API-с тусад нь хадгална. Client score/is_correct утга илгээхгүй.
- Attempt submit transaction дотор тооцоолж, database row lock болон unique constraints ашиглана.
- Cookie нь HTTP-only, SameSite=Lax. Хувиргах хүсэлтэд session CSRF token шаарддаг.
- API v1: /api/v1. Асуултын ноорог-хяналт-баталгаа-нийтлэл, засвар/revision, CSV/XLSX draft импорт, ижил төстэй асуултын анхааруулга, хичээл CRUD, сорил үүсгэх/нийтлэх, багийн гишүүнчлэл, уралдаан болон тайлангийн API, audit log API орсон. Уралдааны админ UI, багийн тайлангийн бүрэн нэгтгэл хараахан бүрэн биш. Publish хийхэд тусдаа админы approval, эх баримт/хувилбар/байршил, нийтлэх үеийн эх сурвалж шалгасан тухай audit тэмдэглэл шаардана; энэ тэмдэглэл нь ажилтны баталгаа болохоос эх баримтын агуулгыг автоматаар нотлохгүй.
- Бодит RFM-аас баталгаажаагүй техникийн жишээ контент оруулаагүй. Deployment хийгдээгүй.


## Тест ба одоогийн хамрах хүрээ

- API scoring unit test: `pnpm --filter @unit111/api test`.
- TypeScript шалгалт: `pnpm --filter @unit111/api typecheck` болон `pnpm --filter @unit111/web typecheck`.
- Production frontend build: `pnpm --filter @unit111/web build`.
- Одоогийн unit test нь оноолт, хоосон хариулт, асуултын төлөв/эрх, сонголтын validation, ижил төстэй асуултын оноолол болон quiz-start өгөгдлийн хэлбэрийг шалгана. Тусгаарласан PostgreSQL integration runner болон frontend regression багц нэмэгдсэн; одоогийн дүнг docs/WEB-READINESS.md-ээс үзнэ үү.

Хэрэгжсэн үндсэн урсгал: админ хэрэглэгч үүсгэх, эх сурвалж заасан асуултыг ноорог болгон илгээх, өөр админаар батлуулах, асуулт болон сорил нийтлэх, ажилтны сорилын хариултыг серверт оноолох, хувийн үр дүн болон эрэмбэ харах. Асуултын сан seed-д хоосон байна.

Дараагийн фазад уралдаан/багийн админ ба ажилтны UI, асуултын засвар/revision ба CSV импорт, категори удирдлага, сүлжээ тасарсан үеийн attempt resume болон timer, багийн тайланг гишүүнчлэлийн түүхтэй холбох, өргөн integration/mobile тест, deployment proxy ба backup/restore зааврыг дуусгана.








