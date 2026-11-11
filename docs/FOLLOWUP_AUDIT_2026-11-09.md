# Auditoría integral de Follow-up — Habita (9 nov 2026)

**Alcance:** Cola de ejecución, Respuestas, Embudo, Estados y reglas, Resultados, endpoints autenticados, motor de reglas, versión de mensajes, Supabase y contratos de la extensión. Se auditaron lectura, clasificación, ejecución, bloqueo y atribución. Sin enviar WhatsApps ni modificar prospectos reales.

## Correcciones incluidas en el PR de auditoría

| Gravedad | Sección | Hallazgo verificado | Solución |
|---|---|---|---|
| P0 | Cola | El límite de 50 contactos nuevos/24 h era booleano: con 13 enviados, hasta 94 podían figurar «listos». | Separar candidatos de cupos: **37 habilitados**, resto bloqueado «En espera de cupo»; indicador con usados/capacidad/espera. Se privilegian los contactos ya tomados. |
| P0 | Ejecución | Confirmar un mensaje no recalculaba bloqueos recientes y podía ignorar el cap. | Revalidar bloqueos al confirmar y guardar primeros envíos mediante RPC con bloqueo transaccional. |
| P1 | Cola | «Tomar la próxima» solo revisaba los 500 primeros del orden global y después aplicaba el filtro. | Filtrar el board completo antes de tomar el contacto; conserva su bloqueo por operador. |
| P1 | Estados y reglas | El editor ofrecía «Precios» en Interesado/Demo enviada, pero el backend prohibía crear su versión salvo en Contactado. | Reutilizar la misma matriz de compatibilidad del motor para validar versiones. |
| P1 | Embudo | Mostraba nueve etapas técnicas mientras la cola y las reglas mostraban siete comerciales. | Siete tarjetas comerciales con estados de avance como subfiltros. |
| P1 | Respuestas | El formulario manual omitía oportunidades cerradas («No interesado») aunque pudieran volver a escribir. | Incluirlas como opciones sin reactivarlas automáticamente. |
| P1 | Resultados | Abrir el panel podía escribir `converted_at=now()` cuando no se conocía el momento real de conversión. | Lectura sin efectos laterales; usar solo fechas observadas de interés/demos, sin inventar fechas. |
| P1 | Resultados | La atribución tomaba el primer timestamp según orden de filas, no el más antiguo acreditable. | Seleccionar la fecha observada más temprana. |
| P2 | Resultados | Agrupaba por semana iniciada el lunes pese a la convención comercial de reportar semanas terminadas el viernes. | Agrupar por cierre de viernes en hora argentina (sábado–viernes). **Revertido el 11/11: la semana comercial es de lunes a domingo.** |

## Resultados reales de validación preliminar

En una consulta de solo lectura a Supabase: **13 inmobiliarias con primer contacto registrado en las últimas 24 h, 50 de límite interno, 37 cupos restantes**. Los 13 incluyen registros de Follow-up y Adquisición sin duplicación por agencia. Estos números son una fotografía, no un valor fijo ni un cupo oficial de Meta. Los envíos hechos exclusivamente fuera de Habita no se pueden inferir.

## Verificaciones de funcionamiento a realizar tras publicar

- [ ] Cola: en «Prospectado», verificar que «listos» nunca exceda los cupos restantes y que el resto aparezca en bloqueadas con motivo.
- [ ] Cola: cambiar orden a comercial, score y antigüedad y confirmar que «Tomar la próxima» respeta filtros incluso con más de 500 tareas.
- [ ] Cola: confirmar que ningún envío fuera de ventana horaria o al alcanzar cap se registra como enviado; al confirmarlo, se refresca la cola.
- [ ] Respuestas: clasificar respuesta normal, consulta de precios, baja confianza, rechazo y «No contactar». No hacer pruebas con mensajes reales.
- [ ] Embudo: siete etapas, subestados accesibles, métricas conservadas sin doble conteo.
- [ ] Reglas: crear una regla de Precios en Interesado; crear una versión, editar días/horario/mensaje/observaciones sin alterar otras acciones.
- [ ] Resultados: comparar cohortes semanales terminadas en viernes y revisar atribuciones sin timestamp real.
- [ ] Extensión: probar la lectura del catálogo y clasificación end-to-end, sin envíos en QA.

## Riesgos residuales que no deben confundirse con resueltos

1. **WhatsApp ≠ cupo interno:** 50 es la configuración de Habita, no una autorización de Meta. La ventana de atención de 24 h y los requisitos de opt-in/plantillas son condiciones independientes. La API de WhatsApp/Web debe proporcionar evidencia efectiva de envío y consentimiento para garantizar cumplimiento.
2. **Concurrencia fuera de Follow-up:** el nuevo bloqueo transaccional serializa confirmaciones hechas por Follow-up y cuenta envíos de Adquisición. Si Adquisición confirma en paralelo sin tomar el mismo bloqueo de BD, el límite conjunto todavía podría excederse por una carrera. Extender el lock al motor de Adquisición es trabajo posterior.
3. **Histórico de atribución:** fechas `converted_at` escritas por versiones anteriores con una estimación no fueron borradas ni corregidas; para depurarlas hace falta revisar los eventos fuente.
4. **Datos de actividad interna:** «Generó imagen» usa `demo_activity.is_internal=false`, pero el nivel agregado de visitas/interacciones en `demos.activity_level` requiere una revisión separada de procedencia y exclusión interna antes de usarse como KPI externo.
5. **Escala:** algunas lecturas tienen límites operativos de 5.000–50.000 filas o consultas `in` grandes; revisar paginación y performance antes de operar decenas de miles de contactos.
6. **Correcciones manuales de pérdidas:** cambiar una etapa de una cuenta perdida no revierte necesariamente eventos históricos de pérdida en Adquisición; no automatizar reactivaciones sin reconciliation.
7. **Respuestas repetidas:** la clave idempotente utiliza minuto y fragmento del texto; pueden colisionar dos respuestas idénticas dentro de ese minuto. Requiere identificador real del mensaje de WhatsApp, si la extensión lo tiene.
8. **Pruebas de UI/Extensión:** CI verifica compilación, tests unitarios y de migración; no sustituye probar la sesión administrativa y la extensión real, ni evidencia de recepción de WhatsApp.

**Política de seguridad:** no se eliminaron datos ni se realizaron envíos reales. La migración aditiva solo agrega un RPC de confirmación protegido para service role y conserva el RPC original.
