import type { Guia } from './tipos'

/**
 * Catálogo de guías. Para añadir una: un objeto aquí y, si el paso señala algo
 * sin id ni texto estable, un `data-tour="…"` en el componente (ver
 * `tipos.ts` para las formas del ancla). Nada más: ni tabla, ni seed.
 *
 * Reglas de redacción: segunda persona, una acción por paso, sin markdown, y
 * si hay otra forma de lograr lo mismo desde el chat, se dice en el último
 * paso.
 */
export const GUIAS: readonly Guia[] = [
  {
    id: 'ver-facturas',
    titulo: 'Ver las facturas emitidas',
    descripcion: 'Dónde están las facturas de las liquidaciones y qué muestra cada una.',
    ruta: '/dashboard/liquidaciones-servicios',
    modulo: 'liquidaciones-servicios',
    palabrasClave: ['facturas', 'ver facturas', 'facturas emitidas', 'número de factura', 'consultar factura', 'dónde están las facturas'],
    prioridad: 8,
    pasos: [
      {
        titulo: 'Liquidaciones de servicios',
        texto: 'Las facturas se emiten a partir de liquidaciones, así que viven en esta pantalla.',
        ruta: '/dashboard/liquidaciones-servicios',
        ancla: '@nav-liquidaciones-servicios',
      },
      {
        titulo: 'Pestaña Facturas',
        texto: 'Aquí se cambia a la pestaña de facturas. La abro por ti.',
        ancla: '@liq-tab-facturas',
        accion: 'clic',
      },
      {
        titulo: 'Facturas emitidas',
        texto: 'Cada factura muestra su número, el cliente, las liquidaciones que incluye, el total y si está activa o anulada. Desde la fila puedes ver su detalle o anularla.',
        ancla: '@liq-facturas',
      },
      {
        titulo: 'Desde el chat',
        texto: 'También puedes preguntarme por una factura o por las liquidaciones de un cliente y te traigo los datos sin salir de aquí.',
      },
    ],
  },
  {
    id: 'facturar',
    titulo: 'Facturar liquidaciones',
    descripcion: 'Cómo registrar una factura con una o varias liquidaciones aprobadas.',
    ruta: '/dashboard/liquidaciones-servicios',
    modulo: 'liquidaciones-servicios',
    palabrasClave: ['facturar', 'crear factura', 'nueva factura', 'registrar factura', 'emitir factura', 'facturación', 'cómo facturo'],
    prioridad: 9,
    pasos: [
      {
        titulo: 'Botón Facturar',
        texto: 'Desde la pestaña Liquidaciones, este botón abre el formulario de facturación. Lo abro por ti.',
        // Con la pestaña explícita: el botón solo existe en Liquidaciones y el
        // usuario puede venir de Facturas.
        ruta: '/dashboard/liquidaciones-servicios?tab=liquidaciones',
        ancla: '@liq-btn-facturar',
        accion: 'clic',
      },
      {
        titulo: 'Número de factura',
        texto: 'Escribe el número o consecutivo de la factura tal como lo emitiste (por ejemplo FV-2-5001). Es obligatorio.',
        ancla: '#numero-factura',
      },
      {
        titulo: 'Observaciones',
        texto: 'Opcional: una nota que quede junto a la factura, como la orden de compra o el contacto del cliente.',
        ancla: '#observaciones',
      },
      {
        titulo: 'Buscar liquidaciones',
        texto: 'Si la lista es larga, filtra por consecutivo o por cliente para encontrar las que van en esta factura.',
        ancla: '@fac-buscar',
      },
      {
        titulo: 'Marca las liquidaciones',
        texto: 'Solo aparecen las liquidaciones APROBADAS. Marca las que van en la factura; abajo se suma el total a facturar.',
        ancla: '@fac-tabla',
      },
      {
        titulo: 'Confirmar',
        texto: 'Revisa el total y pulsa Facturar. Las liquidaciones marcadas pasan a FACTURADA y la factura queda en la pestaña Facturas.',
        ancla: '@fac-confirmar',
      },
    ],
  },
  {
    id: 'nuevo-servicio',
    titulo: 'Programar un servicio',
    descripcion: 'Cómo crear un servicio de transporte desde la pantalla o desde el chat.',
    ruta: '/dashboard/servicios',
    modulo: 'servicios',
    nivel: 'full',
    palabrasClave: ['nuevo servicio', 'crear servicio', 'programar servicio', 'registrar servicio', 'agendar servicio', 'solicitar servicio'],
    prioridad: 9,
    pasos: [
      {
        titulo: 'Nuevo servicio',
        texto: 'Este botón abre el formulario de un servicio. Lo abro por ti.',
        ruta: '/dashboard/servicios',
        ancla: '@srv-btn-nuevo',
        accion: 'clic',
      },
      {
        titulo: 'Cliente',
        texto: 'Elige la empresa para la que es el servicio. Si no existe, el botón de al lado la crea sin salir del formulario.',
        ancla: '#cliente',
      },
      {
        titulo: 'Origen',
        texto: 'Municipio de salida y, debajo, el punto exacto (base, hotel, pozo). Si ya se visitó, aparece con sus coordenadas.',
        ancla: '#origen',
      },
      {
        titulo: 'Destino',
        texto: 'Municipio de llegada y su punto exacto, igual que el origen.',
        ancla: '#destino',
      },
      {
        titulo: 'Vehículo',
        texto: 'Opcional: la placa que hará el viaje. Si está en otro servicio o en mantenimiento, el formulario te avisa.',
        ancla: '#vehiculo',
      },
      {
        titulo: 'Conductor',
        texto: 'Opcional: quién conduce. Con conductor y vehículo el servicio nace planificado; si falta alguno, queda solicitado hasta asignarlo.',
        ancla: '#conductor',
      },
      {
        titulo: 'Desde el chat',
        texto: 'También puedes dictármelo: «programa un servicio de FEPCO de Yopal a Villanueva mañana a las 8 con la placa WDS944». Te muestro el resumen y lo creo cuando confirmes; incluso varios de una vez.',
      },
    ],
  },
  {
    id: 'ticket-servicio',
    titulo: 'Ver el ticket de un servicio',
    descripcion: 'Dónde está el ticket (orden de servicio) de cada viaje y cómo abrirlo.',
    ruta: '/dashboard/servicios',
    modulo: 'servicios',
    palabrasClave: ['ticket', 'ticket de servicio', 'orden de servicio', 'abrir ticket', 'ver ticket', 'imprimir ticket'],
    prioridad: 7,
    pasos: [
      {
        titulo: 'Botón Ticket',
        texto: 'En cada fila del listado, este botón abre el ticket del servicio: conductor, vehículo, cliente, origen y destino, listos para compartir.',
        ruta: '/dashboard/servicios',
        ancla: '@srv-btn-ticket',
      },
      {
        titulo: 'Desde el chat',
        texto: 'Si sabes de qué servicio se trata, pídemelo: «ábreme el ticket del servicio de FEPCO de mañana» y lo abro yo.',
      },
    ],
  },
  {
    id: 'conectar-claude',
    titulo: 'Conectar Claude con la app',
    descripcion: 'Cómo crear un token personal para consultar la app desde Claude (MCP).',
    ruta: '/dashboard/perfil',
    modulo: null,
    palabrasClave: ['claude', 'mcp', 'token', 'conectar claude', 'token personal', 'claude desktop', 'claude code'],
    prioridad: 6,
    pasos: [
      {
        titulo: 'Tu perfil',
        texto: 'La conexión con Claude se configura en tu perfil, en la sección Conectar con Claude.',
        ruta: '/dashboard/perfil',
        ancla: '@perfil-claude',
      },
      {
        titulo: 'Crea un token',
        texto: 'Ponle un nombre que te diga dónde lo usas (por ejemplo «Mi portátil») y créalo. El token se muestra una sola vez: cópialo en ese momento.',
        ancla: '@perfil-claude-form',
      },
      {
        titulo: 'Pégalo en Claude',
        texto: 'Con el token copiado, usa los botones de copiar: la URL para Claude Desktop o el comando para Claude Code. Desde ahí Claude (o ChatGPT, con el bloque de abajo) trabaja con tus mismos permisos.',
        ancla: '@perfil-claude-form',
      },
    ],
  },
]

export function buscarGuia(id: string): Guia | undefined {
  return GUIAS.find((g) => g.id === id)
}
