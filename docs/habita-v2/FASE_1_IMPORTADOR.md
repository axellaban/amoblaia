# Habita V2 — Fase 1: importador de propiedades por URL

**Estado:** implementado y verificado offline; **QA desde la IP de Vercel pendiente** (ver §6). No cerrar la fase hasta completar §6.

## 1. Qué cambió

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Transporte seguro | [`src/lib/listings/fetch.ts`](../../src/lib/listings/fetch.ts) | `safeFetch`: http/https en 80/443, sin credenciales en la URL, nombres locales rechazados. El socket resuelve el host con un *lookup* propio que rechaza rangos privados/locales/link-local/metadata y **conecta a la IP verificada** (sin segunda resolución → cierra DNS rebinding). Redirects manuales re-verificados (máx. 4), tope de tamaño **después de descomprimir** (gzip/deflate/br), deadline total, errores tipados (`blocked`, `challenge`, `timeout`, `too_large`…). |
| Charset | [`src/lib/listings/charset.ts`](../../src/lib/listings/charset.ts) | Header → BOM → `<meta charset>` → UTF-8 estricto → windows-1252. Acepta `utf8` sin guion (Berasueta). |
| Render provider | [`src/lib/listings/render.ts`](../../src/lib/listings/render.ts) | Interfaz `RenderProvider` + `SCRAPER_PROVIDER`. **Sin adaptador activo** hasta aprobar proveedor. Se usa solo ante 403/503, challenge, timeout o página vacía armada por JS, y solo con URLs que pasaron `checkUrl`. |
| Detección + extractores | [`src/lib/listings/platforms.ts`](../../src/lib/listings/platforms.ts) | Detección por señales combinadas (CDN, forma de URL, marcas, datos embebidos), nunca solo por hostname. Extractores: Tokko, Tokko vía API, Next.js + Tokko, Inmobiliatica, Wasi, Tecnogestión, WordPress/Houzez/Elementor, Next.js RSC (payload parseado como datos, nunca ejecutado) y genérico (H1 + galerías JSON en scripts). |
| JSON-LD | [`src/lib/listings/structured.ts`](../../src/lib/listings/structured.ts) | schema.org `RealEstateListing`/`Product`/`Accommodation`: nombre, dirección, ambientes, dormitorios, baños, superficie, oferta+moneda, vendedor. |
| Fusión | [`src/lib/listings/analyze.ts`](../../src/lib/listings/analyze.ts) | Plantilla > JSON-LD > lectura genérica. Lo menos específico **solo rellena faltantes**; las diferencias de precio/ubicación quedan en `diagnostics.conflicts`. |
| Contrato | [`src/lib/demos/import.ts`](../../src/lib/demos/import.ts), [`listing.ts`](../../src/lib/demos/listing.ts) | `ImportedDemo` suma `diagnostics` (opcional, compatible). Preview, snapshot, overrides, 409 por cambio, idempotencia por `key` y duplicados **sin cambios**. Ambas rutas (`/api/panel/importar`, `/api/admin/demos/importar`) usan la misma capa. |
| UI | [`src/components/demo-import.tsx`](../../src/components/demo-import.tsx) | La vista previa muestra «Leído de *Plataforma* · estrategia · N fotos · s · falta: …» con detalle desplegable. «Consultar precio» se muestra como tal. |
| Analítica | [`src/lib/listings/events.ts`](../../src/lib/listings/events.ts) | `listing_import_preview_{started,completed,failed}`, `listing_import_{confirmed,completed,partial,failed}` con `platform`, `strategy`, `missing_fields`, `price_status`, `photos_found`, `duration_ms`, `error_code`. Solo el host, nunca la URL cruda. |
| QA en preview | [`src/app/api/qa/importador/route.ts`](../../src/app/api/qa/importador/route.ts) | Apagado en producción y sin `IMPORTER_QA_TOKEN`; solo lee las 16 URLs de la lista de QA por índice; no guarda nada. |

## 2. Tabla antes / después (fixtures obtenidos el 01/11/2026, lectura offline)

