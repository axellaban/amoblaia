# HABITA V2 — PROMPT MAESTRO PARA CLAUDE CODE

**Estado:** especificación consolidada de producto y ejecución por fases.  
**Fecha de referencia:** 1 de noviembre de 2026.  
**Proyecto:** Habita (repositorio `axellaban/amoblaia`, Next.js / Vercel / Supabase / PostHog).  
**Objetivo:** transformar las demos personalizadas enviadas por WhatsApp en el punto de entrada a un panel de trabajo real de la inmobiliaria, con activación, uso autónomo y suscripción; evolucionar lo existente sin perder funcionalidades y sin sacrificar la experiencia mobile.

> **INSTRUCCIÓN PRIORITARIA Y NO NEGOCIABLE**  
> El repositorio actual es el punto de partida **técnico**, no la especificación final de la interfaz. La referencia funcional y visual final es **lo consensuado en este documento**. Reutilizá componentes, rutas, datos y lógica existentes siempre que sirvan, pero **cambiá la interfaz y los flujos que sean necesarios** hasta cumplir todos los criterios de aceptación. Ni una conservación acrítica del diseño actual ni una reescritura desde cero son aceptables. No declares completado un cambio solo porque existe código que se parece: verificá su resultado observable en desktop y mobile.  
> No mezcles implementación de todos los módulos en una única rama/commit gigante; dividí en PRs o commits verificables y desplegables. **No merges a `main` sin el OK explícito del usuario.**

**Referencias visuales incluidas en el paquete ZIP complementario:** `visual_references/final-panel-desktop.png` (referencia final para panel), `visual_references/demo-desktop-and-mobile-design.png`, `visual_references/demo-mobile-and-listing-details.png` y `visual_references/future-feature-page-example.png`; las capturas `visual_references/current-mobile-demo-*` muestran el estado actual. Si el contenido literal de una imagen difiere de una decisión posterior, **prevalece este texto**, especialmente la ausencia de badges «Próximamente» en sidebar, solo tres tarjetas grandes en inicio, y «Guardar panel» contextual.

## 0. Protocolo de trabajo para Claude Code

1. Antes de cambiar código, **inspeccioná el estado REAL de la rama actual**, dependencias, README, tests, migraciones, rutas, analítica y despliegue, y resumí brevemente qué existe, qué falta, qué se reutiliza y qué debe evolucionar. No asumás que el estado del repo coincide con el análisis histórico siguiente.
2. Creá rama de trabajo separada de `main` (o varias ramas secuenciales, según convenga) e incorporá esta especificación como `docs/HABITA_V2_SPEC.md` para que sea la fuente de verdad. Si el usuario entrega mockups, capturas o assets, incorporalos como referencia visual bajo `docs/ux/habita-v2/` con su aprobación; no inventes que el repo los contiene.
3. Presentá un plan conciso de hitos con archivos previstos, cambios de base de datos, riesgos, dependencias y criterios de aceptación. **Ejecutá por fases**; cuando una decisión de arquitectura, costo o servicio externo implique una obligación económica importante, presentá opciones y pedí aprobación antes de adquirirlo.
4. Conservá compatibilidad con demos enviadas, enlaces cortos, modo comprador, paneles reclamados, propiedades, créditos, roles, pagos, Miguel Ángel, generación y descargas existentes. Migraciones **aditivas** y reversibles cuando sea posible; no borres datos ni cambies permisos sin revisión.
5. Trabajá con configuración por ambiente y feature flags para módulos de lanzamiento gradual. No muestres CTA que simule una funcionalidad que no existe: si `Video` no está listo para producción, mantenelo fuera de exposición pública hasta poder activarlo de verdad.
6. Cada fase termina con `npm test`, `npm run lint`, `npm run typecheck` y `npm run build` (confirmá comandos en `package.json`), pruebas de seguridad/roles y QA manual mobile/desktop. No dejes errores silenciosos. Si no podés ejecutar un paso (por falta de credenciales, sesión, proveedor o permisos), reportá evidencia y el bloqueo; jamás marques aprobado sin verificar.
7. Hacé commits pequeños y descriptivos, push a branch y preview en Vercel (si las credenciales permiten). Validá en el preview con datos de prueba; no publiques ni merges a producción sin aprobación.
8. No recolectes datos personales innecesarios ni registres secretos, URLs con invitaciones, credenciales, prompts privados o contenido de formularios en analytics/logs.

## 1. Referencia de código que DEBÉS auditar (hallazgos de una lectura anterior, volver a comprobar)

- `src/components/agency-panel.tsx`: centraliza `AgencyPanel`, `PanelNav`, vista de inicio, navegación, importación de propiedades, imágenes, créditos, sitio y usuarios. En el estado consultado, la navegación de panel tenía secciones `inicio`, `propiedades`, `creditos`, `sitio` y `usuarios`, y una home con «Crear demostraciones» e «Importar imágenes». **Evolucionarla**, no construir una segunda aplicación.
- `src/components/demo-view.tsx`: demo comercial/ficha, slider, versiones de imágenes, CTA, contenido de publicación. Preservar interacciones y datos; reorganizar para nuevo diseño mobile-first.
- `src/components/demo-editor.tsx`: herramientas existentes de edición y gestión de propiedad. Reutilizar componentes de generación, descarga y retoque.
- `src/app/demo/[token]/public-demo.tsx` y rutas `src/app/demo/[token]/...`, `src/app/p/[link]/[[...rest]]/page.tsx`: distinguen presentación comercial, vista del comprador, precios y enlaces cortos. No romper URLs ya enviadas.
- `src/lib/agency/demo-invite.ts`, `src/lib/agency/invitation.ts`, `src/app/api/panel/reclamar/route.ts`, `src/app/panel/empezar/page.tsx`: invitaciones y claim existente. Riesgo: código de un solo uso dentro de ciertos enlaces que pueden reenviarse; una ruta existente `acceptWithNewAccount` crea usuarios con `email_confirm: true` a partir de la posesión de la invitación. **Auditar y endurecer** antes de ampliar la difusión. No asumir que la posesión de la URL equivale a representar a la inmobiliaria.
- `src/lib/demos/listing.ts`, `src/lib/demos/listing-details.ts`, `src/lib/demos/import.ts`, `src/lib/agency/import-flow.ts`: importación compartida, preview con campos/estado, importación idempotente y fotos. Preservar `assertPublic`, límites, preview/editabilidad, idempotencia y manejo de duplicados.
- `src/app/api/admin/demos/importar/route.ts` y `src/app/api/panel/importar/route.ts`: ambos deben adoptar mejoras del importador a través de una capa común.
- `src/lib/analytics.ts`, `src/lib/interaction-tracking.ts`, `src/lib/leads/client.ts`: PostHog, eventos de CTA y Lead Engagement Score existente. Reutilizar contratos y evitar doble tracking.
- `src/app/panel/layout.tsx`: existe Miguel Ángel (asistente) en panel para usuarios autenticados. Preservar y, donde sea apropiado, incorporar ayuda contextual sin superponer UI intrusiva.
- `supabase/migrations`: revisar versiones realmente aplicadas y preparar nuevas migraciones sin modificar las ya desplegadas.

