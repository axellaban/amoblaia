# Panel «Inmobiliarias» (2026-11-03)

Una sola línea de trabajo para el equipo: cada inmobiliaria, de prospecto a
cliente, y sus demos adentro. La barra lateral queda en **Adquisición ·
Inmobiliarias · Miguel Ángel**. «Leads» y «Demos existentes» se absorben:
`/admin/leads` redirige a la lista (o a la pestaña «Actividad» con
`?inmobiliaria=`) y `/admin/demos` a la lista. El editor de una demo sigue en
`/admin/demos/[id]` y en `/admin/inmobiliarias/[id]/propiedades/[demoId]`.

No hay migraciones: todo sale de tablas existentes (`agencies`, `demos`,
`prospect_accounts`, `subscriptions`, `lead_visitor_scores`, `lead_events`). Una
fuente que falta (migración pendiente o lectura fallida) se muestra como «no
se sabe», nunca rompe la lista.

## Etapa comercial (una escala para la lista y el detalle)

`src/lib/agency/commercial.ts`, puro y con tests (`tests/agency-commercial.test.ts`).
Gana el hecho más avanzado:

| Etapa | Se cumple cuando |
| --- | --- |
| Cliente | el dueño tiene una suscripción `authorized`, o una demo llegó al paso 5 (suscribió), o Adquisición la marcó `customer` |
| Con panel | tiene cuenta (`agencies.owner_id`) |
| Interactuó | alguna demo tiene actividad (paso ≥ 1) o hay lead score de visitantes externos |
| Demo enviada | alguna demo tiene `sent_at` |
| Contactada | su cuenta de Adquisición está en `sent`, `conversation`, `interested`, `activated` o `lost` |
| Prospecto | nada de lo anterior |

«Próxima acción recomendada» es una regla fija por etapa (`nextAction`): crear la
primera demo → publicarla → enviarla → seguimiento por WhatsApp → ver su panel.

## Pantallas

- **Lista** (`/admin/inmobiliarias`): tarjetas (totales, leads calientes ≥ 60,
  con cuenta, clientes pagos), una pestaña por etapa, búsqueda y «Filtrar»
  (cuenta, score mínimo, actividad reciente). Todo vive en la URL
  (`?etapa=&q=&cuenta=&score=&actividad=&pagina=`). Datos:
  `commercialRows()` en `src/lib/agency/commercial-server.ts`.
- **Detalle** (`/admin/inmobiliarias/[id]?pestana=`): cabecera con «Enviar demo»
  (elige cuál si hay varias publicadas), «Ver enlaces» y «⋯»; pestañas
  *Resumen* (resumen comercial, funnel, próxima acción, notas), *Propiedades y
  demos*, *Enlaces* (demo para la inmobiliaria, vista comprador, acceso al
  panel, precios), *Actividad* (totales, actividad reciente, score por
  propiedad y el detalle por visitante de la antigua «Leads») y *Cuenta*
  (acceso, contactos, invitaciones y créditos). Cada pestaña lee solo lo que
  muestra.
