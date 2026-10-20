export default function Privacy() {
  return (
    <article className="legal-page container">
      <span className="eyebrow">TUS FOTOS, CON CLARIDAD</span>
      <h1>Privacidad del piloto</h1>
      <p>Actualización: 20 de octubre de 2026.</p>
      <h2>Qué guardamos</h2>
      <p>
        Los proyectos, las fotos originales optimizadas y los resultados se
        guardan en IndexedDB en este navegador. Se conservan hasta 20 proyectos.
        No se sincronizan entre dispositivos. Podés borrar un proyecto desde Mis
        proyectos o eliminar los datos del sitio desde tu navegador.
      </p>
      <h2>Qué se envía al generar</h2>
      <p>
        Cuando usás una foto propia y confirmás la generación, el servidor envía
        la imagen optimizada, el ambiente, el estilo y tus indicaciones a
        OpenAI. La foto se procesa en memoria y este MVP no la almacena en una
        base de datos del servidor. Los ejemplos demo se procesan localmente y
        no llaman a la API de imágenes.
      </p>
      <h2>El proveedor y la infraestructura</h2>
      <p>
        El procesamiento del proveedor está sujeto a las condiciones y políticas
        de OpenAI. El proveedor de hosting puede conservar registros técnicos de
        las solicitudes, como IP y fecha. Evitá subir imágenes con personas,
        documentos, direcciones visibles u otros datos que no sean necesarios.
      </p>
      <h2>Acceso al piloto</h2>
      <p>
        El acceso a la generación usa una cookie técnica HttpOnly, con SameSite
        estricto, que vence a las 8 horas. No incluimos herramientas
        publicitarias, analítica ni cookies de seguimiento en esta versión.
      </p>
      <h2>Tu control</h2>
      <p>
        Subí únicamente imágenes que tengas permiso de procesar. Podés descargar
        tus resultados, borrar proyectos y cerrar la sesión. Esta política
        describe el MVP; el operador debe completar sus datos de contacto antes
        de abrir un servicio comercial.
      </p>
    </article>
  );
}