## 2. DEFINICIÓN FINAL DEL PRODUCTO — reglas de UX

### 2.1 Panel principal de inmobiliaria — escritorio (diseño consensuado)

**Referencia visual:** el diseño verde oscuro, blanco y crema de Habita acordado. Layout con barra lateral izquierda verde oscuro, logo HABITA, encabezado/área de bienvenida, **tres CTA de tamaño grande en el área principal**, lista «Tus propiedades», campo/importador para crear una propiedad y accesos útiles. Diseño sobrio, moderno, limpio, espacio generoso; no saturar de funciones.

En el cuerpo principal mostrar **EXACTAMENTE estas tres categorías principales, como tarjetas grandes**:

1. **Crear demostraciones** — crear fichas interactivas de una propiedad a partir de URL o fotos, usando el flujo que ya existe. Acción funcional, no decorativa.
2. **Estudio de imágenes** — acceder al editor/importador existente y funcionalidades para ambientar, mejorar, quitar muebles, cambiar cielo cuando aplique y descargar.
3. **Video** — acceder al nuevo flujo real de creación de videos, definido en la sección 6. Sección activa cuando esté implementada; no «próximamente» como estado final.

**Barra lateral izquierda** (navegación primaria persistente en desktop y drawer accesible en mobile):

- Inicio
- Mis propiedades
- Crear demostraciones (si la arquitectura navegación/atajos lo permite; la tarjeta de inicio sigue siendo protagonista)
- Estudio de imágenes
- Video
- **Sitio web** (reutilizar sección existente «Mi sitio web» y sus permisos)
- **Tour 360**
- **Plano** (o «Planos» si la consistencia de la interfaz exige plural; una sola denominación global)
- **Redes**
- **API**
- Precios / Planes / Créditos (coherente con los flujos reales)
- Ayuda / contacto / usuarios o administración donde el rol lo permita.

**MUY IMPORTANTE sobre Tour 360, Plano, Redes y API:**

- Solo están en la **barra lateral**, **no aparecen como tarjetas ni CTA en la home**.
- **No** colocar etiqueta «Próximamente» ni apariencia deshabilitada en los elementos de la barra lateral: se ven como opciones naturales de navegación, clicables, con hover/foco y estado activo.
- Al hacer clic, **no** simular que la herramienta ya está disponible. Abrir una página interna distinta, limpia, con ilustración coherente con Habita, título de la solución, explicación concreta de su futuro beneficio, mensaje claro **«Próximamente»**, y CTA **«Me interesa» / «Avisame cuando esté disponible»**.
- Si la persona está autenticada, registrar interés por agencia y usuario sin pedirle de nuevo su email; ofrecer confirmación reversible y opt-in para recibir aviso. Si es visitante no autenticado y esta pantalla se hace accesible, ofrecer email opt-in y verificación sin crear una cuenta administrativa ni atribuirse una inmobiliaria.
- Medir *por separado* apertura de la sección e interés explícito, además de los visitantes únicos (ver sección 8). No introducir banners promocionales de estas cuatro features en la home.
- Reutilizar un componente común de «próximamente», con ilustración, descripción y tracking diferenciado por `feature_key` (`tour_360`, `planos`, `redes`, `api`). No crear lógica repetida.

**Precios siempre accesibles** tanto desde la demo como desde el panel. No exigir registro para ver precios. Conservar propiedades existentes y sus capacidades de administración, créditos, roles, configuración y sitio web.

### 2.2 Panel principal — mobile

- Es un **requisito de primera clase**, no una adaptación al final: aproximadamente el 50% de las inmobiliarias entra por mobile (dato de investigación del proyecto, no inferir que aplica a otros usuarios).
- Header compacto HABITA + nombre/contexto de inmobiliaria + navegación en menú/drawer; los tres CTA principales legibles y táctiles, en columna o grilla sin miniaturizar sus etiquetas.
- CTA de registro/guardar únicamente si se trata de **demo temporal no reclamada**; un usuario autenticado con panel propio no debería ver «Guardar mi panel».
- Mis propiedades y crear nueva propiedad accesibles sin scroll excesivo; no mostrar la lista de features «próximamente» en la pantalla principal.
- Accesibilidad: targets táctiles >=44px, contraste, foco, keyboard, sin acciones accesibles solo por hover.

### 2.3 Demo enviada por WhatsApp — el usuario ya está «dentro de su panel»

**Decisión final:** conservar el concepto mental de **panel personalizado precargado** desde el primer clic. No enviar a landing intermedia ni pedir registro para mirar. La demo debe mostrar nombre de inmobiliaria, una propiedad REAL precargada y una barra superior **MUCHO más simple** que la actual, sin perder la sensación de entorno propio.

Header de la demo (mobile): contexto inmobiliaria + «Demo para inmobiliaria» compacto + acceso «Guardar mi panel» cuando corresponda + acceso a «Precios»; posibilidad de navegar a propiedades/estudio según permisos y estado del visitante, sin mostrar navegación administrativa voluminosa arriba de la imagen. Evitar que las herramientas administrativas desplacen la foto principal por debajo del primer viewport. Separar navegación de visitantes temporales de panel autenticado sin romper la ilusión de continuidad.

La demo debe abrir **directamente en la propiedad con comparación antes/después**, no en una landing de bienvenida. Prioridad visual:

1. Nombre de la propiedad, ubicación y contexto inmobiliaria con buena jerarquía. CTA discreto **«Ver como comprador»**.
2. Imagen principal grande con **slider táctil antes/después**, etiquetas claras y fotos originales preservadas. **No romper** comportamiento actual del slider.
3. **Tira horizontal de thumbnails** de la galería (otras fotos/habitaciones), seleccionable y scrollable. Primera foto y original visibles de modo confiable.
4. **ÚNICA sección «Estilos»**, compacta. Estilos ya generados con miniaturas/nombres, opción para seleccionarlos, **lápiz «Editar»** y opción **«Crear video»** para esa imagen. Estilos no generados: CTA **«Generar»** en lugar de mostrar funcionalidades inexistentes.
5. **En mobile**, no esconder el lápiz y video detrás de un menú de tres puntos. Se pueden presentar como acciones contextuales al seleccionar un estilo, con íconos y texto explicativo, conservando 44px de target y sin duplicar tarjetas gigantes. La cámara sola es ambigua: usar etiqueta «Video IA», «Crear video» o ícono con tooltip/ayuda inicial. **Si el video ya existe**, mostrar «Ver en movimiento» / «Ver video» con icono de reproducir. Nunca insinuar que un video existe si no está generado.
6. Al tocar «Editar», abrir un editor contextual simple y no permanente; acciones iniciales: «Mejorar foto», «Quitar muebles», «Cambiar cielo» (solo fotos donde aplica), y «Amueblar» cuando corresponda; reutilizar motor existente.
7. Acciones de valor claras **«Descargar imágenes»** (con información verídica de cantidad gratuita disponible, si aplica) y **«Compartir ficha»**. No bloquear las descargas prometidas con registro ni poner múltiples botones de descarga duplicados por todas partes.
8. CTA suave después de esas acciones **«¿Querés probarlo con otra propiedad?»** con campo para pegar URL y «Crear propiedad»; conectar con flujo de registro contextual al preservar/importar la segunda propiedad.
9. **Debajo debe mantenerse la ficha inmobiliaria completa**, no una pantalla vacía: título, precio (si existe), operación, características, metros, ambientes, descripción, datos de inmobiliaria, galería pertinente, mapa/ubicación y contacto. Usar exclusivamente datos publicados/verificados; marcar explícitamente «Consultar precio» cuando aplique; no inventar campos. Evitar duplicar en una segunda grilla permanente las mismas fotos que ya se navegaron arriba; resolver como galería expandible/área contextual.
10. «Ver como comprador»: vista limpia para potencial comprador, sin botones de gestión, costos, edición, créditos, generación ni registro; conservar imagen, comparación si encaja y contacto destacado. La inmobiliaria debe poder volver al modo demo sin perder contexto. Conservar las rutas existentes y el enlace público de comprador.

Debe seguir funcionando en desktop, incluidos slider, versiones, estilos, contacto, mapas y atributos del inmueble. No reducir la demo a «solo un editor»: sigue siendo una ficha inmobiliaria interactiva, compartible y útil para compradores.

### 2.4 Demo pública, propiedad compartida, claim y equipo

**Reenvíos por WhatsApp son deliberadamente permitidos**: varias personas de una inmobiliaria (agente, martillero, marketing) pueden explorar la misma demo sin cuenta y sin crear propietarios múltiples.

- **URL de demo:** estable, pública/compartible, con alcance de lectura + acciones promocionales explícitamente limitadas. No concede administración ni pertenencia a una agencia.
- **Reclamo/activación:** ruta y token independientes, con verificación de identidad/email y autorización para representar esa inmobiliaria (aprobación del contacto comercial o administrador existente, dominio corporativo cuando corresponda y sea suficiente; no confiar solo en dominio ni solo en URL). La primera persona que llega por un enlace reenviado **no** se transforma automáticamente en `owner`.
- **Muy importante:** auditar `acceptWithNewAccount`, que previamente usaba `email_confirm: true` por posesión del link. Corregir para que no marque la dirección como verificada sin prueba válida; si existe un camino legal de invitaciones previamente verificadas, documentar condiciones de confianza y restringirlo adecuadamente.
- **Invitaciones existentes y enlaces cortos:** no quebrarlos. Proponer migración segura y compatibilidad. Considerar que los enlaces con códigos en path pueden quedar en historial, compartir previews y referrers; evitar secretos en analytics y canonical/OG, aplicar `Referrer-Policy` y controles adecuados. Para enlaces antiguos con claim embebido, impedir apropiación no autorizada sin generar indisponibilidad innecesaria.
- **Usuarios adicionales:** un miembro puede solicitar unirse a panel reclamado, pero requiere aprobación y permisos. Roles actuales prevalecen; revisar permisos en servidor en TODAS las rutas de escritura, incluidos trabajos de video, imports y contenido privado.
- **Continuidad:** después de registro, abrir la misma propiedad ya precargada y preservar imágenes/estados; funcionar si se abre el email en otro navegador (considerar código OTP y asociación de contexto segura, sin usar un token de claim transferible como única credencial).
- **Miguel Ángel:** mantenerlo disponible para asistir en la demo/panel donde esté permitido, sin mostrarlo de forma invasiva en vista comprador ni conceder operaciones de gestión sin sesión/permiso.

### 2.5 Registro y freemium — exactamente dónde aparece

**Sin cuenta:** abrir demo, ver slider, estilos ya preparados, ver videos ya generados, ver precios, compartir la demo/ficha, **descargar el material gratuito explícitamente prometido (p. ej. seis imágenes si corresponde)** y probar **una edición o generación limitada** si el presupuesto y controles antifraude lo permiten. El beneficio gratuito debe ser real, no un mockup.

**Registro/activación contextual:** (a) «Guardar mi panel»; (b) importar/crear/conservar **segunda propiedad**, pudiendo pegar primero la URL; (c) continuar generando después de consumir la prueba o créditos gratuitos. No exigir registro para ver precios ni para usar un slider o ver un video preparado.

No consumir créditos sin confirmación y explicación; distinguir prueba gratuita, crédito por imagen, crédito por clip IA, y video montaje. Si se abre la demo desde WhatsApp y otro dispositivo registra el panel, evitar perder el contexto.

**Señal de activación más importante:** la inmobiliaria crea **segunda propiedad** autónomamente, no simplemente toca «Guardar panel». Monetizar cuando ya entiende la utilidad, sin impedir que compre anticipadamente si desea.

## 3. IMPORTADOR DE PROPIEDADES POR URL — mejora estructural completa (PRIORIDAD CRÍTICA)

**Motivo:** si fallan las URLs de clientes en el onboarding de Habita, no funciona el funnel hacia la segunda propiedad. No solucionar con parches puntuales a quince dominios; construir arquitectura mantenible y verificable.

### 3.1 Diagnóstico ya disponible — hipótesis y mediciones a reconfirmar

Muestra histórica de top 50 inmobiliarias de Mar del Plata probada contra producción:

- **24/50 Tokko Broker:** 20 con plantilla `/p/ID-slug`, fotos en `static.tokkobroker.com`; 4 con web propia integrada a API Tokko.
- **17/50 Inmobiliatica**, rutas tipo `/tipo-operacion-zona_ID_propiedad-inmobiliaria.html`, imágenes en `imagenes.inmobiliaticaweb.com`. Todas devolvían HTTP 403 al fetch de producción; Sanz y Ordoqui (Cloudflare) también daba 403.
- Otros: Wasi (`image.wasi.co`), Tecnogestión (`cdn.tecnogestion.com.ar`), WordPress Houzez, WordPress Elementor, PHP propio, Next.js RSC (`self.__next_f`), Next.js + Sanity + Tokko.
- `fetchPublic` usaba UA `Mozilla/5.0 (compatible; amoblaIA-demos/1.0; +https://amoblaia.vercel.app)` y cabeceras escasas, lo que puede contribuir a bloqueos; las IP de Vercel también pueden influir. **No asumir que cambiar el User-Agent resolverá Cloudflare**.
- Tokko: ubicación ausente en casos con barrio/calle en H1/slug, precio ausente en 5/7 observados (distinguir falta real de «Consultar precio»), títulos con prefijo de marca separado por `::` (p.ej. Claudia Mendiondo).
- DAR Next RSC: precio y descripción cortos incompletos. Wasi, Tecnogestión y Houzez: `facts: 0` en muestra. Elementor: timeout. Modal con contenido JS sin URL propia en algunas webs.

### 3.2 Diseño de arquitectura del fetch

Conservar la semántica de `assertPublic`, validaciones SSRF, límites, tiempos, redirect count y descarga acotada. Mejorar, no reducir restricciones.

**Estrategias escalonadas configurables**:

1. `direct_http`: GET controlado del servidor, cabeceras compatibles con clientes web (UA razonable, `Accept`, `Accept-Language: es-AR`, cabeceras de navegación **solo si técnicamente coherentes**; no falsificar estados imposibles ni dar por demostrado que ayudan). Seguir redirect manual, validar DNS/IP en cada salto, prohibir redes privadas, loopback, link-local, puertos no admitidos y hosts internos. Considerar DNS rebinding: no basta con resolver antes del `fetch` si el transporte vuelve a resolver; usar cliente seguro o egress/proxy con política equivalente y probarlo.
2. `render_provider`: si hay 403/503, challenge detectable, HTML sin contenido útil generado por JS o timeout, admitir proveedor configurable mediante interfaz (`SCRAPER_PROVIDER`, credenciales secretas, límites y timeout). Evaluar ScrapingBee / Browserless / Zyte / Firecrawl y seleccionar **uno** documentado para primer adaptador. **Usarlo solo sobre sitios a los que exista autorización para acceder y dentro de términos aplicables; nunca implementar evasión de CAPTCHA, login, paywall o salvaguardas.** Si no hay llave o acceso permitido, informar diagnóstico y alternativa manual/URL de portal; no inventar que se resolvió el 403.
3. `fallback`: manual de fotos/datos o URL alternativa Argenprop/Zonaprop según acceso autorizado, sin provocar pérdida de progreso.

Mismo enfoque para imágenes y resolución de originales HD, con validaciones de Content-Type/bytes, prevención de redirecciones privadas, deduplicación, resolución y fuente. Diferenciar host de página y host de CDN. No pasar URLs arbitrarias a un proveedor externo sin validar el destino y las condiciones de uso. Controlar costos y cuota del proveedor; retry/backoff con límite, no ciclos infinitos.

Decodificación robusta de HTML por charset del `Content-Type` y `<meta charset>` con fallback razonable; no asumir siempre UTF-8. Normalizar textos con caracteres españoles sin destruir datos. HTML muy grande debe abortar antes del límite. Evitar ejecutar scripts de terceros en la aplicación principal.

**Diagnóstico en preview**, sin secretos: estrategia usada, proveedor (si corresponde), plataforma detectada, señal de challenge, duración, número de fotos encontradas/descargables, errores y campos faltantes. Mantener el contrato actual de preview (campos, overrides, snapshot, duplicados, idempotencia, validación 409) y versionarlo de forma compatible.

### 3.3 Detección de plataforma y extractores

Crear registro de extractores que produzcan un shape común compatible con `ListingDetails`, `toDemo`/`ImportedDemo` y la UI existente. Detección por combinación de host, patrones de URL, HTML/JSON-LD/metadata y firmas estructurales, no por hostname hardcodeado solamente.

Plataformas soportadas:

- **Tokko**: plantilla habitual y «web propia + API Tokko»; nombre de inmueble, título, barrio/ubicación H1/slug, precios reales / «Consultar», imágenes en calidad correcta, características.
- **Inmobiliatica**: HTML/render autorizado, fotos originales HD y facts.
- **Wasi**, **Tecnogestión**, **WordPress + Houzez**.
- **Next.js RSC / `self.__next_f`** (leer payload como datos inertes, evitar ejecutar contenido remoto); **Next.js + Sanity + Tokko**.
- **WordPress Elementor** y **PHP propio** cubiertos por extractores/fallback y casos de prueba.
- **Argenprop** y **Zonaprop** como orígenes alternativos **si sus condiciones y el acceso autorizado lo permiten**; si no, fallback documentado y mensaje, no prometer cobertura inexistente.
- **Genérico actual** como complemento: JSON-LD, OpenGraph, H1, galería, heurísticas. Debe rellenar **solo campos faltantes** y registrar conflictos en lugar de sobrescribir datos confiables.

Priorizar precio/publicación verificable, moneda, operación, ubicación, título limpio, descripción completa, facts (m2, ambientes, dormitorios, baños), datos de contacto, fotos originales sin thumbnails repetidos ni logos. `trimTitle` contempla separador `::` sin destruir títulos legítimos. Precio ausente se distingue de «Consultar precio» y de error de extracción. No fabricar ubicación ni precio a partir de supuestos dudosos: incluir provenance/confidence por campo o notas de diagnóstico.

### 3.4 URLs REALES obligatorias de QA

**Tokko**

- https://www.tormespropiedades.com/p/8634397-Departamento-en-Venta-en-Plaza-Mitre-Bolivar-al-2600
- https://www.claudiamendiondo.com.ar/p/12446118-Departamento-en-Venta-en-chauvin-cordoba-al-3200
- https://www.galanbroker.com/p/7795735-Casa-en-Venta-en-Los-Troncos-Saavedra-al-1800
- https://www.bibbopropiedades.com/p/8059687-Departamento-en-Venta-en-Sarmiento-Mexico-al-1400

**Inmobiliatica**

