# Reconstrucción con REA

Fecha: 20/10/2026. Referencia solicitada: https://www.virtualstagingai.app/. Herramienta: https://github.com/morluto/rea, paquete oficial `rea-agents@6.7.0`.

## Procedimiento ejecutado

1. Se capturó el HTML público de la landing y se enumeraron sus 57 etiquetas script externas.
2. Los scripts se descargaron en una carpeta local de trabajo. No se ejecutó su bootstrap ni se invocaron endpoints privados del producto original.
3. Se ejecutó el analizador estático oficial, con Node 24:

```bash
npx --yes --package=node@24 --package=rea-agents rea \
  analyze-javascript-application /ruta/a/reference-bundle --json
```

4. Se contrastó el material con la inspección visual del sitio y el relevamiento de Firecrawl.
5. Se implementó el flujo de staging en una aplicación independiente preparada para Vercel.

## Evidencia

- Evidence ID: `ev_62900f3fb478e697ca8ebd7c3e00618a0c237c1371d24afade7e168eedd530ec`.
- SHA-256 del contenedor analizado: `6c351ac6ef76fb38c9d0e98d7e459d3d6ddc43aee2a56e19ad32bd0f5947f897`.
- Proveedor: `rea-javascript-application`.
- Operación: `analyze_javascript_application`.
- Resumen exportado: `rea-summary.json`. El reporte completo de trabajo es grande (aprox. 202 MB) y no se incorpora al repositorio de la app ni al deploy.

## Lo observado

La referencia entrega una aplicación Next.js con recursos de imagen para ambientes vacíos/amoblados, selectores de ambientes y estilos, navegación pública, galería, precios y acceso. El diseño observado usa Outfit, fondos azul noche, acentos verdes y fotos comparativas. El flujo público invita a subir una foto sin tarjeta.

## Qué no demuestra REA

El analizador informó cobertura incompleta y límites de memoria/presupuesto en algunos chunks grandes. Las importaciones y relaciones estáticas no prueban que un código se ejecute. No se obtuvo el backend privado, el modelo propietario, sus prompts, controles de facturación o una licencia de sus assets. No se afirma haber reconstruido esos sistemas.

El MVP usa un motor propio por API (OpenAI Images), no los endpoints de la referencia. La selección de Sunburst se basó en la documentación oficial vigente de edición precisa y calidad; no en una extracción del modelo original.

## Segunda pasada: páginas y cuenta autenticada

Se capturaron 22 rutas HTML actuales y se ejecutó REA 6.7.0 sobre ese contenedor sin ejecutar los scripts. Evidence: `ev_e912df00477b969f31d353f51eb15701eeda9276c4875476cb76c6d4dbd04ee1`; SHA-256 `3c7dbdd7c5b05fda7524a961f3f835fa658e423f1bdbe9e56a00726845374f1e`. Resumen: `rea-pages-summary.json`. Se contrastó con navegación real en escritorio/móvil y la sesión autenticada que facilitó el usuario. Cobertura y límites en `AUDIT_2026-10-20.md`. Los scripts inline no analizados y el backend privado siguen fuera de la evidencia estática.
