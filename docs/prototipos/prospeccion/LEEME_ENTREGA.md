# Entrega a Claude Code

1. Extraer este ZIP en una carpeta local, preferentemente fuera de la raíz de la app (por ejemplo docs de referencia en una carpeta hermana). Abrir Claude Code en el checkout axellaban/amoblaia.
2. Pegar el contenido de PROMPT_PARA_CLAUDE_CODE.md e indicar la ruta absoluta de la carpeta extraída. Adjuntar archivos o permitir su lectura local; un enlace /workspace de este chat no da acceso desde otra máquina.
3. Adjuntar, si está disponible, exportación CSV o XLSX de la planilla real y las tres capturas de referencia. Si hay varias pestañas relevantes, XLSX o un CSV por pestaña. Mantener el archivo real fuera de Git y de fixtures; contiene contactos comerciales.
4. El archivo real es necesario para una migración fiel, no para iniciar el desarrollo. Las capturas muestran estructura y algunas filas; no son una base completa.

## Material incluido

- PROMPT_PARA_CLAUDE_CODE.md: instrucción completa lista para pegar.
- DISENO_PARA_CLAUDE_CODE.md: diseño funcional y técnico, reglas de métricas y aceptación.
- index.html: prototipo interactivo independiente; abrir localmente en navegador.
- propuesta-desktop.png: resumen ejecutivo.
- prospectos.png: base operativa.
- mensajes.png: comparativas por versión/canal/paso.
- ejecucion.png: flujo de preparación y confirmación.
- propuesta-mobile.png: referencia móvil.

Las capturas originales del sheet aportadas por el usuario NO están incluidas en este ZIP: adjuntarlas por separado. Ninguna cifra, nombre de cuenta ni tasa de la maqueta proviene de una extracción real del sheet.

## Contexto de la planilla

Columnas visibles: prioridad, score, inmobiliaria, SDR, quién decide, abrir WhatsApp, número sin 0 ni 15, confianza del número, fuente del número, estado, fecha envío, notas; propiedades publicadas, avisos vistos en muestra, puntos de contacto, puntos de quién decide, puntos de stock y puntos de actividad; dirección, zona, web, Instagram, email, perfil Argenprop y otros teléfonos. Hay al menos una columna parcialmente cortada que requiere confirmar al importar.

Conservar el score original y sus cuatro componentes; no se conoce la fórmula completa de asignación. Estados visibles: Pendiente, Enviado y Número incorrecto. Notas visibles mencionan mensajes cortos v2/v3 y mail; no inferir texto exacto ni canal por filas ambiguas. Históricos con fecha pero sin hora/variante precisas deben mantener esa incertidumbre.

## Alcance aprobado

Implementar solo en la app inmobiliaria Habita, repo axellaban/amoblaia. Turnia es una referencia de arquitectura revisada anteriormente; no tocarlo. El diseño mantiene una sola base comercial y permite medir variantes, secuencias y canales; no presume que WhatsApp/email sean estrategias causalmente comparables sin segmentación.

La UI existente usa habita.; Hibita/Navita fueron variantes del nombre en la conversación. Conservar marca real actual, sin rebranding.

## Diferencias entre diseño y producción

El prototipo no persiste, no envía ni recibe mensajes, no importa archivos y no se integra con la extensión. Demuestra organización e interacción. La implementación debe reemplazar simulaciones por lógica validada en servidor. El prompt detalla los puntos en que la maqueta simplifica filtros, score, cuenta seleccionada y fuentes de datos.

El envío real, migración de datos a producción y despliegue no se autorizan con este prompt. Se podrán revisar después de tener cambios y validación concretos. No se requieren secretos en chat; usar configuración existente y entrada segura cuando corresponda.
