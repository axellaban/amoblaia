Implementá el centro de adquisición comercial de Habita en el repositorio axellaban/amoblaia. Este pedido autoriza implementar código, migraciones y pruebas locales; no es solo una propuesta ni una maqueta. Trabajá hasta dejar una implementación verificable, con persistencia real y documentación. No envíes mensajes comerciales reales, no ejecutes generaciones pagas, no modifiques producción ni despliegues con este pedido.

## Material que debés leer

Esta carpeta contiene:
1. DISENO_PARA_CLAUDE_CODE.md: requisitos funcionales, métricas, modelo propuesto y criterios de aceptación.
2. index.html: maqueta interactiva aprobada como dirección visual.
3. propuesta-desktop.png, prospectos.png, mensajes.png, ejecucion.png y propuesta-mobile.png: referencias de pantallas.
4. LEEME_ENTREGA.md: contexto y datos de origen pendientes.

Leé AGENTS.md, la documentación vigente y las guías locales de Next.js indicadas en el repo antes de escribir código. Inspeccioná la rama actual, los cambios preexistentes, migraciones, autorización administrativa, componentes y pruebas. Trabajá en el checkout existente y preservá los cambios ajenos. Si las rutas o APIs actuales difieren de la especificación, adaptá la integración a lo real sin perder requisitos. La especificación es un diseño propuesto, no prueba del estado actual de la base.

## Alcance

Solo Habita, cuyo repo se llama amoblaia; Hibita/Navita fueron variantes del nombre en la conversación. Mantené la marca que usa actualmente el producto. Turnia es referencia conceptual: no modificar su repo, datos, servicios ni configuración. No es necesario tener acceso a Turnia para completar esta implementación.

Creá /admin/prospeccion (o una ruta coherente con la estructura actual), enlazada desde administración, con estas cuatro vistas:
- Resumen ejecutivo: prospectados, enviados confirmados, respondieron/contacto efectivo, interesados, activados y clientes; pendientes y calidad de datos.
- Prospectos: base del sheet, búsqueda y filtros, score y componentes, responsable SDR, decisor, canales/contactos con fuente/confianza, estado, historial, próxima acción y ficha lateral.
- Mensajes y conversión: plantillas versionadas y resultados por canal, paso y versión; denominadores y ventanas de observación visibles.
- Bandeja de ejecución: preparación, revisión, apertura de canal y confirmación separadas; apta para operación manual y por extensión de navegador de Claude Code.

Reutilizá agencies, demos y autorización administrativa existentes. No reemplaces el editor de demos ni dupliques cuentas por propiedad. Separá contacto comercial privado del contacto público para compradores. Reutilizá componentes del producto y trasladá el lenguaje visual del prototipo a componentes reales; no incrustes el HTML ni uses su JavaScript como arquitectura de aplicación.

## Requisitos que no se pueden simplificar

1. Persistencia real en Supabase/Postgres, validación de servidor, migraciones compatibles con lo existente y control administrativo en páginas y mutaciones. Ningún dato comercial privado se expone en demos públicas.
2. Historial de eventos que preserve hitos; estado actual e indicadores históricos son cosas distintas. Una respuesta no desaparece al perder un cliente.
3. Enviados = envíos confirmados, no clicks ni chat abierto. Respondieron = respuesta humana; interesados = interés explícito. No llamar «contactados» al simple intento.
4. Guardar texto y asunto exactos, plantilla/versión, canal, emisor, secuencia/paso, ordinal, fechas, actor y método de confirmación. Editar plantilla crea una versión nueva. Mensaje libre conserva texto sin adjudicarse a una variante experimental.
5. Idempotencia transaccional, manejo de concurrencia y bloqueo temporal. Si el proceso cae después de un posible envío externo, estado «Resultado incierto» con conciliación manual; nunca reenvío silencioso ni promesa de exactly-once entre navegador y canal.
6. Baja revalidada en servidor, detención de seguimientos al responder y controles ante endpoints inválidos. Abrir canales requiere destinatario conocido y revisado; mailto/WhatsApp Web no prueban entrega.
7. Controles accesibles y selectores estables para extensión: data-testid y attempt ID. Ninguna integración de extensión inventada: primero flujo UI operable y verificable bajo la sesión autorizada. No crear endpoints sin autenticación para facilitar automatización.
8. Resumen actualizado desde datos persistidos después de cada mutación; refresco entre sesiones y última sincronización visible. Sin conector, respuestas externas se registran explícitamente. No prometer lectura automática del inbox.
9. Contar cuentas únicas en embudo y mensajes/intentos por separado. Usar ventanas/cohortes consistentes; separar reciente «en observación» de tasas maduras. Mostrar n, numerador/denominador, desconocidos y muestras pequeñas. No sumar bases por canal si se superponen.
10. Atribución por último envío elegible anterior a la respuesta dentro de ventana, sin duplicar respuestas; conservar asistencias. Comparar variantes dentro del mismo paso/canal/segmento; no proclamar causalidad ni ganadoras con muestras pequeñas.
11. Importar el sheet sin inventar datos: vista previa, mapeo, deduplicación revisable, reporte de errores y reimportación idempotente. Mantener notas, scores y componentes originales. Número incorrecto invalida endpoint, no cuenta. Fecha sin hora conserva precisión de día. Variante/canal desconocido queda desconocido.
12. No usar datos ficticios como contenido de producción. Estados vacíos reales, sin convertir cifras del prototipo en semillas o estadísticas reales.