- https://www.acamporayasoc.com/departamento-venta-la-perla_372287_propiedad-inmobiliaria.html
- https://www.damianfernandez.com.ar/departamento-venta-plaza-mitre_466409_propiedad-inmobiliaria.html
- https://www.businessmanager.com.ar/casa---chalet-venta-las-avenidas_471638_propiedad-inmobiliaria.html
- https://www.homes-land.com.ar/departamento-alquiler-por-dia-centro_475297_propiedad-inmobiliaria.html

**Tokko API / Cloudflare**

- https://www.sanzyordoqui.com.ar/propiedad/venta-departamento-cuatro-ambientes-con-dependencia-santiago-del-estero-2329--13217780

**Next + Sanity**

- https://goicoecheapropiedades.com/propiedades/departamento-venta-chauvin-2-ambientes-4762187

**Next RSC**

- https://www.darpropiedades.com.ar/propiedad/256bfb64-7bce-49d1-a653-e2d04ab00e96

**Wasi**

- https://pigliainmuebles.com.ar/local-venta-mar-del-plata/8116994

**Tecnogestión**

- http://www.xn--alejandraordoez-brb.com.ar/inmueble/departamento-semipiso-venta-4-ambientes-mar-del-plata-general-pueyrredon-costa-atlantica-lp837844

**WP Houzez**

- https://grandepropiedades.com/property/casa-de-4-ambientes-con-escritorio-garaje-y-patio/

**WP Elementor**

- https://www.emmanuelscagliola.com/propiedad/santa-fe-1624/

**PHP propio**

- https://www.inmobiliariaberasueta.com/ventas/propiedad/920/

Caso especial: `paulaecharte.com` usa datos Tokko vía modal JS sin URL pública individual en algunas publicaciones; dar mensaje y fallback apropiado.

### 3.5 Tests y despliegue del importador

- Obtener HTML/JSON de esas fichas **desde ambiente local autorizado**, guardarlo como fixtures bajo `tests/fixtures/listings/`; si un sitio no permite lectura o hay 403, dejar fixture marcado «no obtenido» y evidencia del bloqueo, **nunca falsificar HTML o declarar cobertura sin fixture**. Para cada extractor tests Vitest offline de título, ubicación, precio, descripción, facts, agencia, imágenes únicas HD, errores y conflictos.
- Tests unitarios de charset, redirects, 403/503/timeout, provider ausente, límites, SSRF (IP privada en redirect, hostname local, DNS rebinding), payloads Next RSC seguros, 409 idempotencia, foto bloqueada y preview parcial.
- Deploy PREVIEW en Vercel y correr desde ese entorno (la IP importa) las URLs, respetando acceso/terms y presupuesto. Tabla **antes vs. después** por URL: resultado, estrategia, plataforma, título, ubicación, precio, facts y número de fotos válidas. No presentar cobertura basada solo en `localhost`.
- Criterio: mejora estructural verificable para Tokko y casos accesibles, diagnóstico correcto para los bloqueados, **sin regresión ni vulneración SSRF**. No definir «100% de cobertura» ficticio.

## 4. ONBOARDING Y CONVERSIÓN — transición demo → panel

### Flujos finales

1. **WhatsApp prospección:** mensaje corto basado en valor, solicitar interés en ver una propiedad propia mejorada.
2. **Demo enviada tras interés:** abre propiedad ya preparada y entorno temporal personalizado; el enlace se puede reenviar al equipo.
3. **Primera acción de valor:** descargar, editar una imagen de prueba o compartir ficha; precio transparente.
4. **Guardar panel:** pedir registro/claim contextual, con verificación y autorización. Conservar la propiedad original y todo el material, evitar empezar de cero.
5. **Crear segunda propiedad:** la señal de uso autónomo. Importación por URL fluida desde mobile, datos precompletados/preview editables y fotos de buena calidad.
6. **Continuidad:** generación de contenido con créditos, suscripción accesible sin conversación obligatoria con ventas.
7. **Equipo:** invitar o solicitar autorización para colaboradores sin asumir que cada visita equivale a un empleado o a una inmobiliaria diferente.

### Textos / pasos orientativos de contacto comercial

- Mensaje inicial: «Vi propiedades de ustedes. ¿Te puedo compartir cómo quedaría una con fotos mejoradas por IA?».
- Respuesta positiva → demo: «Te preparé una propiedad real; podés comparar, probar estilos y descargar las imágenes ya listas. También tenés un panel preparado».
- Abrió sin acción → ayuda con la descarga y explicación simple.
- Descargó o editó → invitar a guardar panel y crear otra propiedad.
- Guardó panel sin segunda propiedad → asistencia para pegar la URL y completar el primer uso autónomo.
- Segunda propiedad creada sin pago → consultar volumen/obstáculo real y facilitar planes, no bombardear con insistencia.
- Sin respuesta → una o pocas comunicaciones pertinentes, respetando consentimiento, preferencias, opt-out y políticas aplicables de WhatsApp; **no implementar envío automático masivo no autorizado**.

En la app, crear ayudas contextuales (onboarding corto, ejemplos, pasos accionables) y mantener el asistente Miguel Ángel cuando sea útil; evitar pasos forzosos adicionales o tours interminables.

## 5. PANEL: features futuras y captura de interés (con medición REAL)

- Rutas dedicadas y legibles, por ejemplo `/panel/tour-360`, `/panel/planos`, `/panel/redes`, `/panel/api` (confirmar naming de rutas del repo; mantener compatibilidad).
- Sidebar habilitada, sin «Próximamente» en la navegación. Cada destino presenta ilustración original, título, descripción del caso de uso, indicación clara «Próximamente», CTA medible de interés y confirmación/registro para recibir aviso.
- El evento `future_feature_nav_clicked` se registra **al elegir opción**, incluso si el usuario no deja email, con `feature_key`, `agency_id` si autenticado, `role`, `source_surface`, `device_type` (si disponible), `is_internal` y `session_id` según sistema actual. También registrar `future_feature_page_viewed` como control de carga de destino y `future_feature_interest_submitted` solo ante opt-in exitoso. Controles de deduplicación: se pueden contar clics totales, pero el KPI principal es **inmobiliarias únicas interesadas / inmobiliarias únicas expuestas**, sin confundir personas con organizaciones.
- Consentimiento separable para aviso por email/WhatsApp; no deducir consentimiento de hacer clic.
- No solicitar un «registro de cuenta» adicional al ya autenticado; para no autenticado recopilar email con consentimiento, sin convertirlo en owner. Posibilidad de cancelar notificaciones.
- Agregar consultas/reportes PostHog por feature y dispositivo. Si es posible, tabla `feature_interest` idempotente por `agency_id`, `feature_key`, usuario y tipo de opt-in; respetar RLS.

