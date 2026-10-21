# UNIT 111 — Web readiness, 2026-10-20

## Төлөв
Web-ийн үндсэн сургалтын урсгалуудыг локал орчинд засаж, production build бэлдсэн. Hosting/domain-д байршуулалт хийгээгүй. Энэ тайлан нь бүх техникийн сургалтын агуулга баталгаажсан, эсвэл live орчин шалгагдсан гэсэн баталгаа биш.

## Хийгдсэн засвар
- Lesson → Review болон Review → Review Retry шинэ сонголт, цэвэр feedback-тэй нээгдэнэ.
- Review-д XP боломж 0; дууссан review refresh хийхэд хадгалсан дүн сэргэнэ.
- Өмнөх route-ийн удааширсан start response шинэ route-ийг дарж солихгүй.
- Mobile navigation уншигдах өргөнтэй, хэвтээ гүйлгэнэ. Mobile-оос гарах товч нэмсэн.
- Logout хэрэглэгчийн кэшийг цэвэрлэж нэвтрэх дэлгэц рүү шууд орно; login дахин хэрэглэгчийн өгөгдлийг ачаална.
- Нэвтрэх талбарууд label болон autocomplete-тэй.
- Холболтын алдааг монголоор харуулна; эхний ачаалалт алдагдвал дахин ачаалах товчтой.
- Миний ахиц нь XP, дууссан хичээл, өдрийн цуврал, 7 хоногийн XP, хичээл тус бүрийн төлөв харуулна. Албан сорилын үр дүнг тусад нь тайлбарлана.
- Профайл дахь цуврал болон чансааны онооны нэршлийг залруулсан.
- Буруу холбоос 404 тайлбар болон Нүүр хуудас холбоостой.
- Lesson start дуусаагүй review-г lesson гэж үргэлжлүүлэхгүй.
- CI-д тусгаарласан PostgreSQL integration job нэмсэн.

## Шалгалтын дүн
| Шалгалт | Дүн |
|---|---|
| API TypeScript build / unit tests | PASS: 82, FAIL: 0, SKIP: 7 |
| PostgreSQL isolated integration | PASS: 3, FAIL: 0 |
| Web tests | PASS: 12, FAIL: 0 |
| Web TypeScript / production build | PASS |
| Production dependency audit | No known vulnerabilities found |
| Desktop 1440×1000 / mobile 390×844 | Үндсэн хуудсуудын browser smoke PASS |
| Mini Lesson 4 блок, Next/Previous, refresh/resume | PASS — өмнөх browser тайланд баримтжуулсан |
| 10 асуулт, Explanation, Retry, XP | PASS — uno дээр 10/10, 135 XP; Retry +0 XP |
| Mobile logout / login | PASS, refresh шаардаагүй |
| Дууссан review refresh | PASS, 1/1, 100%, +0 XP сэргэнэ |

API unit багцын SKIP нь integration flag шаардах 7 тест; тусдаа integration runner нь сонгосон 3 тестийн файл ажиллуулсан. Бүх skipped integration файл энэ release-д ажилласан гэж үзэхгүй.

Шинэ frontend regression: Retry хуучин state цэвэрлэх, review XP preview, completed review reload, delayed response route isolation, failed answer retry. API integration-д хоёр tab зэрэг start, давхар answer, давхар complete, theory sequence ба skip хамгаалалт шалгасан.

## Dependency шинэчлэлт
- drizzle-orm 0.45.2
- react-router-dom 7.18.2
- Lockfile шинэчлэгдсэн; React 18 хэвээр.
- Dev test хэрэгсэл: react-test-renderer 18.3.1, tsx 4.19.2.

Засварын advisory эх сурвалж:
- https://github.com/advisories/GHSA-gpj5-g38j-94v9
- https://github.com/advisories/GHSA-wrjc-x8rr-h8h6
- https://github.com/advisories/GHSA-337j-9hxr-rhxg
- https://github.com/advisories/GHSA-qwww-vcr4-c8h2

