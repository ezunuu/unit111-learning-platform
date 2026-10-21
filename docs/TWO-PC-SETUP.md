# UNIT 111 — хоёр Windows PC дээр ажиллах заавар

2026-10-17-ны бодит шалгалт: ажлын төсөл `C:\Users\Asaru.Flight\OneDrive\Documents\ChatGPT\QUIZ111` дээр байна. Git: master, commit 0, remote 0. GitHub/Neon холболт хараахан хийгдээгүй.

## Ажлын PC дээр батлагдсан зүйл

- Node 22.21.1, pnpm 11.25.0; төслийн .node-version нь 22.22.0. Гэрт .node-version-той ижил Node ашиглана.
- PostgreSQL 17 client байгаа; локал unit111_admin_test холболт амжилттай. Зөвхөн READ ONLY transaction ашигласан.
- Drizzle migration 0000–0013: 14 journal entry, санд 14 migration timestamp таарсан. Бүх schema drift-ийг тусдаа шинжилж батлаагүй.
- users 1, categories 25, audit_logs 616, question_imports 1, sessions 4. questions, quizzes, lessons, attempts: 0.
- Нууцын хэв шинж ба .env дахь secret утгын хайлтаар код дотор тааралт олдоогүй. Энэ нь бүх төрлийн нууцыг бүрэн илрүүлсэн баталгаа биш.
- .env болон node_modules Git-д бүртгэгдээгүй. Ignore-д dump, credential, generated reports хамгаалалт нэмсэн. Migration SQL-ийг хадгална.
- SESSION_SECRET 64 тэмдэгттэй. Argon2 password hashing, PostgreSQL session store, 8 цагийн cookie, httpOnly, SameSite=Lax; production-д secure cookie. Login session regenerate, CSRF хамгаалалт байгаа.
- Development cookie нь localhost дээр ажиллана. Гэр/ажлын browser session-ийг шилжүүлэх шаардлагагүй. PC бүрт тусдаа SESSION_SECRET үүсгэж шинээр login хийнэ.

## GitHub холбоход

Нэвтэрсэн хэрэглэгчийн account дор UNIT111-AVIATION-QUIZ private repo санал болгосон. Repo URL, account болон private visibility-г баталгаажуулсны дараа эхний commit/push хийнэ. Token-ийг чат, URL, код, screenshot-д оруулахгүй. Credential Manager эсвэл GitHub browser login ашиглана.

OneDrive хавтсыг хоёр PC-ийн код sync хийхэд ашиглахгүй. Гэрийн clone-ийг OneDrive-оос гадуур байрлуулна. Ажлын кодыг эхний push амжилттай, backup баталгаатай болсны дараа тусдаа clone руу шилжүүлж болно; одоогийн хавтсыг устгахгүй.

## Гэрийн PC — GitHub repo бэлэн болсны дараа

Git for Windows, Node 22.22.0, pnpm 11.25.0 суулгана. PowerShell:

```powershell
New-Item -ItemType Directory -Force C:\Dev | Out-Null
Set-Location C:\Dev
git clone https://github.com/ACCOUNT/UNIT111-AVIATION-QUIZ.git
Set-Location UNIT111-AVIATION-QUIZ
pnpm install --frozen-lockfile
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

ACCOUNT-ыг батлагдсан repo owner-оор солино. Сүүлийн командын утгыг зөвхөн локал .env дэх SESSION_SECRET-д хадгална. DATABASE_URL = зөвшөөрсөн development сангийн runtime connection; DIRECT_DATABASE_URL = ижил сангийн direct connection. APP_ORIGIN=http://localhost:5173, API_PORT=4000, NODE_ENV=development. VITE_* хувьсагчид DB URL эсвэл secret бүү оруул.

```powershell
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm dev
```

Web: http://localhost:5173; DB-тэй health: http://localhost:4000/health. /api/v1/health нь DB холболтыг шалгадаггүй. Production API start: `pnpm --filter @unit111/api start`; web-ийн production dist-д static hosting хэрэгтэй.

## Migration ба Neon шилжүүлэх төлөвлөгөө

1. Тусгаарлагдсан Neon development project/branch, хоосон database, тусгай role сонгоно. Production connection хэрэглэхгүй. Target project/branch/database болон өгөгдөл сонголтыг хэрэглэгчээр батлуулна.
2. Зөвлөмж: шинэ development хэрэглэгчтэй цэвэр сан. Одоогийн локал санг хадгална; 25 ангиллыг шаардлагатай бол тусад нь экспортлон шилжүүлнэ. Seed script нь бусад өөрчлөлт хийж болох тул шалгалтгүй ажиллуулахгүй.
3. Холболтыг .env-д локалаар оруулж, SSL-тэй холболт болон target нэрийг secret-гүйгээр шалгана. Runtime-д pooled эсвэл direct; migration, dump/restore-д direct/unpooled ашиглана. NODE_ENV=development хэвээр; cloud DB ашигласнаар production cookie-г идэвхжүүлэх шаардлагагүй.
4. Цэвэр санд л `pnpm db:migrate` ажиллуулна. Дараа нь шалгасан `pnpm --filter @unit111/api bootstrap:admin` урсгалаар шинэ development admin үүсгэнэ. Admin credential-ийг чат/Git-д оруулахгүй.
5. Хэрэв одоогийн өгөгдлийг хуулна гэж тусгайлан зөвшөөрвөл: эх үүсвэрээс timestamp-тай custom-format pg_dump backup гаргаж, checksum болон pg_restore --list шалгана. public.sessions өгөгдлийг хасна. Dump-д password hash, audit/PII байж болох тул хамгаалж хадгална; Git-д хийхгүй.
6. Full schema+data restore-г зөвхөн хоосон target-д, --no-owner --no-privileges --single-transaction --exit-on-error ашиглан хийнэ. --clean ашиглахгүй. Migration journal мөн restore хийгдсэн тул дараа нь зөвхөн дутуу migration байгаа эсэхийг шалгана; бүх migration-ийг дахин эхнээс ажиллуулахгүй.
7. Target дотор schema, constraint, migration hash/timestamp, хүснэгтийн тоонуудыг эхтэй харьцуулна. Sessions=0; шинэ login, logout, CSRF, эрхийн шалгалт, health болон үндсэн quiz урсгалыг шалгана. Source-г устгахгүй. Rollback: ажлын локал .env-г хуучин connection дээр нь хадгална.
8. Shared development DB дээр migration-ийг нэг PC-ээс нэг удаа, backup ба зөвшөөрөлтэй ажиллуулна. Шинэ PC clone бүр migration, seed, restore хийхгүй. Хүснэгт устгах/overwrite нь тусдаа тодорхой зөвшөөрөл шаарддаг.

DB integration tests нь local unit111_admin_test-ийг хатуу шаарддаг, зарим нь өгөгдөл бичиж болзошгүй тул Neon руу чиглүүлэхгүй. Шалгалтад эдгээр 3 test-ийг идэвхжүүлээгүй.

Neon баримт: https://neon.com/docs/manage/backup-pg-dump — dump/restore-д direct connection ашиглана.

## Өдөр тутмын pull/push

Ажил эхлэхдээ:

```powershell
git status
git pull --ff-only
pnpm install --frozen-lockfile
pnpm dev
```

Ажил дуусахдаа:

```powershell
pnpm -r typecheck
pnpm -r test
pnpm -r build
git status --short
git add apps packages .github .gitignore .env.example .node-version package.json pnpm-lock.yaml pnpm-workspace.yaml README.md render.yaml vercel.json docs
git diff --cached --stat
git diff --cached
# Нууц, dump, хувийн мэдээлэл ороогүйг шалгасны дараа:
git commit -m "Describe the change"
git push
```

packages хоосон, Git-д бүртгэлгүй байвал add жагсаалтаас хасна. Өөр PC рүү шилжихээс өмнө push амжилттай болсныг шалгана. Pull conflict/failure гарвал хүчээр overwrite хийхгүй; commit эсвэл stash хийж шийднэ. Migration үүсгэхэд `pnpm db:generate`; generated SQL-ийг review хийсний дараа commit хийнэ. `git push --force`, `reset --hard`, DB drop/restore-г ердийн workflow-д ашиглахгүй.

## Эцсийн баталгаажуулалт

- API + web typecheck: PASS.
- API tests: 70 PASS, 3 DB integration SKIP; web tests: 3 PASS.
- API + web production build: PASS.
- Migration 14 SQL файлын SHA-256 hash болон timestamp нь локал migration journal-той бүгд таарсан.
- Түр API процессоор бодит DB health: HTTP 200, status=ok; нэвтрээгүй /api/v1/auth/me: HTTP 401. Түр процессыг зогсоосон.
- .env, node_modules, backups, reports, export.dump, credentials.pem, export.sql ignore баталгаажсан; Drizzle migration SQL ignore болоогүй.
- Гэрийн PC дээр fresh clone/install хийгээгүй. Neon connection, browser login/session-ийн бүрэн урсгал, GitHub authentication/push хараахан баталгаажаагүй.

## Нэмэлт шалгалт — цэвэр суулгалт

Төслийн node_modules, .env, .git, backups, reports-гүй тусгаарлагдсан хуулбар дээр pnpm install --frozen-lockfile амжилттай. Lockfile өөрчлөгдөөгүй. Typecheck, API 70 + web 3 test, хоёр production build дахин PASS; DB integration 3 SKIP. Энэ нь ажлын PC дээрх цэвэр суулгалтын шалгалт бөгөөд гэрийн PC дээр бодитоор ажиллуулсан гэсэн үг биш.

CI API tests-д бодит secret шаардахгүй localhost placeholder DATABASE_URL болон UNIT111_TEST_DATABASE_INTEGRATION=0 тохируулсан. .neon context Git-ээс хасагдсан.

SETUP-HOME-PC.ps1 нь батлагдсан GitHub URL-аас шинэ хавтас руу clone хийж, locked dependency суулган, development connection-уудыг нууцаар асууж .env үүсгэнэ. Өмнөх хавтас/.env-г overwrite хийхгүй; migration, seed, restore ажиллуулахгүй. Script syntax шалгалт PASS; гэрийн PC дээр end-to-end ажиллуулаагүй.

```powershell
.\SETUP-HOME-PC.ps1 -RepositoryUrl 'https://github.com/ACCOUNT/UNIT111-AVIATION-QUIZ.git'
```

Chrome-ийн веб нэвтрэлт Git push-ийн эрхийг автоматаар үүсгэхгүй. GitHub CLI browser authorization болон Neon CLI login дууссаны дараа repo/project-ийг холбоно. Нууц үг/token-ийг чатад дамжуулахгүй.

Migration SQL-д .gitattributes -text тохируулж Windows line-ending conversion-оос хамгаалсан. Эхний commit-д staged 123 файл; хориглосон staged path 0; 14 migration-ийн staged bytes нь source файлтай яг таарсан. Commit болон push authentication дуусахыг хүлээж байна.
