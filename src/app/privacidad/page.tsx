import Link from "next/link";
export default function Privacy() {
  return (
    <article className="legal-page container">
      <span className="eyebrow">TUS FOTOS, CON CLARIDAD</span>
      <h1>Privacidad</h1>
      <p>Actualización: 23 de octubre de 2026.</p>
      <h2>Cuenta y proyectos</h2>
      <p>
        Cuando las cuentas están habilitadas, guardamos tu identificador, email,
        fotos originales optimizadas, indicaciones de diseño, variantes y
        registros de uso en Supabase. Las imágenes están en un espacio privado y
        se entregan mediante enlaces temporales. Los ejemplos demo y el
        historial del piloto pueden guardarse localmente en tu navegador.
      </p>
      <h2>Prueba sin registro</h2>
      <p>
        Podés generar sin ingresar email ni usar Google. Una sesión técnica
        anónima conserva tus resultados y el uso del cupo en este navegador.
        Guardamos una huella protegida del origen de las solicitudes para
        limitar el abuso. Si ingresás a una cuenta, vinculamos esas fotos y el
        consumo de la prueba. No se publica tu dirección IP.
      </p>
      <h2>Procesamiento con IA</h2>
      <p>
        Al generar con una foto propia, enviamos la imagen, el ambiente, el
        estilo y tus indicaciones a un proveedor externo de inteligencia
        artificial, que las procesa por cuenta nuestra para crear el resultado
        solicitado. Debés tener permiso para procesar la fotografía. Evitá
        incluir personas, documentos, direcciones visibles u otros datos
        innecesarios. El tratamiento del proveedor se rige también por sus
        políticas.
      </p>
      <h2>Borradores y consultas</h2>
      <p>
        La foto seleccionada y tus opciones pueden guardarse temporalmente en tu
        navegador para conservarlas durante el acceso. El borrador vence a las
        24 horas y se elimina al descartarlo o cerrar sesión. Las consultas de
        soporte, solicitudes comerciales y suscripciones voluntarias al
        newsletter guardan el email, el contenido enviado, el consentimiento y
        un identificador de seguimiento. Usamos una huella del origen de las
        solicitudes para limitar el abuso; no publicamos esos datos.
      </p>
      <h2>Pagos y créditos</h2>
      <p>
        Mercado Pago procesa los pagos. No guardamos datos completos de
        tarjetas. Conservamos referencias, importes, estados de pago,
        suscripciones y movimientos de fotos para prestar el servicio, atender
        reclamos y cumplir las obligaciones aplicables.
      </p>
      <h2>Acceso y seguridad</h2>
      <p>
        El acceso a las cuentas usa cookies técnicas de sesión. Si elegís
        ingresar con Google, se solicitan datos básicos de identidad, email y
        perfil. No solicitamos acceso a tu correo ni a tus archivos de Google.
        La versión de piloto usa una cookie de acceso compartido que vence a las
        ocho horas.
      </p>
      <h2>Medición de publicidad</h2>
      <p>
        Usamos la etiqueta de Google Ads para saber si una visita que llegó
        desde un anuncio terminó subiendo una foto. Google puede guardar cookies
        propias para medir esa conversión. No le enviamos tus fotos, tu email ni
        el contenido de tus proyectos.
      </p>
      <h2>Conservación y eliminación</h2>
      <p>
        Podés descargar y borrar tus proyectos desde el estudio. No se pueden
        borrar imágenes mientras haya una generación en curso o en revisión. Los
        registros de pagos y movimientos pueden conservarse durante los plazos
        legales aplicables. Los enlaces de imágenes ya emitidos pueden seguir
        funcionando hasta su vencimiento. Los datos locales se eliminan desde el
        navegador.
      </p>
      <h2>Tu control y contacto</h2>
      <p>
        Para consultar, corregir o solicitar la eliminación de datos de tu
        cuenta, usá el canal publicado en <Link href="/ayuda">Soporte</Link>.
        Los datos identificatorios del responsable y su contacto comercial deben
        estar completos antes de habilitar ventas.
      </p>
    </article>
  );
}
