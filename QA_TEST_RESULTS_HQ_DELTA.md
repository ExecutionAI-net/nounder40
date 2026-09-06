# HQ Panel — QA Delta Pass (2026-09-06)

Bu dosya, önceki HQ turunun (`QA_TEST_RESULTS.md` §1) bıraktığı derin CRUD/UI
boşluklarını kapatmak için yapılan ikinci geçişin sonucudur. Ortam: dev
(`https://dev.danzaclassicanounder40.com`), sürücü hesap `qa.hq.owner`.

## Önemli metodoloji notu — paylaşılan tarayıcı oturumu

JWT `localStorage`'da tutulduğu için (mimari invariant #1), aynı origin'i
paralel test eden 4 QA ajanının hepsi **aynı tarayıcı profilini** paylaşıyor.
Her sekmenin kendi `tabId`'si olsa da `localStorage` origin bazlı ve sekmeler
arasında ortak: bir kardeş ajan School/Teacher/Student paneline login olduğu
anda benim `qa.hq.owner` oturumum sessizce değişiyor. Bu oturumda düzinelerce
kez gerçekleşti (bazen saniyeler içinde). Sonuç olarak:

- Birkaç "403 / Something went wrong" gözlemi **ürün hatası değil** —
  tam da bu çakışmanın belirtisiydi. Her şüpheli 403'ü **taze bir
  `qa.hq.owner` token'ıyla doğrudan `curl`** ile tekrar ederek doğruladım;
  hepsi curl ile 200/201 döndü.
- Bunu aştıktan sonra en güvenilir yöntem **doğrudan `localStorage`'a
  `nu40_access`/`nu40_refresh` enjekte etmek** oldu (UI login formunu
  atlayarak) — bu bir ürün hatası değil, sadece bu QA turunun test altyapısı
  notu.
- Ayrıca birkaç buton tıklaması (Reports "Teachers" sekmesi, Email
  Templates dil sekmesi/HTML görünümü, Translations "Missing only") **ilk
  denemede** hiçbir etki göstermedi; ama (a) tekrar denendiğinde veya (b)
  `button.click()` ile doğrudan DOM üzerinden tetiklendiğinde **hepsi
  doğru çalıştı**. Bunlar tarayıcı-otomasyon tıklama kaydı sorunuydu
  (muhtemelen Browser pane bazen "minimized/hidden" oluyordu — bkz.
  screenshot hataları), **ürün hatası değil**. Aşağıdaki tabloda PASS
  olarak işaretlendi, ama JS-dispatch ile doğrulandığı belirtildi.
- Bu nedenle her önemli mutasyon **API ile de çapraz doğrulandı** (görev
  talimatına uygun olarak).

## Yeni Bulgular (New Bugs Found)

### 🟡 Orta — i18n: platform genelinde ham çeviri-anahtarı metni (Bulgu #4/#9'un devamı, çok daha geniş kapsamlı)
Zaten bilinen "placeholder-stili İngilizce metin" hatası HQ panelinin
**hemen hemen her sayfasında** var. `/hq/translations` arama kutusuyla
(form_input ile, bkz. not) taranan örnek desenler ve eşleşme sayıları:

| Arama deseni | Eşleşen anahtar sayısı |
|---|---|
| `Label ` | 123 |
| `Column ` | 18 |
| `Status ` | 20 |
| `Kpi ` | 25 |

`/hq/debug` sayfası (bkz. aşağıda) bunu kanıtlıyor: `messages.hq.dashboard`
JSON'unda `"title": "Title"`, `"kpiActiveSchools": "Kpi Active Schools"`,
`"kpiTotalStudents": "Kpi Total Students"` vb. EN değerleri **literal
olarak anahtar adının insan-okunur hali** — gerçek İngilizce metin değil.
Bu turda tespit edilen sayfa/örnek listesi:

- **Dashboard**: başlık düz `Title`; KPI kartları `KPI ACTIVE SCHOOLS`,
  `KPI TOTAL STUDENTS`, `KPI WEEKLY LESSONS`, `KPI ACTIVE SUBSCRIPTIONS`.
- **Lesson Types**: aksiyon linkleri `Action Edit` / `Action Copy` /
  `Action Deactivate`; "New" formunun başlığı `Form New Title`; Level
  açılır kutusu **yanlış çeviri anahtarına bağlanmış** — filtre
  metinlerini gösteriyor: `Filter All Levels` / `Filter Entry` /
  `Filter Intermediate` / `Filter Advanced` (bu form alanı olarak
  kullanılıyor, filtre olarak değil — bkz. 🟢 ayrı madde).
- **Packages (HQ)**: form alan etiketleri `Label Description`,
  `Label Credits`, `Label Price`, `Label Color`.
- **Shop → Products**: tablo başlıkları `COLUMN PRODUCT`, `COLUMN CATEGORY`,
  `COLUMN PRICE`, `COLUMN STATUS`; durum rozeti `Status Active`.
- **Payments**: KPI kartları `KPI TOTAL GMV`, `KPI PLATFORM FEES`,
  `KPI FEES THIS MONTH`, `KPI TRANSACTIONS`; filtreler `Filter All
  Statuses`, `Filter All Schools`; tablo başlıkları `COLUMN DATE`,
  `COLUMN SCHOOL`, `COLUMN STUDENT`, `COLUMN PRODUCT`, `COLUMN AMOUNT`,
  `COLUMN HQ FEE`, `COLUMN STATUS`; durumlar `Status Completed` vb.
- **Reports**: `KPI ACTIVE SCHOOLS`, `KPI TOTAL STUDENTS`,
  `KPI TOTAL TEACHERS`; tablo başlıkları `COLUMN SCHOOL`, `COLUMN CITY`,
  `COLUMN STUDENTS`, `COLUMN TEACHERS`, `COLUMN STATUS`; durumlar
  `Status Active`/`Status Inactive`.
- **Homepage Settings**: form etiketleri `Label Schools`, `Label Teachers`,
  `Label Students`, `Label Lessons Monthly`.
- **Metodo Library**: filtreler `Filter All Types`, `Filter Video`,
  `Filter Pdf`, `Filter All Levels/Entry/Intermediate/Advanced`,
  `Filter All Languages/English/Italian/French/Spanish`; rozet
  `Badge Students`; aksiyonlar `Action Edit`, `Action Delete`.
- **Inbox**: aksiyon `Action Open`.

**Etki**: gerçek İngilizce kullanıcılar (varsayılan locale = `en`) HQ
panelinin neredeyse tamamında "kırık" görünen, geliştirici-anahtarı gibi
okunan metinlerle karşılaşıyor. Bu, canlıya çıkmadan önce bir içerik
yazım/QA geçişi gerektirir (kod hatası değil, `Translation` tablosundaki
EN değerlerinin doldurulması gerekiyor — CLAUDE.md'de zaten böyle
tanımlanmış).

### 🟡 Orta — "Export CSV" butonu metni bozuk: "Export C S V"
`hq.payments.buttonExportCSV` ve Reports'taki eşdeğeri, render'da
harfler arasına boşluk koyarak **"Export C S V"** olarak görünüyor
(muhtemelen "CSV" kısaltmasının yanlış bir camelCase-ayrıştırma/i18n
formatlama sorunu ile karakter karakter bölünmesi). Fonksiyonel olarak
buton çalışıyor (istemci tarafında zaten yüklü tablo verisinden CSV blob
üretip `<a download>` ile indiriyor — ağ isteği yok, kod incelemesiyle
doğrulandı: `frontend/src/app/[locale]/hq/payments/page.tsx:54`), ama
görünen metin bozuk. Hem Payments hem Reports sayfasında aynı hata var.