## 6. VIDEO — dos modalidades, una infraestructura; benchmarking REA y posterior implementación

**El CTA «Video» es uno de los 3 principales del panel.** Debe terminar funcional en desktop/mobile. Distinción conceptual:  
**(A) Video de imagen:** animar una versión original o ambientada con movimiento cinematográfico de ~5–8 segundos, desde la foto/estilo; **(B) Video de propiedad:** armar video comercial con varias fotos, desde la sección Video del panel y una propiedad existente.

### 6.1 Primero investigar con REA, con evidencia

Referencia REA: https://github.com/morluto/rea, guía `docs/browser-observation.md`; referencias producto:
- https://app.pedra.ai/es
- https://app.betterspace.ai/create
- https://pedra.ai/es
- https://betterspace.ai/ai-real-estate-video

- Verificar instalación/compatibilidad de REA, configurar de forma oficial vía `npx rea-agents setup` si corresponde **con aprobación**. El uso de REA no debe impedir avanzar con la especificación si una sesión externa está bloqueada.
- Investigar solo páginas públicas o sesiones a las que el usuario esté autorizado; documentar flujo real desde selección de propiedad, fotos, orden, movimiento, presets, formato, música, locución, logo, créditos, render, descarga y mobile. Capturas y Evidence REA donde sea posible. No inferir llamadas backend privadas si no hay evidencia; no eludir login, CAPTCHA, protecciones ni copiar código propietario.
- Distinguir claramente **observación directa**, **documentación pública**, **hipótesis** y **no verificado**. Entregable `docs/video/COMPETITOR_RESEARCH.md` con fuentes y comparación Pedra/BetterSpace, riesgos y decisiones propias de Habita.

### 6.2 UX final de video Habita

Entrada «Video» muestra selector de propiedad existente o importar URL; sugerencia automática de fotos y orden; selección/eliminación/reordenamiento fácil y vista previa de storyboard sin timeline complejo.

**Tres presets**:
1. **Clásico:** fotos con transiciones y textos, sin animaciones IA, bajo costo.
2. **Equilibrado:** animar las 2 mejores fotos, combinar con el resto en transiciones.
3. **Cinematográfico:** animar todas las fotos seleccionadas, costoso y opt-in consciente.

Formatos **9:16** y **16:9**; marca/logo/contacto de la inmobiliaria y datos reales del inmueble; presets de música con licencias adecuadas cuando el motor lo permita. Sin alucinar metraje, características, vistas o elementos que no existen. Las imágenes IA requieren señalización según los términos del producto y buenas prácticas.

CTA «Generar video» con resumen y **costo de créditos antes de confirmar**; estados queued, processing, completed, failed (+ cancelled solo si soportado), barra de avance realista, email/notificación si permitido, histórico en la propiedad, preview, descargar MP4, compartir, regenerar con nuevo cargo explicitado. Resguardar música/licencias. Mobile: edición en pasos simples, no editor timeline.

«Crear video» desde lápiz/cámara contextual de foto usa el **mismo job store/proveedor** pero video individual, con vista previa solo cuando realmente exista. El botón contextual cambia a «Ver en movimiento» al completar, no antes.

### 6.3 Arquitectura de video

- Evaluar proveedores generativos disponibles actualmente y costos por clip, calidad de movimiento, consistencia del inmueble, latencia, soporte de formatos, cancelación, APIs, términos, cuota, regiones y confiabilidad; **no hardcodear vendor**. Diseñar `VideoProvider`/adapter intercambiable y un `VideoCompositionService` para montaje de escenas. No inventar API/modelos ni precios sin verificar.
- Rendering largo **asíncrono**, mediante cola/workers/cron robusto y webhooks firmados o polling autenticado; no depender de una request Vercel abierta durante el render. Jobs idempotentes, claves privadas servidor, backoff controlado, estados persistidos, reanudación ante fallas, creación vinculada a agency_id/property_id/photo_version_id/actor, permisos RLS y server-side checks.
- Persistir MP4/thumbnail/metadata y configuraciones en storage de Habita; URLs firmadas cuando aplique, no reutilizar enlaces públicos inseguros.
- Crédito de montaje vs. crédito por clip generativo; reserva/consumo/rollback atómico, costo visible antes de generar, cuotas antiabuso por agencia, reintentos seguros y devolución en falla técnica. Preservar sistema existente de créditos.
- Tests de permisos, cobro duplicado, jobs fallidos, procesamiento reintentado, proveedor sin llave, fotos con orientación diversa y reproducción/descarga iPhone Safari.
- Lanzamiento incremental: primero video Clásico e infraestructura, luego una animación de imagen y Equilibrado, después Cinematográfico; la experiencia final incluye los tres presets, aunque cada tramo se habilite solo cuando funcione.

## 7. OTRAS MEJORAS DE EXPERIENCIA Y CONTENIDO

- El «Estudio de imágenes» debe ofrecer acceso claro a importación por URL, subida, mejora, quitar muebles, cielo y ambientación, usando capacidades reales existentes; herramientas aún no disponibles deben quedar ocultas hasta implementarse, salvo las cuatro páginas de interés explícitamente acordadas.
- El sitio web de la inmobiliaria está en la **barra lateral**, no ocupa la home principal; aprovechar sección actual y permisos de administración sin duplicar lógica.
- El header de demo debe conservar sensación de panel personalizado y ofrecer Precios/Guardar panel sin dominar el primer viewport.
- Diferenciar foto original, versión ambientada, edición y video. Nunca reemplazar irreversiblemente original; permitir comparar y descargar.
- Mantener ficha del comprador clara, con atributos y contacto. Los datos importados de sitios deben permitir edición/corrección por la inmobiliaria, especialmente precio/ubicación.
- Incluir estados de carga, vacío, error accionable y éxito, tanto para URLs como para generación y reclamación de panel.

## 8. POSTHOG — taxonomía y funnel por inmobiliaria

Reutilizar `track`, `cta`, `leadEvent`, `registerSuperProperties` y backend existente; normalizar nombres y asegurar `agency_id`, `demo_id`, `property_id`, `visitor_id` cuando proceda, `source`, `device_type`, `is_internal`, `is_demo`, `role` y deduplicación/anonimización adecuada. Jamás incluir tokens secretos, códigos de invitación, URLs privadas, emails sin base legal, ni contenido de fotos/formularios en eventos.

**Funnel de adquisición y activación**:

`prospect_contacted` → `prospect_interested` → `demo_sent` → `demo_external_viewed` → `demo_value_action` (subtipos descarga/edición/generación/compartir) → `panel_claim_started` → `panel_claim_completed` → `second_property_import_started` → `second_property_created` → `plan_viewed` → `checkout_started` → `subscription_activated`.

Reglas: contar empresas/inmobiliarias únicas por etapa y período/cohorte; distinguir visitas, personas, dispositivos, demos e inmobiliarias; eliminar tráfico interno; registrar origen de campaña/WhatsApp y fuente de la demo sin registrar mensajes privados. «Guardó panel» **no** es adopción; segunda propiedad creada y retornos sí. Para «acción de valor», no contar un simple tap de estilo sin resultado; clasificar exposición vs. operación lograda. En registro abierto desde otra app/navegador, transferir atribución por método seguro. Mantener Lead Engagement Score actual, agregar señales organizacionales de multi-visitante con cautela: múltiples dispositivos no son personas confirmadas, ni reenviar significa que el lead ya decidió comprar.

**Features futuras**: `future_feature_nav_clicked`, `future_feature_page_viewed`, `future_feature_interest_submitted` con `feature_key`, deduplicación y funnel por organización.

**Video**: `video_section_viewed`, `video_property_selected`, `video_photos_selected`, `video_mode_selected`, `video_format_selected`, `video_generate_clicked`, `video_registration_required`, `video_generation_started`, `video_generation_completed`, `video_generation_failed`, `video_preview_played`, `video_downloaded`, `video_shared`; `mode`, `format`, `photo_count`, `animated_photo_count`, `credits_quoted`, `credits_charged`, `duration_ms`, `provider` cuando aplique. Medir éxito de creación y costo efectivo, no solo clics.

**Importador**: `listing_import_preview_started`, `listing_import_preview_completed`, `listing_import_preview_failed`, `listing_import_confirmed`, `listing_import_completed`, `listing_import_partial`, `listing_import_failed` con plataforma, estrategia, errores normalizados, falta de datos, fuente y duración. Excluir URL cruda y los datos sensibles.

Crear insights/dashboard de PostHog por fecha, canal, demo, dispositivo, inmobiliaria y cohortes, y definir consultas reproducibles de caída de etapa. Evitar duplicación entre PostHog/Lead Score/DB. Si se usa backend para eventos de negocio críticos, emitirlos desde una transición de estado confiable, idempotente y validada, no solo desde clicks frontend.

**Benchmarks de planificación, NO datos observados ni garantías**: escenario más probable si se ejecuta bien ~1,2% contactadas→pagas; objetivo desafío ~2%. En un lote de 250 contactadas, hipótesis exigente: 35 demos enviadas → 28 visitadas → 21 acciones de valor → 13 paneles activados → 9 segundas propiedades → 5 suscripciones. NO grabar esta expectativa como dato real ni presentarla como predicción estadística. Históricos previos de prospección incluyen 605 prospectadas, 206 contactadas, 24 demos enviadas, 11 abiertas, 6 interacciones clave, 2 clics en crear inmobiliaria, 1 inicio de registro, 0 pagos confirmados; son datos de cohortes/mediciones distintas que deben **revalidarse** antes de usarse como baseline.

## 9. FASES DE EJECUCIÓN Y CRITERIOS DE ACEPTACIÓN (OBLIGATORIO)

### Fase 0 — Auditoría, especificación y baseline (sin cambios destructivos)

- Identificar rama, SHA, dependencias, migraciones desplegadas, flujos existentes, screenshots mobile y rutas.
- Escribir mapa «existente / reutilizar / modificar / añadir» y registrar baseline de tests.
- Diagramar estados de demo pública / invitación / panel reclamado / vista comprador / permisos.
- Definir contratos de eventos y feature flags para evitar instrumentación tardía.
- Entregar lista de riesgos (principalmente claim y SSRF), plan de migraciones y estimación de esfuerzo por fase.

**Aceptación:** especificación trazable a componentes/rutas reales; tests basales documentados; capturas de antes en desktop/mobile. No alterar producción.

### Fase 1 — Importador estructural (bloqueador de activación)

- Capa de fetch segura multiestrategia, adaptador configurable, charset, diagnósticos.
- Extractores por plataforma, fallback genérico, fotos HD, datos completos, preview y errores accionables.
- Fixtures y Vitest offline, QA contra URLs desde preview Vercel, tabla antes/después.

**Aceptación:** importación de segunda propiedad confiable para plataformas accesibles, sin regresión y con fallbacks claros para bloqueadas; seguridad SSRF, límites y duplicados verificados.

### Fase 2 — Dashboard Habita V2, sitio y features futuras

- Sidebar desktop/mobile, **solo tres tarjetas grandes en home**, «Sitio web» en sidebar.
- Tour 360 / Plano / Redes / API clicables en sidebar sin etiqueta «próximamente», páginas informativas con ilustración, CTA de interés y tracking; Precios accesible.
- Mis propiedades y acciones existentes no pierden acceso.

**Aceptación:** reproducciones visuales razonablemente fieles al mockup aprobado; cuatro rutas futuras medibles, visibles en sidebar, invisibles como cards en home; responsive y roles correctos.

### Fase 3 — Demo mobile-first y vista comprador

- Header compacto en entorno de panel precargado; slider antes/después, thumbnails, estilos compactos, editor contextual, descarga/compartir, crear otra propiedad, ficha completa debajo.
- Pencil y video discoverables en mobile, sin saturar; modo comprador limpio.
- Compartibilidad intacta y enlaces existentes retrocompatibles.

**Aceptación:** llegar a imagen principal sin fricción, acciones de edición/video entendibles en mobile, no CTA falso, información completa de propiedad y ruta comprador sin herramientas de admin. Capturas y pruebas iOS/desktop.

### Fase 4 — Claim seguro, equipo y conversión a segunda propiedad

- Separar enlace público de demo y credencial de reclamar; verificar email y autorización, preservar invitaciones vigentes mediante estrategia de migración.
- Registro en «Guardar panel», en creación/conservación de segunda propiedad y al agotar prueba; no forzar registro en lectura/descarga gratuita/precios.
- Mantener contenido y contexto, acceso colaborador con aprobación.
- Instrumentar conversiones de negocio confiables y test de reenvíos.

**Aceptación:** reenviar demo no permite tomar posesión; el contacto autorizado guarda panel y encuentra la propiedad con su material; puede importar una segunda sin apoyo del equipo.

### Fase 5 — Video v1 y posteriores dentro del alcance pactado

