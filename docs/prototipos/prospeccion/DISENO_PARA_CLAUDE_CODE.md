# Habita · Centro de adquisición

Diseño funcional para revisión; no es una implementación ni autoriza envíos. Alcance exclusivo: axellaban/amoblaia, cuya interfaz existente usa «habita.». «Hibita/Navita» en la conversación se interpreta como este mismo producto. No modificar Turnia ni compartir sus datos. Conservar las demos y funcionalidades existentes. Usar el checkout actual; no crear worktrees sin pedido explícito.

## Evidencia y decisiones

Capturas del sheet: prioridad, score, inmobiliaria, SDR, quién decide, abrir WhatsApp, número sin 0/15, confianza y fuente del número, estado, fecha de envío y notas. También stock de propiedades, avisos vistos en muestra, puntos de contacto/decisor/stock/actividad, dirección, zona, web, Instagram, email, perfil Argenprop y teléfonos alternativos. Notas contienen variantes de mensaje y canal (p. ej. corto v2, corto v3, Gmail), que hoy no están estructurados. Se ven «Pendiente», «Enviado» y «Número incorrecto». No se deducen totales ni respuestas a partir de las filas visibles. La columna parcialmente cortada entre notas y propiedades debe identificarse al importar, no inventarse.

Turnia se usa como referencia de cola diaria, plantillas, historial y bajas. No copiar su registro de contacto al abrir un chat, sus métricas basadas en estado actual ni su mezcla de apertura con interés explícito.

Amoblaia ya tiene agencies, demo_properties, demo_photos, demos; editor en /admin/demos, autenticación administrativa y atribución en PostHog. Reutilizar agencies como cuenta y relacionar múltiples contactos/demos. Mantener separado el contacto público del comprador del contacto comercial privado de prospección. PostHog no será la fuente de verdad de envíos ni conversiones.

## Arquitectura de pantallas

Nueva sección privada /admin/prospeccion, enlazada desde administración.
1. Resumen: filtros por cohorte de primer envío, canal, SDR, campaña y zona. Tarjetas prospectados, enviados confirmados, respondieron e interesados. Embudo, vencimientos, motivos de pérdida y calidad de datos. Mostrar fecha/hora de actualización real.
2. Prospectos: tabla operativa con prioridad, score desglosable, inmobiliaria, SDR, decisor, contacto principal y confianza, estado comercial, último envío (canal/paso/variante), próximo movimiento y fecha. Filtros y búsqueda; drawer lateral evita perder posición. Acciones Preparar contacto, Registrar respuesta, Próxima acción, Baja. Vista Para hoy prioriza compromisos vencidos, respuestas sin contestar y luego nuevos por score; cada prioridad explica el motivo. El score es editado/importado y tiene versión; no inventar las reglas de la planilla.
3. Mensajes y resultados: biblioteca de plantillas versionadas y tabla por campaña + paso + canal + versión. Conteos y denominadores visibles, ventana de observación, tamaño de muestra y resultados maduros/pendientes. Primer mensaje, seguimiento 1 y seguimiento 2 tienen métricas independientes. Mostrar también desempeño completo de la secuencia.
4. Bandeja de ejecución: lotes revisables y fichas individuales. Destinatario, SDR/cuenta emisora, canal, paso, texto exacto, recurso, última interacción y próxima acción. Vista apta para lectura y operación por extensión de navegador de Claude Code, sin requerir una integración que no existe. Estados y errores explícitos; nunca enviar al cargar página, al preparar un mensaje o al abrir canal.

## Semántica y métricas

Evitar el ambiguo «contactados». Etiquetas visibles:
- Prospectados: cuentas cargadas en la base; mostrar total actual aparte del filtro por cohorte de primer envío.
- Enviados: cuentas únicas con al menos un envío confirmado, no número de mensajes. Mensajes totales es un indicador separado.
- Respondieron (contacto efectivo): cuentas con respuesta humana registrada. Excluir autorrespuestas, rebotes y confirmaciones de entrega. Una respuesta negativa cuenta como respuesta; la baja automática sin respuesta no.
- Interesados: cuentas con interés explícito registrado con fecha y evidencia, independiente de abrir una demo.
- Activados: primera generación propia completada y aprobada, distinta de una demo generada por el equipo. Si hoy no hay evento de aprobación, explicitar la dependencia; no reemplazarlo silenciosamente por vista de demo.
- Clientes: primera compra confirmada y conciliada en servidor; decidir cómo tratar devoluciones, conservar ambos eventos.

Historial conserva hitos aunque el estado actual cambie. Cuentas únicas a nivel de embudo; intentos a nivel de mensajes. Ejemplo de la maqueta: 120 prospectados, 80 enviados, 24 respondieron, 10 interesados, 6 activados, 3 clientes. 24/80=30%; 10/80=12,5%; 10/24=41,7%. Son cifras ficticias, no extracción del sheet.

