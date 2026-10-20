import Link from "next/link";
export default function Terms() {
  const name = process.env.SELLER_NAME,
    cuit = process.env.SELLER_CUIT;
  return (
    <article className="legal-page container">
      <span className="eyebrow">ANTES DE PUBLICAR</span>
      <h1>Términos de uso</h1>
      <p>Actualización: 20 de octubre de 2026.</p>
      <h2>Prestador y alcance</h2>
      <p>
        {name
          ? `El servicio es prestado por ${name}${cuit ? `, CUIT ${cuit}` : ""}. `
          : "El servicio se encuentra en preparación comercial. "}
        amoblaIA permite amoblar, rediseñar o vaciar fotografías de propiedades
        con inteligencia artificial. Los productos con cobro solo están
        disponibles cuando su precio y el checkout están habilitados. Los
        canales de contacto están en <Link href="/ayuda">Soporte</Link>.
      </p>
      <h2>Qué incluye una foto</h2>
      <p>
        Cada foto original incluye hasta tres resultados en total, combinando
        estilos y operaciones. Las descargas no consumen fotos. Una falla
        técnica confirmada devuelve la foto reservada cuando corresponde. Si el
        proveedor pudo haber procesado una solicitud pero no recibimos su
        resultado, la generación queda en revisión; no se vuelve a enviar
        automáticamente.
      </p>
      <h2>Packs, suscripciones y renovaciones</h2>
      <p>
        Los packs se pagan una vez y sus fotos no vencen. Las suscripciones
        habilitan un cupo por mes que no se acumula al siguiente período. Los
        planes anuales se cobran completos por adelantado y habilitan el cupo
        mes a mes. El importe, frecuencia y alcance se muestran antes de la
        compra, en pesos argentinos.
      </p>
      <p>
        Podés cancelar futuras renovaciones desde{" "}
        <Link href="/cuenta">Mi cuenta</Link>. Conservás el período ya pagado.
        Las fotos adicionales compradas en packs mantienen sus condiciones. Una
        autorización de suscripción o un regreso desde el checkout no acredita
        fotos: se requiere verificar el pago aprobado.
      </p>
      <h2>Reembolsos, bajas y arrepentimiento</h2>
      <p>
        Podés solicitar una revisión de pago, una baja o ejercer el derecho de
        arrepentimiento que corresponda mediante{" "}
        <Link href="/ayuda">Soporte y solicitudes</Link>. Cada solicitud se
        atenderá conforme a la normativa argentina aplicable, considerando el
        tipo de servicio y su ejecución. La cancelación de renovación no implica
        por sí sola el reembolso del período actual. Los derechos legales del
        consumidor prevalecen sobre estas condiciones.
      </p>
      <h2>Proyectos y disponibilidad</h2>
      <p>
        El límite inicial es de 150 originales guardados por cuenta. Podés
        borrar proyectos para liberar espacio. Descargá los resultados que
        necesites conservar. No ofrecemos almacenamiento perpetuo. Puede haber
        límites de capacidad y pausas ante incidencias o consumos anómalos; el
        equipo atiende esos casos a través de soporte.
      </p>
      <h2>Imágenes y publicación</h2>
      <p>
        Debés contar con los derechos necesarios para subir cada foto. La IA
        puede alterar detalles aunque reciba instrucciones de conservarlos:
        revisá siempre el resultado frente al original. Informá que el
        amoblamiento es virtual y cumplí las reglas del portal donde publiques.
        No uses la imagen para ocultar daños o presentar características físicas
        inexistentes como reales.
      </p>
      <p>
        La galería contiene escenas ficticias originales creadas con IA para
        ilustrar estilos. No constituye un portfolio de trabajos de clientes ni
        una garantía de resultados sobre una propiedad determinada.
      </p>
      <h2>Uso de la cuenta</h2>
      <p>
        Protegé tu acceso. No automatices altas para obtener pruebas gratuitas,
        compartas cuentas para eludir cupos ni intentes acceder a proyectos de
        otras personas. Las incidencias de pagos, contracargos o uso indebido
        pueden requerir una revisión de la cuenta. El equipo mantiene un
        registro de los ajustes de saldo y su motivo.
      </p>
    </article>
  );
}
