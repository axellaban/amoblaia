/**
 * Sincroniza la pestaña de prospectos con habita cada hora.
 * Pegar este archivo en Extensiones → Apps Script de la planilla.
 *
 * Configuración (Configuración del proyecto → Propiedades del script):
 *   PROSPECT_SYNC_URL    https://<dominio de habita>/api/admin/prospeccion/sincronizar
 *   PROSPECT_SYNC_TOKEN  el mismo valor que PROSPECT_SYNC_TOKEN en Vercel
 *
 * Después, ejecutar una vez instalarDisparador() y autorizar el script.
 */

// Debe ser la misma cadena que usaron al importar a mano: si no, cada
// inmobiliaria figura dos veces.
const PROSPECT_SOURCE = 'Prospecting amobla IA · Prospectos';
const PROSPECT_TAB = 'Prospectos';
// Canal de los envíos "Enviado" de la planilla. Ver docs/PROSPECCION.md.
const PROSPECT_LEGACY_CHANNEL = 'whatsapp';

function sincronizarProspectos() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('PROSPECT_SYNC_URL');
  const token = props.getProperty('PROSPECT_SYNC_TOKEN');
  if (!url || !token) throw new Error('Faltan PROSPECT_SYNC_URL o PROSPECT_SYNC_TOKEN en las propiedades del script.');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PROSPECT_TAB);
  if (!sheet) throw new Error('No existe la pestaña ' + PROSPECT_TAB);

  // Valores tal como se ven en la hoja, igual que la exportación a CSV.
  const csv = aCsv(sheet.getDataRange().getDisplayValues());
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ csv: csv, source: PROSPECT_SOURCE, legacyChannel: PROSPECT_LEGACY_CHANNEL }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('Sincronización rechazada (' + code + '): ' + res.getContentText().slice(0, 300));
  Logger.log(res.getContentText());
}

function aCsv(filas) {
  return filas
    .map(function (fila) {
      return fila
        .map(function (celda) {
          const s = String(celda);
          return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        })
        .join(',');
    })
    .join('\n');
}

/** Ejecutar una sola vez: reemplaza cualquier disparador anterior de esta función. */
function instalarDisparador() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizarProspectos') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizarProspectos').timeBased().everyHours(1).create();
}