## Ajustes respecto de la maqueta

La maqueta es ilustrativa y algunos botones solo muestran avisos. En la implementación, completar cada acción útil con persistencia y validación o mostrar una dependencia concreta; no entregar botones simulados como funcionalidades terminadas.

Los filtros de cohorte/canal/SDR/campaña/zona del resumen deben ser controles reales. Los filtros de la maqueta son solo etiquetas. Preparar contacto desde una ficha debe seleccionar esa cuenta/contacto, no la cuenta fija Ejemplo A de la maqueta. Score y desglose deben pertenecer a la cuenta real, no al desglose ficticio de 96 puntos. La actividad nueva no debe modificar una cohorte cerrada. Los informes por mensajes deben usar la misma fuente de eventos y filtros; en el prototipo son cifras independientes.

Activación y compra solo se contabilizan con evidencia del servidor y vínculo verificado entre usuario y cuenta comercial. Si no existe aprobación de primera foto, identidad empresarial o señal de compra suficiente, implementá el soporte necesario dentro de este alcance cuando sea viable; mientras tanto mostrar «sin vincular/no medido», sin inventar conversiones ni adjudicar compras de compradores a la inmobiliaria.

## Cómo proceder

Primero inspeccioná y resumí brevemente integración y etapas; seguí implementando sin esperar aprobación de decisiones rutinarias. No te quedes en un plan. Dividí el trabajo en cambios verificables y completá las cuatro vistas y sus flujos fundamentales.

Orden sugerido: esquema/autorización → cuentas/contactos/importación → eventos/intentos/plantillas y cola → resumen y medición → integración con demos/activación/compra → pruebas y documentación.

Si no está disponible el CSV/XLSX real, no bloquees la implementación: construí importador, probalo con fixtures sintéticos identificados y dejá la importación real pendiente. No reconstruyas toda la base desde capturas ni inventes columnas cortadas. Para dependencias externas faltantes, completá lo independiente e identificá el requisito preciso; no pidas claves en el chat ni leas/imprimas secretos.

No actives automatizaciones externas ni envíos con destinatarios reales durante pruebas. No instales un CRM o conector de terceros para sustituir esta funcionalidad.

## Validación y entrega

Usá las convenciones de tests existentes y verificá los criterios de aceptación de DISENO_PARA_CLAUDE_CODE.md. Priorizá pruebas de invariantes: idempotencia, concurrencia, baja, detención de secuencia, envío incierto, atribución, ventanas, permisos y reimportación. Probá interacciones de las cuatro pantallas, filtros combinados, estados vacíos/errores, teclado y móvil. Preservá resultados históricos ante cambios de estado/versión.

Ejecutá los scripts pertinentes del package.json actual. Como referencia al momento de diseñar: Node 24.x; npm run lint, npm run typecheck, npm test, npm run build. Instalación con npm ci si corresponde; no regeneres lockfile innecesariamente. Corrigí fallos del cambio e identificá fallos preexistentes por separado. No afirmes validación de DB, proveedores o producción si no se realizó.

Entregá:
- Implementación funcional y resumen de archivos cambiados.
- Migraciones y pasos exactos para aplicar/probar en entorno local o staging, sin aplicarlas a producción.
- Guía de operación manual y por extensión, incluyendo resultado incierto, respuestas y bajas.
- Diccionario de métricas y atribución, con límites y cobertura de datos legados.
- Importador y reporte de validación con datos sintéticos; informe real solo si se proporcionó archivo y se autorizó su importación al entorno adecuado.
- Evidencia de checks ejecutados, capturas de la UI real y pendientes concretos.

El objetivo es una herramienta de trabajo y medición sobre la base existente, no un dashboard decorativo ni una automatización de envíos sin trazabilidad.