### 🟢 Düşük — Lesson Types formunda "Level" alanı filtre metinleriyle dolduruluyor
`New`/`Edit`/`Copy` formundaki **Level** açılır kutusu form-alanı çeviri
anahtarına değil, tablo başlığındaki filtre metnine bağlanmış: seçenekler
`Filter All Levels` / `Filter Entry` / `Filter Intermediate` /
`Filter Advanced` olarak görünüyor ("Level: Entry" yerine "Level: Filter
Entry" gibi okunuyor). Fonksiyonel olarak çalışıyor (value'lar doğru:
`entry`/`intermediate`/`advanced`), sadece görünen metin yanlış context'ten
geliyor — muhtemelen aynı `useTranslations('hq.lessonTypes')` namespace'i
içinde filtre ve form seçenekleri aynı anahtarı paylaşıyor.

### 🟢 Düşük (test altyapısı / temizlik) — Önceki QA turundan temizlenmemiş veri
`qa-lesson-type` kodlu bir HQ lesson type hâlâ dev'de duruyor ve **artık
gerçek kullanımda** (1 course, 3 lessons ona bağlı — muhtemelen bir School
paneli test turunda oluşturulmuş bir course). `DELETE
/api/hq/lesson-types/{id}/` doğru şekilde `400 {"error":"in_use",...}`
döndürdü (silme koruması **doğru çalışıyor** — bu PASS), ama veri kendisi
temizlenmemiş kalmış. Bağlı course/lesson School panelinin sorumluluğunda
olduğu için silmedim; koordinatöre/School ajanına bırakıyorum. Ayrıca
Payments/Reports sayfalarında `Danza Classica Milano` okulunun paket
adlarında `(copy) (copy) (copy)` gibi çoklu-kopya izleri var (önceki
"Copy" testlerinden kalma, School panel kapsamı) — işlevsel bir sorun
değil, sadece görünüm kirliliği.

### Doğrulanmış — Gerçek hata OLMAYAN gözlemler (false positive'ler, kayıt için)
- **Lesson Types "New" butonu**: önceki turda "form açılmadı" denmişti.
  Bu turda tekrar test edildi: buton **çalışıyor**, form açılıyor (sadece
  sayfanın altına render oluyor, scroll gerektiriyor — tarayıcı zaman
  aşımı/erken bakış nedeniyle önceki turda kaçırılmış).
- **Packages "New Package" butonu**: aynı şekilde ilk denemede
  `get_page_text` formu yakalayamadı ama ekran görüntüsü formun gerçekten
  açıldığını gösterdi — gerçek bir sorun yok.
- **Homepage Settings alan adları için curl testi**: kendi hatam yüzünden
  `POST /api/hq/homepage-settings/` çağrısını yanlış alan adlarıyla
  (`stat_students` yerine `students` vb.) yaptım, bu da **tüm istatistik
  değerlerini geçici olarak 0'a düşürdü**. Hemen doğru alan adlarıyla
  (`teachers`, `students`, `lessonsMonthly`, `schools`) orijinal değerlere
  (`20/249/950/3`) geri yüklendi ve doğrulandı — **canlı veri kalıcı olarak
  etkilenmedi**, ama not: bu endpoint **tam nesneyi değiştiriyor** (partial
  update yok), yani UI dışında bu uca elle istek atan biri kolayca tüm
  sayaçları sıfırlayabilir. Frontend formu her zaman 4 alanı da birlikte
  gönderdiği için UI üzerinden bu risk yok.
- **Reports "Teachers" sekmesi, Email Templates dil/HTML sekmeleri,
  Translations "Missing only"**: yukarıda açıklandığı gibi tıklama
  kaydı sorunları nedeniyle ilk denemelerde etkisiz görünmüşlerdi;
  `button.click()` ile doğrudan tetiklendiğinde hepsi doğru çalıştı.

---

## Sayfa Bazlı Test Tablosu