«Antes» = importador de `main` @ `af25d01` sobre el mismo HTML. Fotos = fotos únicas útiles devueltas.

| URL (fixture) | Plataforma | Título antes → después | Ubicación antes → después | Precio antes → después | Facts antes → después | Fotos antes → después |
| --- | --- | --- | --- | --- | --- | --- |
| tokko-tormes | Tokko | = «Departamento en Plaza Mitre» | — → Bolivar al 2600, Plaza Mitre | USD 47.000 = | 6 → 6 | 37 → 37 HD |
| tokko-mendiondo | Tokko (rounded) | «Claudia Mendiondo Propiedades :: Semipiso…» → «Semipiso 4 ambientes en dúplex…» | — → Córdoba al 3200, Chauvin | **— → USD 189.000** | 0 → 6 | 60 → 60 HD |
| tokko-galan | Tokko | = | — → Saavedra al 1800, Los Troncos, Mar Del Plata | **— → USD 720.000** | 8 → 8 | 62 → 62 HD |
| tokko-bibbo | Tokko | = | — → Mexico al 1400, Sarmiento, Mar Del Plata | **— → USD 49.900** | 7 → 7 | 56 (con duplicados w_pics) → 34 originales |
| inmobiliatica-acampora | Inmobiliatica | «… en La Perla, Mar del Plata» → «Departamento en La Perla» | — → Av. Libertad 3301, La Perla, Mar del Plata | **USD 84.900 (de otra propiedad) → USD 143.640** | 4 → 4 | 30 (mezcla medium/originales) → 14 originales |
| inmobiliatica-damianfernandez | Inmobiliatica | ídem | — → Moreno 2855, Plaza Mitre, Mar del Plata | USD 72.000 = | 6 → 6 | 30 → 22 |
| inmobiliatica-businessmanager | Inmobiliatica | ídem | — → Pasaje Mar del Plata 500, Las Avenidas, Mar del Plata | USD 55.000 = | 5 → 6 | 30 → 29 |
| inmobiliatica-homesland | Inmobiliatica | ídem | — → Av.Luro 2368, Centro, Mar del Plata | **$ 75.000 (de otra propiedad) → $ 210.000** | 6 → 6 | 28 → 12 |
| tokkoapi-sanzyordoqui | Tokko API (Cloudflare) | «Venta- Departamento…» → «Departamento cuatro ambientes con dependencia» | = Santiago del estero 2329, Mar del Plata | USD 119.900 = | 6 → 6 | 30 → 27 originales |
| nextsanity-goicoechea | Next.js + Tokko | «… \| Corrientes 3130 \| Goicoechea…» → «Departamento en Chauvin» | — → Corrientes 3130, Chauvin | USD 155.000 = | 6 → 6 | 25 (con otras propiedades) → 15 |
| nextrsc-dar | Next.js RSC | = | — → Santa Fe 1800 | **— → USD 55.000** | 0 → 3 | 11 → 9 |
| wasi-piglia | Wasi | «Venta local» → «Local en Mar del Plata» | — → Mar del Plata, Buenos Aires | USD 500.000 = | 0 → 2 | 7 (logos, miniaturas) → 4 originales |
| tecnogestion-ordonez | Tecnogestión | «… en Venta. Mar Del Plata, General…» → «Departamento Semipiso en Mar Del Plata» | — → Colon 900, Mar Del Plata | USD 399.000 = | 0 → 5 | 29 → 28 |
| houzez-grande | WP + Houzez | MAYÚSCULAS → «Casa de 4 ambientes con escritorio, garaje y patio» | dirección geocodificada larga → General Roca 2619, San José, Mar del Plata | **$ 200.000 (moneda errónea) → USD 200.000** | 0 → 4 | 15 → 12 |
| elementor-scagliola | WP + Elementor | «Santa Fe 1624» → «Departamento en Centro» | — → Santa Fe 1624, Centro | **— → USD 57.900** | 4 → 4 | 2 (íconos) → 15 fotos |
| php-berasueta | PHP propio | «… Propiedad 920.» → «Departamento en Venta de 1 ambiente en Mar del Plata» | = | USD 58.000 = | 1 → 1 | 8 (miniaturas) → 6 originales |