## Дахин шалгах команд
```sh
pnpm install --frozen-lockfile
pnpm --filter @unit111/api test
pnpm --filter @unit111/web test
pnpm --filter @unit111/web build
pnpm --filter @unit111/api test:integration
pnpm audit --prod
```
Integration runner зөвхөн локал unit111_admin_test холболтыг суурь болгож шинэ unit111_it_* сан үүсгэнэ; одоогийн сургалтын санг reset хийхгүй. Шалгалтын сангуудыг хадгалж үлдээсэн. CI-ийн PostgreSQL service-ийн хүрээнд ижил runner ажиллана. GitHub дээр CI job-г бодитоор ажиллуулж үзээгүй.

## Release файлууд
Production frontend нь apps/web/dist дотор байна. Unit111 web ZIP нь зөвхөн энэ build-ийн нийтэд өгөх статик файлуудыг агуулна; .env, нууц үг, database dump, node_modules ороогүй.

Build API-ийн /api/v1 relative замыг ашиглана. Байршуулах үед энэ замыг ажиллаж буй UNIT 111 API руу чиглүүлэх шаардлагатай; frontend ZIP дангаараа нэвтрэлт/өгөгдлийн сангийн үйлчилгээг орлохгүй. Өөр origin API ашиглах бол VITE_API_BASE_URL-ийг build хийхээс өмнө тохируулж дахин build хийнэ.

Live орчинд дараа нь шалгах зүйл: API/DB холболт, HTTPS/cookie, SPA fallback (/lesson/... зэрэг шууд холбоос), cache/PWA шинэчлэлт, backup/restore. Domain, hosting эсвэл бодит өгөгдөлд өөрчлөлт хийгээгүй.

## Хамрах хүрээний хязгаар
- Бодит агуулга publish/approve хийгээгүй. Үлдсэн draft онолын контентыг эрх бүхий reviewer тусад нь хянана.
- Production мэдээлэл, төлбөртэй account, DNS/TLS-д өөрчлөлт хийгээгүй.
- Browser сүлжээг зориуд салгаагүй; сүлжээ тасалдлын урсгалыг frontend regression тестийн rejected request-ээр шалгасан.
- Admin-ийн бүх үйлдлийг browser-оор нэг бүрчлэн ажиллуулаагүй; API policy/unit ба сонгосон integration тестүүдийг ашигласан.
- Тест хэрэглэгчийн сургалтын үйлдлүүд хадгалагдсан; нууц үгийг deliverable-д оруулаагүй.

## Сургалтын чиглэл — 2026-10-20

- Нисэхийн мэдлэг, Улсын нисэхийн дүрэм, Цэргийн дүрэм гэсэн дээд ангилал нэмсэн.
- Админ Course Builder дотор чиглэл нэмэх/нэрлэх, сургалтыг чиглэлд шилжүүлэх боломжтой.
- Сонголт dashboard, сургалтын зам, сургалтын сорилыг шүүнэ; refresh дараа хадгалагдана.
- Одоогийн сургалтууд Нисэхийн мэдлэгт хамаарна. Шинэ хоёр чиглэлд агуулга хараахан нэмээгүй.
- Deployment: API болон web-ийг хамтад нь шинэчилж, `0020_low_shocker.sql` migration-ийг ердийн migration runner-аар ажиллуулна. Migration journal-ийн дарааллыг хадгална.
- Локал migration-ээс өмнө backup хийсэн; дараа нь асуулт, хичээл, сургалт, ахицын тоо болон нийт XP өөрчлөгдөөгүйг шалгасан.
- Шалгалт: API 82 PASS / 8 integration SKIP; тусгаарласан integration 4 PASS; web 16 PASS; production build PASS. Browser desktop 1440×1000, mobile 390×844 дээр сонголт, хоосон чиглэл, refresh/resume PASS.

## Өдрийн цувралын animation

Хэрэглэгчийн timezone-аар тооцсон activityDate-г path summary-д буцаана. Сургалтын идэвхтэй өдрийн шинэ өсөлтийг ажиглаж дөл, тоо, confetti-тай 4.6 секундийн notification харуулна. Анхны ачаалалд хуучин цувралыг тэмдэглэхгүй; хэрэглэгч/өдрөөр localStorage-д давталтыг тэмдэглэнэ. Refresh болон тухайн өдрийн дараагийн хичээлд animation давтагдахгүй. Хаах товч, reduced-motion хувилбартай. Оноо, XP, ахицын бичлэг өөрчлөхгүй. UI 21 PASS, API/web build PASS. Migration шаардлагагүй; API болон web-ийг хамт шинэчилнэ.