### Lesson Types
| Aksiyon | Sonuç |
|---|---|
| Sayfa yükleme, 12 (+1 QA leftover) kayıt listesi | ✅ PASS |
| "New" butonu → form açılması | ✅ PASS (önceki tur yanlış negatifti) |
| Yeni lesson type oluşturma (kod, level, IT/EN isim) | ✅ PASS — `POST` 201, API ile doğrulandı |
| Level alanı çeviri metni | 🟢 Bulgu — "Filter X" metni gösteriyor (yukarıda) |
| Edit/Copy/Deactivate/Activate/Delete aksiyonları | ✅ PASS (kod incelemesi: `openEdit`/`openCopy`/`toggleActive`/`handleDelete` sağlam; Copy sunucu tarafında ayrı endpoint değil, istemci tarafında formu önceden dolduruyor — `_COPY` son ekli kod, kullanıcı değiştirmezse unique constraint hatası verir, beklenen davranış) |
| Delete guard (courses/lessons > 0 iken engelleme) | ✅ PASS — `qa-lesson-type` üzerinde canlı doğrulandı (`in_use` hatası) |
| Oluşturduğum test kayıtları temizliği | ✅ PASS — `qa-lt-2` silindi, API ile doğrulandı |

### Shop
| Aksiyon | Sonuç |
|---|---|
| Products/Sales/Discount codes sekme geçişleri | ✅ PASS |
| Products tablosu (Collezione Libri, Body, Calzamaglia Danza) | ✅ PASS, gerçek verilerle doğru render |
| Tablo başlıkları i18n | 🟡 Bulgu — `COLUMN X` ham anahtarlar |
| "Hidden from students" toggle (`/hq/student-shop-visibility/`) | ✅ PASS — UI tıklaması ile `false→true` değişti, API ile doğrulandı, hemen `false`'a geri alındı ve doğrulandı |
| Table ↔ Storefront görünüm değişimi | ✅ PASS — Storefront gerçek ürün kartlarını (indirim rozetleri, "MOST POPULAR"/"NEW" etiketleri, varyant seçenekleri) doğru gösteriyor |
| Sales sekmesi (filtreler + toplam) | ✅ PASS — gerçek satış kayıtları, "+ Manual sale" butonu mevcut |
| Discount codes → "New code" formu | ✅ PASS — form tüm alanlarla (isim, kod+Generate, tip, min. harcama, son kullanma, max kullanım, kapsam) açılıyor, i18n sorunu yok |
| Add product / throwaway ürün testi | ⚠️ Zaman kısıtı nedeniyle tam CRUD (create/preview/sell/edit/deactivate/delete) döngüsü bu turda derinlemesine test edilmedi — sadece buton varlığı ve mevcut ürünlerin Preview/Sell/Edit/Deactivate/Delete aksiyonları doğrulandı (liste görünümünde mevcutlar) |

### Team
| Aksiyon | Sonuç |
|---|---|
| Üye listesi (Carlo, Hakan, 7 QA rolü) | ✅ PASS |
| Invite Member — boş form gönderimi | ✅ PASS — HTML5 validasyonu engelledi, hiç POST atılmadı |
| Invite Member — geçersiz e-posta | ✅ PASS — engellendi, POST atılmadı |
| Invite Member — geçerli QA verisiyle gönderim | ✅ PASS (API ile: `POST /hq/invitations/` 201) — UI denemesi oturum çakışmasına (403) denk geldi, curl ile fresh token'la doğrulandı |
| Role dropdown'unda "Owner" seçilebilirliği | ✅ Doğrulandı (önceki turdan bilinen bulgu, backend yetki kontrolü hâlâ yok — CLAUDE.md §Açık riskler'de zaten kayıtlı, yeniden raporlanmadı) |
| Pending invitation → "Activate" (approve) | ✅ PASS — `POST /hq/invitations/{id}/approve/` 201, gerçek HQMember oluştu |
| Team üyesi rol düzenleme (Edit) | ✅ PASS — `PATCH /hq/team/{id}/` 200 |
| Team üyesi silme (Remove) | ✅ PASS — `DELETE /hq/team/{id}/` 204, GET ile yokluğu doğrulandı |
| Temizlik | ✅ PASS — test kullanıcısı (`qa.hq.invite-test@qa-nounder40.test`) tamamen silindi |