Para cada envío: ordinal global por conversación y paso configurado en la secuencia; cambiar de WhatsApp a email no reinicia el ordinal. Identidad de plantilla y versión, canal y paso son dimensiones distintas. Texto renderizado y asunto se congelan; editar una plantilla crea una versión, no altera envíos históricos. Registrar mensaje libre como personalizado y guardar su texto exacto; nunca atribuirlo arbitrariamente a una variante experimental.

Tabla de mensajes: denominador = intentos confirmados de ese paso/variante/canal, con ventana completa de 7 días (configurable y versionada), sin una respuesta previa que ya detuviera esa secuencia. Respuesta atribuida al último envío confirmado anterior dentro de la ventana y antes del próximo envío; máximo un envío por respuesta. Si la identidad o cronología es ambigua, dejar sin atribuir y conservar el resultado de cuenta. Cuando cambia el canal, la atribución principal va al último toque elegible y los anteriores figuran como asistencias, sin duplicar totales. Mostrar interés tras ese toque como asociación; no afirmar causalidad de la variante ni repartir automáticamente compras.

Por canal: cuentas únicas expuestas a ese canal y resultados atribuidos; si una cuenta recibe ambos, figura expuesta en ambos y sus bases NO se suman. Etiquetar por separado canal inicial, canal de última respuesta y conversiones asistidas. Embudo global deduplicado. Comparar variantes dentro de mismo paso/canal/segmento y ventana, mostrar n y «muestra pequeña» con umbral explícito (propuesta: n<30); no proclamar ganadora ni significancia sin análisis. El segundo mensaje se aplica a no respondientes: su tasa no se compara causalmente con el primero.

Reloj de métricas: cohorte por fecha de primer envío confirmado (America/Argentina/Buenos_Aires), resultados a 7/14/30 días; por defecto 7 para mensajes y 30 para cuenta. Exponer observación incompleta y excluirla de tasas maduras sin ocultar actividad reciente. Eventos fuera de ventana conservados como tardíos. Etiquetar filtros de forma que numeradores y denominadores pertenezcan a la misma cohorte.

## Preparación para la extensión de Claude Code

Flujo: seleccionar cuenta → crear intento preparado → revisar texto/destinatario → abrir WhatsApp/mail → enviar en el canal por operador o extensión → volver a confirmar resultado. WhatsApp Web con número normalizado; email con asunto/cuerpo y cuenta emisora identificada. Mailto no demuestra envío ni entrega. No prometer lectura/entrega, ni sincronización automática de Gmail/WhatsApp sin una integración verificable.

Cada intento tiene UUID e idempotency_key. Bloqueo temporal con actor, lease y caducidad; token/versionado de concurrencia evita que dos operadores envíen el mismo intento. La caducidad NO reencola un posible envío automáticamente. Si hay cierre o fallo tras el envío externo y antes de confirmarlo: estado «Resultado incierto», bloquear reintento hasta conciliación con el canal. No es posible garantizar exactly-once en un canal externo controlado por navegador; la UI debe explicarlo con un estado operativo, sin reenvío silencioso.

Controles con nombres accesibles estables (Preparar intento, Abrir WhatsApp, Confirmar envío, Registrar respuesta), data-testid estables y data-attempt-id. Semántica HTML, teclado, foco y estados de carga. Mostrar timestamps, estado y evidencia sin depender del color. La extensión actúa bajo sesión autorizada y usa el mismo flujo que un humano; todas las mutaciones se validan en servidor con requireAdmin, no se confía en atributos DOM.

Confirmación exige canal, destinatario, cuenta emisora, hora y método de verificación: observación del canal/manual/importado. Guardar identificador externo si existe; evidencia opcional minimizada. El agente debe detenerse ante canal desconocido o sesión vencida. «Confirmado por operador» no equivale a recibo del proveedor. Registrar fallos, rebotes, número inválido y cancelación como resultados distintos; no contarlos como enviados. Contacto alternativo no elimina la baja global. Revalidar baja y concurrencia antes de abrir canal; entre ese momento y envío externo existe una carrera que exige nueva comprobación del operador/extensión.

Actualizar resumen después de cada mutación confirmada, invalidar consultas y sincronizar entre sesiones mediante polling o suscripción. Mostrar última sincronización; si falla, aviso y reintento sin duplicar eventos. Sin integración con el canal, respuestas y envíos externos requieren registro explícito: no prometer actualización automática de hechos que la herramienta no observa.

## Modelo de datos propuesto (adaptar tras inspección)

