# Habita V2 — Fase 3: demo mobile-first y vista comprador

**Estado:** implementado; tests, lint, typecheck y build OK. Pendiente para cerrar: recorrido en el preview con una demo real en iPhone/Safari y desktop (ver §5). El video por foto queda para la Fase 5 (ver §3).

## 1. Qué cambió (modo dueño = la demo que llega por WhatsApp con invitación)

| Pieza | Archivo |
| --- | --- |
| Header compacto (inmobiliaria · «Demo para inmobiliaria» · Precios · Guardar mi panel · menú) | `OwnerHeader` en [`src/components/demo-view.tsx`](../../src/components/demo-view.tsx) |
| Propiedad primero + «Ver como comprador» discreto | encabezado de `DemoView` |
| Sección única «Estilos» con tarjetas, lápiz «Editar» y «Generar» | `ownerPanel` en `Gallery` |
| Editor contextual: Mejorar foto (real), Amueblar (estilos), Cambiar cielo / Quitar objetos (en el panel) | `retouchPanel` |
| «Descargar imágenes» (cantidad real, gratis) y «Compartir ficha» (link público de compradores) | `OwnerValue` |
| «¿Querés probarlo con otra propiedad?» → registro con la URL guardada para el panel | `AnotherProperty` + `PENDING_IMPORT_KEY` ([`demo-invite.ts`](../../src/lib/agency/demo-invite.ts)) y `ImportProperty` |
| Pestañas de la ficha (Sobre la propiedad · Galería · Ubicación · Contactar) | `dv2-tabs` |
| Vista comprador sin herramientas ni registro, con «Volver al modo demo» | prop `backToDemo` ([`public-demo.tsx`](../../src/app/demo/[token]/public-demo.tsx)) |
| **Bug corregido:** el link corto `/p/…` mostraba el header de habita encima de la demo | `isDemoPage` en [`shell.tsx`](../../src/components/shell.tsx) |

## 2. Matriz requisito → implementación → evidencia