**Operación**: antes faltaba en 5 casos (Mendiondo, DAR, Tecnogestión, Houzez, Elementor); después solo falta en DAR, que no la publica.
Caso especial `paulaecharte.com` (fichas en modal JS sin URL propia): no hay URL que importar; el mensaje para páginas vacías indica cargar fotos a mano o usar el enlace del portal.

## 3. Evidencia de tests

| Comando | Resultado |
| --- | --- |
| `npm test` | **821/821** (baseline 778 + 43 nuevos), 84 archivos |
| `npm run lint` | OK |
| `npm run typecheck` | OK |
| `npm run build` | OK |

Tests nuevos: [`tests/listing-platforms.test.ts`](../../tests/listing-platforms.test.ts) (16 fixtures + casos de precio en similares, w_pics, `::`, «$» declarado USD, Wasi base64, detección sin hostname, payload RSC inerte, «Consultar precio», conflictos, títulos), [`tests/listing-fetch.test.ts`](../../tests/listing-fetch.test.ts) (IP privada, metadata, IPv6 loopback, `localhost`/`.local`, puerto, credenciales, redirect a IP privada y a nombre local, bucle de redirects, **DNS rebinding**, 403 vs challenge vs 404, timeout, gzip bomb, charset) y [`tests/listing-read.test.ts`](../../tests/listing-read.test.ts) (estrategias, bloqueo sin proveedor, proveedor configurado, no públicas nunca al proveedor, endpoint QA cerrado).

## 4. Diagnóstico del bloqueo histórico (403)

Desde el entorno de desarrollo de esta fase (no Vercel) las 16 URLs respondieron **200**, tanto con el User-Agent anterior como con el nuevo (ver `tests/fixtures/listings/manifest.json`: Inmobiliatica y Sanz y Ordoqui están detrás de Cloudflare). Por lo tanto el 403 histórico no depende del User-Agent: apunta a la reputación de las IP de Vercel. **No se afirma que esté resuelto** hasta medir desde el preview.

## 5. Decisión pendiente: proveedor de render

Solo hace falta si el preview confirma 403/challenge. Opciones a evaluar entonces (costo por página y términos): ScrapingBee, Browserless, Zyte, Firecrawl. Alternativa sin costo: IP de salida fija (Vercel Static IPs o proxy propio) — también requiere aprobación. Mientras tanto el importador responde con un error accionable (portal o carga manual), nunca con un éxito falso.

## 6. QA desde Vercel — bloqueado por acceso

El preview se construye en la cuenta Vercel `labans-projects-c5c64fdc`, que no está conectada a esta sesión. Para completar la tabla desde la IP de Vercel:

1. En Vercel → proyecto `amoblaia` → Settings → Environment Variables: crear `IMPORTER_QA_TOKEN` (valor aleatorio de 32+ caracteres), entorno **Preview**, rama `claude/friendly-shannon-54k8z1`. Redeploy del preview.
2. Ejecutar para `i` de 0 a 15 (orden alfabético del manifest):
   `curl -H "x-qa-token: $TOKEN" "https://<preview>/api/qa/importador?i=0"`
   (si el preview tiene Vercel Authentication, agregar el bypass o compartir el enlace).
3. Pegar los resultados: completo la tabla «preview» y, si hay 403, la propuesta de proveedor.

## 7. Deudas / pendientes de esta fase (no implementados)

- Adaptador de render provider (requiere aprobación).
- Extractores de Argenprop/Zonaprop: detectados, pero sin extractor propio ni fixture (no se verificaron sus términos de acceso); hoy usan la lectura genérica.
- El navegador sigue descargando las fotos vía `/api/admin/demos/[id]/photos` con el nuevo transporte; no hay reintento con proveedor para fotos bloqueadas.
- Dashboard PostHog del importador: los eventos existen; el insight se arma en Fase 6.