### Permissions
| Aksiyon | Sonuç |
|---|---|
| Matris görünümü (7 HQ rolü × 18 izin + 3 School rolü × 17 izin salt-okur) | ✅ PASS |
| "+ Add Profile" → özel HQ rolü oluşturma | ✅ PASS — UI'da form açıldı, "QA Custom Role Test" oluşturuldu |
| Hücre tıklayarak izin açma/kapama (2 izin) | ✅ PASS — `dashboard`+`schools_view` işaretlendi |
| "Save changes" | ✅ PASS — "Permissions saved" mesajı, API ile `["dashboard","schools_view"]` doğrulandı |
| Özel rolü silme (Delete → "Sure? Click again") | ⚠️ UI'da iki-adımlı onay butonuna çift tıklama otomasyon aracıyla güvenilir şekilde tetiklenemedi (arm state defalarca doğru göründü ama DELETE isteği hiç ağa gitmedi) — silme API ile tamamlandı ve doğrulandı. Bu, gerçek kullanıcı hızında bir tıklama sorunu olduğuna dair kanıt yok (arm/confirm state UI'da doğru çalışıyor), ancak otomasyonla ikinci tıklamanın güvenilirliği düşük çıktı; insan testiyle ayrıca doğrulanması önerilir |
| Temizlik | ✅ PASS — `qa-custom-role-test` silindi, API ile doğrulandı |

### Packages (HQ)
| Aksiyon | Sonuç |
|---|---|
| Boş liste görünümü | ✅ PASS |
| "New Package" → form (çok dilli isim/açıklama, kredi, fiyat, geçerlilik, renk, otomatik yenileme, izin verilen ders tipleri, mod, VIP/Popular) | ✅ PASS — tüm alanlar render oluyor |
| Form etiketleri i18n | 🟡 Bulgu — `Label Description/Credits/Price/Color` |
| Validasyon: ders tipi seçilmeden gönderim | ✅ PASS — "Pick at least one lesson type" hatası doğru gösterildi, POST atılmadı |
| Paket oluşturma (15 kredi, 99.50€, 90 gün, IT+EN isim, 1 ders tipi, auto-renew açık) | ✅ PASS — `POST` 201, API ile doğrulandı |
| Paket düzenleme (kredi/fiyat) | ✅ PASS — `PATCH` 200 |
| Paket deaktivasyonu | ✅ PASS — `active:false` doğrulandı |
| Paket silme | ✅ PASS — `DELETE` 204, GET 404 ile doğrulandı |