| Requisito (spec §2.3) | Implementación | Evidencia | Estado |
| --- | --- | --- | --- |
| Abre directo en la propiedad, sin landing ni registro | sin cambios de ruta; la propiedad es lo primero | `demo-owner-mobile-viewport.jpg` | ✅ |
| Header MUCHO más simple, sin navegación administrativa voluminosa | 1 línea de 60 px; secciones en el menú | `before-after-demo-mobile.jpg` | ✅ |
| Precios y «Guardar mi panel» accesibles | ambos en el header y en el menú | captura, test | ✅ |
| 1. Nombre, ubicación y contexto con jerarquía; «Ver como comprador» discreto | encabezado + botón contorneado | captura | ✅ |
| 2. Imagen principal con slider antes/después; comportamiento del slider intacto | `Comparison` sin cambios | captura, tests existentes | ✅ |
| La foto principal no queda debajo del primer viewport | en 390×844 el slider y las miniaturas entran completos | `demo-owner-mobile-viewport.jpg` | ✅ |
| 3. Tira horizontal de miniaturas scrolleable | sin cambios | captura | ✅ |
| 4. ÚNICA sección «Estilos», compacta; generados seleccionables con lápiz; no generados con «Generar» | tarjetas; 4 visibles + «Ver todos» | `demo-owner-mobile-styles.jpg`, test | ✅ |
| 5. Lápiz y video visibles en mobile, sin menú de tres puntos, 44 px | lápiz en cada tarjeta y «Editar foto» rotulado (44 px) | captura | ✅ lápiz · ⏸ video (Fase 5) |
| «Ver en movimiento» solo si el video existe; nunca insinuarlo | no se muestra ninguna acción de video (no hay videos todavía) | test `not.toMatch(/Ver en movimiento|Crear video|Video IA/)` | ✅ |
| 6. Editor contextual simple y no permanente: Mejorar foto, Quitar muebles, Cambiar cielo, Amueblar | Mejorar foto = retoque real sin créditos; Amueblar = estilos; Cielo y Quitar objetos existen en el panel → llevan a «Guardar mi panel» con la explicación | `demo-owner-mobile-editor.jpg` | ✅ (estado verdadero) |
| 7. «Descargar imágenes» con cantidad gratuita verídica y «Compartir ficha», sin registro | lista de versiones listas con su descarga; compartir con `navigator.share` o copia del link **público** (`/demo/<token>`), nunca el link con código | `demo-owner-mobile-value.jpg`, test | ✅ |
| 8. «¿Querés probarlo con otra propiedad?» con URL y «Crear propiedad», conectado al registro | guarda la URL en el navegador, abre el registro de la invitación; el panel la retoma en «Crear otra propiedad» | test, código | ✅ (mismo navegador; otro dispositivo → Fase 4) |
| 9. Ficha completa debajo, sin grilla duplicada de fotos | se conserva la ficha (datos, descripción, servicios, contacto, mapa); pestañas; «Galería» vuelve a la galería de arriba | `demo-owner-mobile.jpg` | ✅ |
| «Consultar precio» cuando no hay precio | se conserva (`Consultar precio/alquiler`) | código | ✅ |
| 10. «Ver como comprador» limpio (sin gestión, costos, edición, créditos, registro), con vuelta al modo demo | `backToDemo`: sin invitación ni franja; botón flotante «Volver al modo demo» | `demo-buyer-mobile-viewport.jpg`, test | ✅ |
| Rutas existentes y link de comprador intactos | `/demo/<token>`, `/presentacion/<codigo>[/ficha|/precios]`, `/p/<…>` sin cambios | tests existentes | ✅ |
| Desktop: slider, estilos, contacto, mapa, atributos | estilos en columna lateral (340 px) | `demo-owner-desktop.jpg`, `compare-demo-desktop.jpg` | ✅ |
| Miguel Ángel no invasivo y nunca en vista comprador | sin cambios: solo con dueño | código | ✅ |
| Analítica: acción de valor real, no un tap de estilo | `demo_value_action` con `subtype` download/share/generation/edit; `second_property_import_started` (solo host) | código | ✅ |

## 3. Pendientes y decisiones

- **Video por foto («Crear video» / «Ver en movimiento»)**: no hay motor de video (Fase 5), así que no se muestra ninguna acción de video. Cuando exista un clip para la foto se agrega «Ver en movimiento» y, antes, «Video IA» con costo visible.
- **Cielo y quitar objetos en la demo sin cuenta:** hoy solo existen en el panel autenticado; en la demo se explica y se lleva a «Guardar mi panel». Habilitarlos sin cuenta requiere un endpoint público con control de créditos y abuso (decisión de costo).
- **Continuidad entre dispositivos** del enlace pegado en la demo: hoy funciona en el mismo navegador; entre dispositivos se resuelve con el claim seguro de la Fase 4.
- Miniaturas con lápiz (como en el mockup): no se agregan para no duplicar acciones; el lápiz está en «Estilos».

## 4. Evidencia visual

[`docs/ux/habita-v2/evidencia/fase-3/`](../ux/habita-v2/evidencia/fase-3/): `before-after-demo-mobile.jpg` (captura real actual vs. nueva), `compare-demo-mobile.jpg` (mockup vs. implementación), `compare-demo-desktop.jpg`, más capturas de estilos, editor, descargas, menú y vista comprador. Tomadas con `DemoView` real en `next dev` y datos/imágenes ilustrativos (`public/ejemplos`), porque este entorno no tiene acceso a una demo real ni al preview. El botón «N» es el indicador de desarrollo de Next.

## 5. Tests

`npm test`: **833/833** · lint OK · typecheck OK · build OK. Actualizados [`tests/demo-owner.test.tsx`](../../tests/demo-owner.test.tsx) (nuevo contrato del header, «Estilos», descargas, otra propiedad, vista comprador) y [`tests/interaction-tracking.test.tsx`](../../tests/interaction-tracking.test.tsx) (ids de tracking; el código de invitación nunca aparece en atributos).
