# Propuesta UX v3 · revisión de la última versión de Habita

Código inspeccionado: main 02a736dabe91689f3b6ecf68b8ac4be670bdabd9, PR #32, incluyendo #29–31. Snapshot read-only /tmp/habita-latest-ux. Estas pantallas son propuestas, no cambios de la aplicación. No se ejecutaron compras, generaciones, acreditaciones ni cambios en cuentas reales.

## Qué cambió y ya existe

Editor separado en editor-photos.tsx + demo-editor.tsx, espacios, tarjetas compactas con cajitas de estilos, cotización, descarga individual, administración por inmobiliaria y soporte con sesión temporal. No pedir reimplementar esas funcionalidades desde cero.

## Acceso de edición del administrador

La restricción actual es intencional: src/lib/agency/support.ts firma una cookie ligada al administrador y agencia, válida por una hora. assertReadable rechaza mutaciones; requireAgency y requireDemoAccess la aplican. support-banner.tsx explica solo lectura; SupportViewButton abre ese flujo.

Propuesta: dos entradas explícitas, Ver como cliente (solo lectura existente) y Editar inmobiliaria (modo administrativo nuevo). Mantener identidad del actor administrador, objetivo agency_id, banner permanente, vencimiento/salida y auditoría. Cada mutación debe autorizar explícitamente actor, agencia y capacidad; no quitar assertReadable globalmente ni confiar en Referer como permiso. Aislar contexto entre pestañas o usar ruta/identificador de contexto verificable, evitando que cambiar de agencia en una pestaña dirija cambios de otra a la cuenta equivocada.

Definir alcance: datos, marca/contacto, propiedades, organización de fotos y publicación con confirmación. Compras, identidad del dueño, credenciales y consumo pagado de IA no se habilitan silenciosamente. Para generar sobre cuenta del cliente se necesita política explícita y cotización con cuenta pagadora; la maqueta no concede ese permiso. No impersonar ni cambiar la sesión del cliente. El acceso para el cliente mantiene sus reglas.

## Oportunidades en fotos

PhotoCard actual muestra tres selectores (Espacio, Ambiente para crear, Modo), versiones creadas con miniatura y Ver que realizan acciones distintas, selección de estilos faltantes en chips, creación múltiple local y selección global para lote. Son capacidades útiles, pero compiten visualmente.

1. Un espacio de trabajo por foto con versión activa visible por nombre. Seleccionar resultado cambia la vista; la acción Comparar tiene un único lugar.
2. Descargar esta versión como CTA claro de la imagen activa, sin abrir historial o adivinar a qué resultado corresponde.
3. Crear otra versión abre selector breve de acción + estilo, cotización y confirmación. Preservar selección al cancelar/rechazar; actualmente picking se limpia al invocar createMany, antes de conocer aceptación/éxito.
4. Espacio visible, tipo heredado como valor inicial y ajustes avanzados cuando haya conflicto. No forzar tres decisiones en cada foto ni sobrescribir overrides válidos.
5. Trabajo por tandas separado, no controles globales de estilos antes de cada tarjeta. No eliminar lote ni perder estados persistidos.
6. Foto/versiones listas, publicación y revisión técnica son estados diferentes. Descargar no depende de saldo ni consume créditos. Incertidumbre técnica requiere ruta de conciliación, no presentarla como fallo seguro.
7. La referencia muestra panel de imágenes estable, espacios a izquierda y selección a derecha. Móvil debe apilar controles y conservar foco/acción visible.

## Alta más simple

NewDemoForm actual combina importación por URL y formulario manual en una misma página, además de elección de agencia. Propuesta: contexto de agencia fijo, método URL/manual como alternativas, revisión de resultados y guardado de borrador. Crear inmobiliaria independiente de crear su primera propiedad; datos mínimos, enriquecimiento posterior. Crear ficha de agencia no implica registrar usuario, invitarlo o regalar saldo.

## Pantallas incluidas

01: inmobiliarias con acción Editar diferenciada del soporte.
02: workspace administrativo con banner y tareas por propiedad.
03: edición enfocada en la foto, versión activa y descarga.
04: nueva propiedad con método de entrada y revisión previa.
05: nueva inmobiliaria con mínimos y vista previa de identidad.

index.html permite navegar entre las 5, seleccionar versiones, comparar, descargar JPG ilustrativo y abrir selector. Otros botones muestran explicaciones de interacción. No es una implementación funcional de la app ni reemplaza backend.

Todas las imágenes y cuentas de las pantallas son ilustrativas. Se usan escenas ficticias generadas de public/ejemplos; no son fotografías reales de la propiedad o del cliente. Las cifras no se leyeron de su base. Los JPG son capturas del HTML renderizado, no renders de producción.

Validación del prototipo en Chromium: navegación de 5 pantallas, selector, comparación, descarga JPG, nombre en vista previa y móvil 390px sin desborde. No se corrió la suite de la aplicación en esta revisión ni se verificó producción autenticada. No se aplicaron cambios funcionales a main.