- Benchmark REA con evidencia y límites, plan económico/proveedor.
- Infraestructura de jobs, storage, créditos, video Clásico, clip individual, Equilibrado, Cinematográfico, selector de fotos, formatos, logo, preview, MP4, mobile y tests.
- Ordenar internamente en PRs/subfases (`5A` benchmark/diseño; `5B` montage/infra; `5C` clip+equilibrado; `5D` cinematográfico), activar cada modo solo cuando esté verificado.

**Aceptación:** tres modos realmente utilizables al cierre completo de la fase 5, sin jobs colgados, errores silenciosos ni doble cobro; video individual se puede reproducir desde demo si existe.

### Fase 6 — Analítica, growth, onboarding y QA transversal

- Tableros de funnels PostHog por canal, dispositivo, demo e inmobiliaria, importador/video, clicks de interés futuro y lead score.
- Ayuda contextual para crear segunda propiedad sin asistencia. Miguel Ángel contextual sin invadir experiencia.
- Documentar secuencias de WhatsApp condicionales por conducta y cumplimiento de preferencias; NO programar outreach indiscriminado.
- Regression + seguridad + accesibilidad + QA mobile Safari + desktop Chrome + staging Vercel.

**Aceptación:** eventos coherentes y deduplicados, funnel reproducible, cada feature futura medible, costos/errores visibles y cero regresiones críticas.

### Dependencias de lanzamiento

- La Fase 1 es bloqueo para escalar activación por segunda propiedad.
- La Fase 4 es bloqueo para publicar masivamente el nuevo `Guardar mi panel` con enlaces reenviables.
- El nuevo CTA «Video» al público solo se habilita cuando Fase 5 correspondiente esté operativa y con costo/quota.
- Analítica mínima de cada módulo debe desarrollarse **en la misma fase**, aunque el dashboard consolidado llegue al final.

## 10. QA Y ENTREGABLES FINALES

En cada PR/fase entregar:

1. Resumen en español de qué cambió, enlaces a archivos principales y decisiones de diseño.
2. Capturas **antes/después** para desktop (~1440px) y mobile (iPhone ~390px) de: home panel, demo comercial, ficha comprador, registro/claim, listado propiedades, nueva importación, Video, página futura.
3. Matriz «requisito → implementación → evidencia (captura/test) → estado», con **todas** las decisiones de este documento; no cerrar fase que deje requisito sin clasificar.
4. Reporte de tests/lint/typecheck/build, resultados reales y advertencias; repro del QA manual.
5. Link a branch y deploy preview Vercel si disponible; **no mergear a `main` sin mi OK**.
6. Para importador: tabla detallada URL por URL, estrategia/directo/render, plataforma, antes/después, cantidad fotos útiles, precio, ubicación, descripción/facts, resultado y evidencia.
7. Para video: proveedor seleccionado, costo estimado/real por modo, tiempo de render, job state, crédito, resultado MP4 probado en desktop/mobile; fallos reproducibles.
8. Para seguridad: tests de visitante reenviado intentando reclamar panel, cuenta con email no verificado, colaborador no autorizado, usuario de otra agencia, doble consumo de créditos, redirect SSRF / DNS rebinding.
9. Breve listado de deudas técnicas o decisiones pendientes **sin calificarlas como implementadas**.

## 11. CRITERIOS DE ACEPTACIÓN GLOBAL (checklist obligatoria)

- [ ] El resultado visual final **es la evolución consensuada de Habita**, no el diseño viejo sin cambios ni una app completamente distinta.
- [ ] Panel desktop/mobile con 3 tarjetas grandes: **Crear demostraciones, Estudio de imágenes, Video**.
- [ ] «Sitio web» en barra izquierda con funcionalidad existente.
- [ ] «Tour 360», «Plano», «Redes», «API» en barra izquierda, clicables, **sin etiqueta Próximamente allí** y **sin tarjetas en home**.
- [ ] Cada página futura tiene ilustración, «Próximamente», CTA de interés usable y eventos PostHog.
- [ ] Demo abre directo en propiedad dentro de un entorno temporal personalizado, sin registro inicial.
- [ ] Header demo más simple, logo/nombre, precios, guardar panel sin desplazar foto principal.
- [ ] Slider antes/después y galería de thumbnails funcionan en mobile.
- [ ] Estilos compactos; lápiz + acción video claramente descubiertos; «Ver video» solo si existe.
- [ ] Editar foto contextual con las acciones disponibles y estado verdadero; estilos no generados ofrecen «Generar».
- [ ] Descarga gratuita prometida y compartir ficha sin registro innecesario.
- [ ] CTA «Crear otra propiedad» debajo del contenido de valor y conectado al importador robusto.
- [ ] Ficha completa real debajo (precio, datos, descripción, mapa, contacto), sin imágenes duplicadas inútilmente.
- [ ] Modo comprador separado de herramientas administrativas.
- [ ] Demo compartible sin permisos administrativos; claim y email/autoridad verificados; se preservan invitaciones con transición segura.
- [ ] Registro contextual; panel reclamado preserva la demo; segunda propiedad autónoma medible.
- [ ] Precio accesible y suscripción funcional bajo reglas comerciales existentes.
- [ ] Importador multiestrategia con SSRF intacto, charset, plataformas, fixtures offline, preview y QA Vercel real.
- [ ] Video de imagen y video de propiedad: Clásico, Equilibrado y Cinematográfico, 9:16/16:9, branding, MP4, créditos y jobs confiables.
- [ ] PostHog trazabilidad sin datos sensibles, por inmobiliaria y etapa; leads internos excluidos.
- [ ] Mobile-first, accesibilidad, pruebas y screenshots con evidencia; sin regressions y sin merge no aprobado.

## 12. AL INICIAR ESTA EJECUCIÓN

Respondé primero con:

1. **Mapa del estado actual**: qué componentes reutilizarás y cuáles evolucionarás, con rutas concretas del repo.
2. **Plan de fases y branch/PRs**, con dependencias y riesgos prioritarios.
3. **Lista corta de decisiones que efectivamente requieren aprobación** (ej. proveedor pago de scraping/video, cambio que afecte invites actuales). No hagas preguntas que ya están contestadas por esta especificación.
4. Iniciá **Fase 0 y Fase 1** dentro de los permisos disponibles, documentando resultados. Continuá por fases; nunca afirmes que ejecutaste pruebas, despliegues o investigación autenticada sin evidencia.

**Recordatorio:** no optimizamos por cantidad de funcionalidades visibles. Optimizar por comprensión, valor experimentado, activación de panel, segunda propiedad autónoma y suscripción, con una experiencia digna y simple en mobile.
