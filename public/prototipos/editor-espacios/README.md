# Editor por espacios · Prototipo de interacción de Habita

Una sola página HTML autocontenida. Abrir index.html desde un servidor o descargarlo desde GitHub con **Download raw file / Descargar archivo sin formato** y abrir con navegador. No requiere instalar dependencias. Las imágenes ilustrativas están incluidas en el archivo.

## Recorrido sugerido

1. El prototipo abre en el editor, con Fotos y espacios desplegado y las demás secciones plegadas.
2. En Living, pulsar Crear en Costero y confirmar la simulación. Ver En cola → Generando → Creada.
3. Usar Ver, Comparar o Descargar sobre Moderno o la nueva versión. Descargar produce un JPG ilustrativo real, sin gasto.
4. Destildar Incluir en lote: las versiones y acciones permanecen. Cambiar a Dormitorio principal para crear ahí.
5. Abrir Datos, escribir un borrador, plegar y volver a abrir: conserva el valor incluso si termina una creación simulada.
6. Nuevo espacio permite crear grupos; Agregar fotos abre el selector de archivos locales. No sube datos. La generación real de fotos propias no está disponible en este prototipo: no se sustituye una foto local por una imagen ajena.
7. Seleccionar Inmobiliarias: expandir una fila, abrir propiedad o agregar créditos ficticios con motivo. Con dueño se suman disponibles; sin dueño, reservados.
8. Cambiar a vista Inmobiliaria para ver el listado de propiedades; Continuar con las fotos lleva al editor.

## Límites y datos

Todo el estado se guarda solo en memoria y se reinicia al recargar. Nombres, cifras, saldos y datos de propiedad sirven para diseño; no están conectados a registros reales. GM/Casonas del Haras referencia el caso conversado, pero las imágenes son escenas ficticias generadas de `public/ejemplos/`, no fotos reales de ese cliente. Las capturas JPG muestran diseño, no producción.

No llama a API, no genera imágenes con proveedor, no crea propiedades reales, no publica, no envía mensajes y no otorga créditos reales. La cola temporizada es una simulación identificada. Los estilos usan archivos preexistentes de ejemplo. La comparación usa sus originales/resultados ilustrativos correspondientes; no se imitan resultados mediante filtros CSS.

Los controles de roles presentan recorridos de UX; no certifican autorización de backend. La implementación final debe conservar los límites de generación del administrador sobre cuentas ajenas y cotizar desde el servidor.

## Entrega

Ruta para servir desde esta rama: `/prototipos/editor-espacios/index.html`.

Rama de revisión: `design/editor-espacios-review`. No se requiere mergear a main para descargar y probar el HTML. No se verificó publicación de un Vercel Preview.

Capturas livianas: vista-editor.jpg, vista-administracion.jpg, vista-propiedades.jpg y vista-movil.jpg.

## Validado en Chromium

Acordeones; selección de lote independiente de resultados; creación individual simulada; conservación de borrador; descarga JPG; comparador; espacios separados; créditos simulados disponibles/reservados; navegación de vuelta a administración; móvil 390 px sin desborde. No hay integración ni validación de proveedores reales.