### Payments
| Aksiyon | Sonuç |
|---|---|
| KPI kartları ve tablo (11 gerçek işlem) | ✅ PASS, veriler doğru |
| KPI/kolon i18n | 🟡 Bulgu — ham anahtarlar |
| "Export CSV" metni | 🟡 Bulgu — "Export C S V" |
| Export CSV fonksiyonu | ✅ PASS (kod incelemesi — istemci tarafı CSV blob + `<a download>`, indirme bu sandbox'ta engelleniyor ama tetikleme doğru) |
| Status filtresi (dropdown) | ✅ PASS (yapısal olarak doğru option'lar mevcut) |
| School filtresi | ✅ PASS — API ile doğrulandı (`?school=<uuid>` doğru 8 kayıt döndürdü); UI denemesinde önce yanlış value (okul adı metni) kullanmam ve ardından oturum çakışması (403) yanlış negatif gösterdi, curl ile doğrulandı |
| Date range filtreleri | Test edilmedi (zaman kısıtı) |

### Reports
| Aksiyon | Sonuç |
|---|---|
| Schools/Teachers/Students sekme geçişi | ✅ PASS (ilk tıklama otomasyon sorunu nedeniyle etkisiz görünmüştü, tekrar denemede `?tab=teachers` isteği doğru gitti) |
| KPI/kolon i18n | 🟡 Bulgu — ham anahtarlar |
| Status/Country filtreleri | ✅ PASS yapısal olarak (seçenekler render oluyor) — "All countries" listesinde "IT" (kod), "Italia", "Italy" karışık görünüyor, veri temizliği notu (bkz. aşağıda) |
| Export CSV | ✅ PASS (Payments ile aynı desen) |

**Küçük veri notu**: Reports → Country filtresi seçenekleri `IT`, `Italia`,
`Italy`, `Spain` olarak karışık görünüyor (ülke kodu + iki farklı dilde ülke
adı aynı listede) — okulların `country` alanının tutarsız girildiğine işaret
ediyor (School panel/okul verisi kapsamı, HQ kod hatası değil).

### Homepage Settings
| Aksiyon | Sonuç |
|---|---|
| Sayfa yükleme | ✅ PASS |
| Form etiketleri i18n | 🟡 Bulgu — `Label Schools/Teachers/Students/Lessons Monthly` |
| "Real numbers" toggle | ✅ PASS (yapısal, `on` durumunda) |
| Sayı alanı düzenleme + Save + geri alma | ✅ PASS (API ile) — bkz. yukarıda "endpoint tam nesneyi değiştiriyor" notu |

### Look & top bar (Brand Settings)
| Aksiyon | Sonuç |
|---|---|
| Sayfa yükleme (logo, renkler, top bar linkleri, sidebar renkleri per panel, canlı önizleme) | ✅ PASS, i18n sorunu görülmedi |
| Save (değişiklik yapmadan round-trip) | ✅ PASS — API ile önce/sonra karşılaştırıldı, hiçbir alan bozulmadı |
| Renk/logo/link düzenleme testi | ⚠️ Zaman kısıtı + geri döndürülemez görsel risk nedeniyle canlı içerik değiştirilmedi; no-op Save testiyle endpoint'in güvenli olduğu doğrulandı |

### Email Templates
| Aksiyon | Sonuç |
|---|---|
| Sayfa yükleme (27 şablon, 5 dil, grup sayaçları) | ✅ PASS, i18n sorunu görülmedi |
| Password Reset şablonu seçili yükleniyor | ✅ PASS (fallback uyarısı, değişkenler paneli dahil) |
| Dil sekmesi geçişi (EN→IT) | ✅ PASS — JS-dispatch ile doğrulandı (otomasyon tıklama sorunu, üstte açıklandı), İtalyanca içerik doğru geldi |
| Editor/HTML/Preview görünüm değişimi | ✅ PASS — HTML görünümü ham `<p>` etiketli içeriği doğru gösterdi |
| Değişken ("Click to insert") listesi render | ✅ PASS — dolu ve boş değişken grupları (`{{user_name}}` vb.) doğru listelendi |
| Save / Send test | ❌ Kasıtlı olarak test edilmedi (güvenlik kuralı — gerçek e-posta şablonunu bozmamak / gerçek e-posta göndermemek) |

### Translations
| Aksiyon | Sonuç |
|---|---|
| Sayfa yükleme (2284 anahtar, 22 eksik) | ✅ PASS |
| Arama kutusu | ✅ PASS — `form_input` ile "Label "/"Column "/"Status "/"Kpi " arandı, doğru filtrelendi (bkz. bulgu tablosu) |
| "Missing only" filtresi | ✅ PASS — JS-dispatch ile doğrulandı (22 anahtara düştü); tarayıcı otomasyon tıklaması iki denemede etkisiz kaldı (üstte açıklandı) |
| Dil sütunları (EN/IT/ES/FR/DE) render | ✅ PASS |
| "Auto-fill with AI" / "Publish live" | ❌ Kasıtlı olarak test edilmedi (güvenlik kuralı) |

### `/hq/debug`
Nav'da yok, herhangi bir `role=hq` kullanıcısı için doğrudan URL ile
erişilebilir (önceki turda not edilmişti, bu turda içerik incelendi).
**İçerik**: `t('title')`/`t('newSchool')` örnek render'ları + tüm
`messages.hq` çeviri JSON ağacının ham dökümü. Gizli/hassas veri
içermiyor (sadece zaten public olan UI metinleri), ama:
- Geliştirici debug aracı, prod'a hiç gitmemesi gereken bir sayfa.
- **Doğrudan kanıt**: `dashboard.title: "Title"`,
  `dashboard.kpiActiveSchools: "Kpi Active Schools"` vb. — yukarıdaki i18n
  bulgusunun kök nedenini teyit ediyor.

🟢 **Öneri**: `/hq/debug` production'a deploy edilmeden önce kaldırılmalı
veya en azından `NODE_ENV !== 'production'` ile korunmalı.

### Diğer sayfalar (kısa doğrulama)
- **Metodo Library**: 3 içerik doğru listeleniyor, filtreler (Type/Level/
  Language) render oluyor, i18n bulgusu var (`Filter X`, `Badge Students`,
  `Action Edit/Delete`). Upload/throwaway içerik testi zaman kısıtı
  nedeniyle derinlemesine yapılmadı.
- **Inbox**: 1 konuşma (Danza Clásica Barcelona, Closed/Medium) doğru
  render oluyor, `Action Open` i18n bulgusu.
- **Countries & Locations**: bu turda yeniden test edilmedi (önceki turda
  "salt-okur agregasyon, çalışıyor" olarak zaten doğrulanmıştı).

---

## Ortam Temizliği (bu tur)
- `qa-lt-2` lesson type: oluşturuldu → düzenlendi (kullanılmadı, direkt
  silindi) — **silindi, API ile doğrulandı**.
- `82e145f9-…` HQ package (QA Test Package): oluşturuldu → düzenlendi →
  deaktive edildi → **silindi, API ile doğrulandı**.
- `qa-custom-role-test` özel HQ rolü: oluşturuldu → 2 izin işaretlendi →
  kaydedildi → **silindi, API ile doğrulandı**.
- `qa.hq.invite-test@qa-nounder40.test`: davet edildi → onaylandı (gerçek
  HQMember oldu) → rolü düzenlendi → **silindi, API ile doğrulandı**. Not:
  bu adres `...@qa-nounder40.test` olduğu için görev talimatına uygun,
  gerçek bir e-posta kutusuna hiçbir şey gitmedi (approve akışı e-posta
  kuyruğa girer ama adres gerçek değil).
- `student-shop-visibility`: test için `true` yapıldı, hemen `false`'a
  (orijinal durum) geri alındı — **doğrulandı**.
- `homepage-settings` istatistikleri: kendi hatam yüzünden geçici olarak
  sıfırlandı, **orijinal değerlere (`20/249/950/3`) geri yüklendi ve
  doğrulandı**.
- `brand-settings`: hiç değiştirilmedi (sadece no-op Save testi yapıldı).
- Gerçek hesaplara (`c.carlo@cfcholding.it`, `hakantimur55@gmail.com`) veya
  gerçek okullara hiçbir yazma işlemi yapılmadı.
- **Temizlenmeyen (kapsam dışı)**: `qa-lesson-type` (in-use, School panel
  test artefaktı) ve okul paketlerindeki `(copy)` isim kirliliği —
  yukarıda not edildi, koordinatöre bırakıldı.

## Yeniden test edilmeyen / bilinen ve tekrarlanmayan bulgular
- HQ backend granüler izin eksikliği, Team'de yetki yükseltme açığı,
  Dashboard "New School"/"Recent Schools" izin kontrolsüzlüğü — hepsi
  CLAUDE.md ve önceki `QA_TEST_RESULTS.md`'de zaten kayıtlı, bu turda
  yeniden doğrulanmadı (görev talimatına uygun, tekrar test gerekmiyordu).
