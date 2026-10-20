export type Section = { title: string; body: string; points?: string[] };
export type Resource = {
  slug: string;
  title: string;
  intro: string;
  kind?: string;
  sections: Section[];
};
export const resources: Resource[] = [
  {
    slug: "afiliados",
    title: "Programa de afiliados",
    intro:
      "Recomendá amoblaIA a agentes, fotógrafos e inmobiliarias de tu comunidad.",
    kind: "afiliados",
    sections: [
      {
        title: "Crezcamos con tu comunidad",
        body: "Estamos preparando el programa para quienes recomiendan herramientas de trabajo a profesionales inmobiliarios. Contanos con quiénes trabajás y cómo te gustaría participar.",
      },
      {
        title: "Antes de empezar",
        body: "La inscripción registra tu interés. Las comisiones, el seguimiento y las condiciones se acuerdan antes de activar una colaboración. No hay un programa automático de comisiones habilitado todavía.",
      },
    ],
  },
  {
    slug: "marca-blanca",
    title: "Virtual staging con tu marca",
    intro:
      "Una experiencia de amoblamiento virtual para tu inmobiliaria, red de agentes o plataforma.",
    kind: "marca-blanca",
    sections: [
      {
        title: "Una propuesta para tu negocio",
        body: "Podés usar las imágenes de tus planes pagos en tus publicaciones y presentaciones. Si necesitás integrar la herramienta en tu propio sitio, contanos el alcance y el volumen esperado.",
      },
      {
        title: "Dos formas de trabajar juntos",
        body: "Podemos evaluar una integración para tu plataforma o una experiencia con tu identidad visual. El servicio de marca blanca se cotiza y habilita por separado; no viene incluido automáticamente en los planes de fotos.",
        points: [
          "Identidad de tu empresa y recorrido de tus clientes",
          "Volumen mensual y estilos que necesita tu catálogo",
          "Condiciones de acceso, soporte y uso de imágenes",
        ],
      },
    ],
  },
  {
    slug: "api",
    title: "API de amoblaIA",
    intro: "Llevá el amoblamiento virtual a tu plataforma inmobiliaria.",
    kind: "api",
    sections: [
      {
        title: "Pensada para integraciones",
        body: "Si administrás un portal, un CRM o una red de inmobiliarias, contanos qué querés automatizar. Evaluamos juntos el volumen de fotos, los tiempos y la forma de entregar resultados.",
      },
      {
        title: "Solicitá acceso",
        body: "La API para terceros se habilita por acuerdo. Esta solicitud no genera una clave ni autoriza consumos. El estudio y las descargas de tus planes están disponibles desde tu cuenta de amoblaIA.",
      },
    ],
  },
  {
    slug: "trabaja-con-nosotros",
    title: "Construyamos lo que viene",
    intro:
      "Nos interesan las personas que conocen el mundo inmobiliario y disfrutan de hacer productos simples.",
    kind: "empleo",
    sections: [
      {
        title: "Qué estamos construyendo",
        body: "amoblaIA ayuda a mostrar el potencial de las propiedades con fotos amobladas digitalmente. El foco está en profesionales y propietarios de Argentina y Latinoamérica.",
      },
      {
        title: "Contanos qué hacés",
        body: "No hay búsquedas publicadas en este momento. Podés presentarte para futuras colaboraciones en producto, diseño, tecnología o desarrollo comercial. No hace falta enviar documentos de identidad ni información sensible.",
      },
    ],
  },
  {
    slug: "reembolsos",
    title: "Solicitá una revisión de tu pago",
    intro:
      "Dejanos la referencia de Mercado Pago y el detalle. Tu solicitud queda registrada con un número de seguimiento.",
    kind: "reembolso",
    sections: [
      {
        title: "Antes de enviar",
        body: "Podés ver la referencia y el estado de tus pagos en Mi cuenta. Si querés detener próximas renovaciones, usá Cancelar renovación; eso conserva el período ya pagado.",
      },
      {
        title: "Arrepentimiento de compra",
        body: "Para ejercer el derecho de arrepentimiento, tenés un formulario específico en Soporte. Las solicitudes se revisan conforme a las condiciones del servicio y los derechos aplicables.",
      },
    ],
  },
  {
    slug: "licencia-de-imagenes",
    title: "Uso de tus imágenes",
    intro:
      "Qué podés hacer con los resultados y qué debés revisar antes de publicar.",
    sections: [
      {
        title: "Publicaciones y presentaciones",
        body: "Podés usar los diseños que generás en avisos inmobiliarios, redes, propuestas y presentaciones. Debés contar con permiso para procesar y utilizar la foto original.",
      },
      {
        title: "La propiedad tiene que seguir siendo reconocible",
        body: "Compará el resultado con el original. Revisá pisos, ventanas, puertas, medidas aparentes y artefactos fijos. Una imagen con errores no debe publicarse como si fuera una representación fiel de la propiedad.",
      },
      {
        title: "Indicá el amoblamiento virtual",
        body: "Informá que los muebles se agregaron digitalmente. El estudio permite incluir una etiqueta al descargar. La versión gratuita además incluye una marca de agua; el acceso pago permite crear nuevos resultados sin ella.",
      },
    ],
  },
  {
    slug: "como-hacer-virtual-staging",
    title: "Cómo hacer virtual staging",
    intro:
      "De una foto de la propiedad a una imagen lista para presentar, en tres pasos.",
    sections: [
      {
        title: "1. Prepará una buena foto",
        body: "Abrí cortinas, encendé las luces necesarias y tomá la foto a una altura natural. Evitá inclinar el teléfono: las verticales derechas ayudan a interpretar el ambiente. No incluyas personas ni documentos.",
      },
      {
        title: "2. Elegí ambiente y estilo",
        body: "Subí el original al estudio. Elegí el tipo de ambiente y un estilo acorde a la propiedad. Usá Amoblar para un espacio vacío, Rediseñar para renovar muebles y Vaciar para retirarlos.",
      },
      {
        title: "3. Revisá y descargá",
        body: "Compará con el original, elegí tu propuesta y descargá el JPG. También podés armar un antes y después. Antes de publicar, verificá que el resultado conserve la arquitectura e informá que tiene amoblamiento virtual.",
      },
    ],
  },
  {
    slug: "precios-virtual-staging",
    title: "Cuánto cuesta amoblar una foto",
    intro:
      "Elegí un cupo acorde a las propiedades que publicás, con precios en pesos argentinos.",
    sections: [
      {
        title: "Fotos originales y resultados",
        body: "Los planes se miden por fotos originales. Cada una incluye regeneraciones durante la vigencia paga y podés volver a descargar sus resultados. La versión gratuita ofrece 25 resultados en total con marca de agua.",
      },
      {
        title: "Mensual o anual",
        body: "El plan mensual se renueva por mes. En el anual pagás el año completo y el cupo se habilita mes a mes. El precio final, el ahorro y el importe anual se muestran en Precios antes de comprar.",
      },
      {
        title: "Qué mirar al comparar",
        body: "Además del precio, revisá cuántas fotos incluye cada plan, la calidad de descarga, el límite de variantes y el acceso a ambientes y funciones. Elegí según tu uso habitual, sin pagar por un volumen que no necesitás.",
      },
    ],
  },
  {
    slug: "virtual-staging-con-ia",
    title: "Virtual staging con inteligencia artificial",
    intro:
      "Una forma de mostrar cómo se puede habitar un espacio, usando la foto real como punto de partida.",
    sections: [
      {
        title: "Qué cambia en la foto",
        body: "La IA propone muebles, textiles y decoración acordes al ambiente. El objetivo es conservar paredes, aberturas, pisos y perspectiva. Siempre hace falta una revisión humana del resultado.",
      },
      {
        title: "Para quién sirve",
        body: "Agentes que publican propiedades vacías, fotógrafos que entregan una propuesta visual e inmobiliarias que quieren presentar alternativas para sus clientes. También sirve para explorar estilos de un espacio propio.",
      },
      {
        title: "Qué no reemplaza",
        body: "Una foto amoblada no es un plano, una medición ni una garantía de que los muebles entren. Tampoco reemplaza la visita a la propiedad. Usala como una herramienta visual y señalá la edición.",
      },
    ],
  },
  {
    slug: "amoblar-departamentos",
    title: "Amoblamiento virtual para departamentos",
    intro:
      "Mostrá el uso posible de un living, un dormitorio o un monoambiente sin llenar la foto de objetos.",
    sections: [
      {
        title: "Escala antes que cantidad",
        body: "En departamentos chicos, pocos muebles bien proporcionados explican mejor el espacio. Pedí circulación clara, muebles de escala realista y una distribución que respete puertas y ventanas.",
      },
      {
        title: "Estilos que acompañan la propiedad",
        body: "Los tonos cálidos y la madera funcionan en muchos espacios, pero no hay una única estética. Podés probar nórdico, industrial, clásico renovado o ecléctico según la arquitectura y el público de la propiedad.",
      },
      {
        title: "Monoambientes y balcones",
        body: "El estudio incluye opciones específicas para monoambientes y exteriores en los planes pagos. No agregues divisiones, parrillas o cerramientos que no existen: el amoblamiento debe acompañar el espacio real.",
      },
    ],
  },
  {
    slug: "alternativas-virtual-staging",
    title: "Cómo elegir una herramienta de virtual staging",
    intro:
      "Compará el proceso completo: carga, variantes, revisión, descarga y costo por foto.",
    sections: [
      {
        title: "Trabajo manual o generación con IA",
        body: "Un servicio de diseño manual puede ofrecer revisiones personalizadas y una herramienta con IA permite explorar propuestas de forma directa. El recorrido que más te conviene depende del volumen y la precisión que necesitás.",
      },
      {
        title: "Probá con tu propio original",
        body: "Elegí una foto representativa y compará la fidelidad arquitectónica. Mirá sombras, perspectivas y tamaño de muebles; una escena atractiva de ejemplo no asegura el mismo resultado con otra propiedad.",
      },
      {
        title: "Revisá el alcance antes de pagar",
        body: "En amoblaIA podés probar 25 resultados gratuitos con marca de agua. Los planes pagos suman todos los ambientes y estilos, retiro de muebles y nuevos resultados sin marca de agua. El detalle y el cupo están en Precios.",
      },
    ],
  },
];
export const articles = [
  {
    slug: "fotos-inmobiliarias-con-el-celular",
    title: "Cómo sacar mejores fotos de una propiedad con el celular",
    category: "Fotografía",
    image: "living-before",
    intro:
      "La calidad del original cambia la calidad de la propuesta. Una guía práctica para preparar la próxima sesión.",
    sections: [
      {
        title: "Ordená la escena",
        body: "Retirá objetos personales y despejá mesadas y mesas. Una foto legible ayuda a ver la circulación y también facilita el amoblamiento virtual. Evitá que entren personas o documentos en el encuadre.",
      },
      {
        title: "Buscá una luz pareja",
        body: "Fotografiá de día, abrí cortinas y evitá apuntar directamente contra una ventana muy luminosa. Probá dos posiciones antes de elegir la toma: una pequeña variación puede mostrar mucho mejor la profundidad.",
      },
      {
        title: "Cuidá las verticales",
        body: "Sostené el teléfono recto y usá la cuadrícula de la cámara. Si podés, apoyalo o usá un trípode. Evitá el gran angular extremo que estira las esquinas y hace difícil juzgar la escala real.",
      },
      {
        title: "Elegí antes de subir",
        body: "Conservá el original y elegí las tomas que explican mejor cada ambiente. No hace falta amoblar todas las fotos: un living y un dormitorio bien resueltos pueden mostrar la propuesta de uso del departamento.",
      },
    ],
  },
  {
    slug: "virtual-staging-para-inmobiliarias",
    title: "Virtual staging para inmobiliarias: del original a la publicación",
    category: "Virtual staging",
    image: "living-modern",
    intro:
      "Un recorrido para incorporar el amoblamiento virtual al trabajo diario de una inmobiliaria.",
    sections: [
      {
        title: "Empezá por las propiedades vacías",
        body: "Elegí publicaciones donde cueste entender el uso o la escala de un ambiente. La foto amoblada puede acompañar al original para presentar una posibilidad de distribución.",
      },
      {
        title: "Definí una línea visual",
        body: "Acordá un criterio con el equipo. Podés mantener una paleta coherente sin usar el mismo estilo para todas las propiedades. Una casa de campo y un departamento urbano pueden necesitar propuestas diferentes.",
      },
      {
        title: "Revisá antes de entregar",
        body: "Compará cada resultado contra la foto original. Verificá que los muebles no bloqueen pasos y que las ventanas y elementos fijos sigan en su lugar. Descartá los resultados con errores visibles.",
      },
      {
        title: "Mostrá el antes y después",
        body: "Usá ambas imágenes y una etiqueta clara de amoblamiento virtual. Guardá los originales y los JPG finales en el proyecto de la propiedad para que todo el equipo trabaje con la misma versión.",
      },
    ],
  },
  {
    slug: "estilos-para-departamentos-argentinos",
    title:
      "Diez estilos para propiedades argentinas, sin caer en una sola estética",
    category: "Estilos",
    image: "bedroom-eclectic",
    intro:
      "De nórdico a ecléctico: cómo elegir una propuesta que acompañe al espacio y a quien podría habitarlo.",
    sections: [
      {
        title: "Leé la arquitectura",
        body: "El piso, las molduras, las aberturas y la luz ya cuentan una parte de la historia. Un clásico renovado puede acompañar un departamento antiguo; una propuesta contemporánea también puede funcionar si respeta sus proporciones.",
      },
      {
        title: "No todo tiene que ser beige",
        body: "Las paletas neutras ayudan a leer el espacio, pero los colores y las piezas con carácter también pueden convivir con una publicación clara. El estilo ecléctico mezcla épocas y texturas con una paleta coherente.",
      },
      {
        title: "Elegí materiales y escala",
        body: "En el estudio podés agregar indicaciones: madera clara, textiles naturales, acentos de color o pocos objetos. Pedí muebles de tamaño realista y circulación libre, en lugar de una lista larga de elementos.",
      },
      {
        title: "Probá alternativas sobre el mismo original",
        body: "Compará dos propuestas y mirá cuál explica mejor el ambiente. El objetivo de una publicación es mostrar cómo se puede habitar la propiedad; la decoración tiene que ayudar a esa lectura.",
      },
    ],
  },
  {
    slug: "amoblar-un-monoambiente",
    title: "Cómo mostrar el potencial de un monoambiente",
    category: "Ambientes",
    image: "bedroom-modern",
    intro:
      "Zonas claras y muebles proporcionados para que un espacio chico se entienda de un vistazo.",
    sections: [
      {
        title: "Definí usos con muebles",
        body: "Una mesa pequeña, una alfombra o la orientación de un sofá pueden sugerir zonas sin agregar tabiques. La IA debe conservar la planta real y mantener despejados los accesos.",
      },
      {
        title: "Evitá sumar por sumar",
        body: "Una cama de tamaño excesivo o una mesa para demasiadas personas distorsionan la percepción del ambiente. Priorizá los usos centrales y dejá espacio visual alrededor de los muebles.",
      },
      {
        title: "Elegí una toma amplia y natural",
        body: "Una foto desde una esquina puede explicar la relación entre el sector de estar, la cocina y la ventana. Cuidá que el lente no haga parecer el espacio mucho más grande de lo que es.",
      },
      {
        title: "Revisá la distribución",
        body: "La imagen es una propuesta visual, no una medición. Comprobá tamaños y pasos con el plano o en la propiedad antes de sugerir una distribución definitiva al comprador.",
      },
    ],
  },
  {
    slug: "publicar-imagenes-amobladas-con-ia",
    title: "Antes de publicar una imagen amoblada con IA",
    category: "Buenas prácticas",
    image: "living-eclectic",
    intro:
      "Una lista breve para revisar fidelidad, claridad y contexto antes de subir el aviso.",
    sections: [
      {
        title: "Conservá el original",
        body: "Guardá la foto sin edición y usala como referencia. Al mostrar ambas versiones, el comprador puede distinguir el estado actual del espacio y la propuesta de amoblamiento.",
      },
      {
        title: "Revisá elementos permanentes",
        body: "Prestá atención a puertas, ventanas, pisos, techos y artefactos fijos. Los modelos pueden cometer errores. Si aparece un cambio que no existe en la propiedad, elegí otra propuesta o descartá esa imagen.",
      },
      {
        title: "Señalá la edición",
        body: "Incluí una leyenda de amoblamiento virtual y revisá las reglas del portal donde vas a publicar. En amoblaIA podés agregar esa etiqueta desde las opciones de descarga.",
      },
      {
        title: "No ocultes problemas",
        body: "El objetivo es mostrar el uso posible de un ambiente. Evitá imágenes que tapen deterioros o conviertan una instalación inexistente en una aparente característica de la propiedad.",
      },
    ],
  },
  {
    slug: "elegir-un-plan-de-virtual-staging",
    title: "Cómo elegir el cupo de fotos para tu inmobiliaria",
    category: "Herramientas",
    image: "bedroom-modern",
    intro:
      "Estimá el volumen de originales que necesitás por mes y compará el alcance de cada plan.",
    sections: [
      {
        title: "Contá originales, no descargas",
        body: "Calculá cuántas propiedades preparás y cuántos ambientes amoblás en cada una. Las descargas repetidas no consumen fotos y los originales pagos incluyen regeneraciones durante la vigencia del período.",
      },
      {
        title: "Tomá un mes habitual como referencia",
        body: "Un pico de publicaciones puede no representar tu uso de todo el año. Empezá con un cupo acorde al trabajo que podés sostener y revisá la elección después de usarlo.",
      },
      {
        title: "Compará mensual y anual",
        body: "El anual tiene un cobro completo por adelantado y habilita las fotos mes a mes. Mirá el importe total además de su equivalente mensual y el descuento mostrado en Precios.",
      },
      {
        title: "Probá el flujo primero",
        body: "Podés explorar los ejemplos y crear hasta 25 resultados gratuitos con marca de agua. Eso permite conocer las opciones y revisar el resultado con una foto propia antes de contratar.",
      },
    ],
  },
] as const;