Reutilizar agencies como cuenta. Añadir tablas privadas con RLS y permisos administrativos de servidor:
- prospect_accounts: agency_id único, source, source_row_id, campaign, SDR, priority, score, score_components, scoring_version, zone, commercial_stage, next_action, due_at, imported_at.
- prospect_contacts: account_id, persona/cargo/decisor, canal, dirección normalizada, original, confianza, fuente_url, verificado_en, inválido_en; múltiples contactos por cuenta, no deduplicar por email genérico sin revisión.
- outreach_templates y outreach_template_versions: propósito, paso, canal, versión inmutable, asunto, cuerpo, activo.
- outreach_sequences y pasos; inscripción por cuenta y campaña, pausada al responder/baja/interés, continuación manual según resultado.
- outreach_attempts: cuenta/contacto, secuencia/paso/ordinal, template_version nullable, texto/asunto congelados, canal, sender, estado, UUID/idempotency_key, prepared_at, confirmed_at, verified_by/method, external_id nullable, error, lock/lease/version.
- prospect_events: append-only, account_id, attempt_id nullable, tipo, occurred_at, recorded_at, actor, source, evidence_ref; correcciones por evento compensatorio, sin borrar historia para acomodar métricas.
- suppressions: alcance cuenta/canal/contacto y motivo. Al consultar capacidad de enviar, aplicar la restricción más amplia.

Enlaces a demos existentes, no duplicarlas. Eventos de activación/compra leídos del servidor y relacionados con cuenta con evidencia determinista; cookies/UTM son señales de atribución, no identidad empresarial probada. Preparar vínculo verificado cuenta→usuario para evitar adjudicar compras de compradores a una inmobiliaria.

## Migración de la planilla

Importación CSV/XLSX con vista previa, mapeo explícito, validación y reporte de duplicados. Mantener valores originales y todas las notas. Mapear score y sus cuatro componentes sin recalcular. Normalizar teléfonos argentinos considerando zona y fuente; si hay ambigüedad pedir revisión por fila, no agregar 9 a ciegas. Duplicados por dominio/teléfono producen candidatos de fusión, no fusiones destructivas automáticas.

«Enviado» con fecha pero sin hora: evento legado con precisión de día y zona documentada. No inventar canal o texto desde notas cortadas/ambiguas: variante/canal desconocidos. «Pendiente» permanece sin envío. «Número incorrecto» invalida ese endpoint, no toda la cuenta. Reimportación idempotente por origen/fila o identificador estable, con diferencias visibles; no pisa historial, SDR ni próximas acciones sin decisión explícita.

Importación histórica y envíos instrumentados separados en métricas. Incluir legado en cuentas cuando hay evidencia suficiente; excluir variante desconocida de rankings por versión, mostrando cobertura. Tras importación: aplicación como fuente operativa; sheet se conserva para referencia/exportación. No implementar escritura bidireccional sin reglas explícitas de conflicto. Las capturas no sustituyen el archivo para una migración fiel.

## Entrega por etapas

1. Cuenta/contactos + importación + historial + cola + resumen actualizado; lote pequeño real revisado.
2. Plantillas versionadas + intentos verificables + operación por extensión/manual + respuestas y bajas.
3. Comparativas por paso/canal/variante, cohortes maduras, conexión a activación y compra.

## Criterios de aceptación

- Abrir/cerrar chat no incrementa enviados; confirmar dos veces el mismo intento genera un solo envío.
- Responder y luego perder la cuenta no borra el hito de respuesta.
- Dos operadores no confirman el mismo intento; resultado incierto no se reenvía automáticamente.
- Baja bloquea intentos preparados y futuros; respuesta detiene seguimientos pendientes.
- Versión editada no cambia textos ni tasas históricos; mensajes libres no contaminan A/B.
- Cuenta con WhatsApp y email cuenta una vez en global y no duplica su respuesta atribuida.
- Segundo mensaje solo considera su base elegible; tasas muestran n, ventana y observación incompleta.
- Envió v2 y siguió v3: conservar ambos toques; no atribuir respuesta anterior a v3.
- Número inválido, rebote y envío fallido no cuentan como enviado confirmado.
- Importar dos veces no duplica cuentas/eventos ni pierde notas; variantes desconocidas quedan explícitas.
- Preview interno y tráfico comprador no crean interés comercial.
- Verificar permisos por página y mutación; nunca exponer notas/contactos privados en demo pública.
- UI en desktop y móvil, teclado, estados vacíos/errores, hora local y sincronización visible.

## Maqueta

index.html ilustra Resumen, Prospectos, Mensajes y Ejecución. Los datos y tasas son ficticios, las confirmaciones solo cambian estado en memoria y no abren ni envían mensajes reales. No demuestra conectividad con proveedores, persistencia ni integración con extensión. Especificación anterior prevalece ante simplificaciones visuales.
