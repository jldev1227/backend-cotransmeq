import { createHash, randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
import type {
  ImportarEnviosFormulariosInput,
  PrevisualizarImportacionFormulariosInput,
} from "./formularios-importacion.schema";

type PrismaAny = any;
type Empresa = "TRANSMERALDA" | "COTRANSMEQ";
type AdjuntosS3 = { origen: string; destino: string; client: S3Client };

const INCLUDE_ENVIO = {
  version: {
    include: {
      form: true,
      sections: { orderBy: { sort_order: "asc" } },
      fields: {
        include: { options: { orderBy: { sort_order: "asc" } } },
        orderBy: { sort_order: "asc" },
      },
    },
  },
  assignment: true,
  conductor: {
    select: {
      id: true,
      nombre: true,
      apellido: true,
      tipo_identificacion: true,
      numero_identificacion: true,
    },
  },
  vehiculo: {
    select: {
      id: true,
      placa: true,
      clase_vehiculo: true,
      marca: true,
      linea: true,
      modelo: true,
      deleted_at: true,
    },
  },
  usuario: { select: { id: true, nombre: true, correo: true } },
  answers: {
    include: {
      field: true,
      options: { include: { option: true } },
      attachments: true,
    },
  },
  attachments: true,
  events: { orderBy: { created_at: "asc" } },
} as const;

function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/// En Json? Prisma interpreta `null` como el literal JSON; `DbNull` conserva NULL de SQL.
function normalizarJsonNulo(valor: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return valor === null || valor === undefined
    ? Prisma.DbNull
    : (valor as Prisma.InputJsonValue);
}

function plano(valor: any): any {
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === "bigint") return valor.toString();
  if (
    valor &&
    typeof valor === "object" &&
    typeof valor.toString === "function" &&
    valor.constructor?.name === "Decimal"
  )
    return valor.toString();
  if (Array.isArray(valor)) return valor.map(plano);
  if (valor && typeof valor === "object")
    return Object.fromEntries(
      Object.keys(valor)
        .sort()
        .map((k) => [k, plano(valor[k])]),
    );
  return valor;
}

function serializar(valor: unknown): string {
  return JSON.stringify(plano(valor));
}

function huella(valor: unknown): string {
  return createHash("sha256").update(serializar(valor)).digest("hex");
}

function estructuraVersion(version: any): unknown {
  const secciones = [...(version.sections ?? [])].sort(
    (a, b) => a.sort_order - b.sort_order,
  );
  const campos = [...(version.fields ?? [])];
  const campoPorId = new Map(campos.map((campo) => [campo.id, campo]));
  return {
    form: { code: version.form.code },
    version: {
      status: version.status,
      title: version.title,
      description: version.description,
      instructions: version.instructions,
      settings_json: version.settings_json,
      sections: secciones.map((section) => ({
        key: section.key,
        title: section.title,
        description: section.description,
        sort_order: section.sort_order,
        settings_json: section.settings_json,
      })),
      fields: [...campos]
        .sort(
          (a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key),
        )
        .map((field) => ({
          section:
            secciones.find((section) => section.id === field.section_id)?.key ??
            null,
          parent: field.parent_field_id
            ? (campoPorId.get(field.parent_field_id)?.key ?? null)
            : null,
          key: field.key,
          type: field.type,
          label: field.label,
          help_text: field.help_text,
          placeholder: field.placeholder,
          required: field.required,
          sort_order: field.sort_order,
          config_json: field.config_json,
          validation_json: field.validation_json,
          visibility_rule_json: field.visibility_rule_json,
          default_value_json: field.default_value_json,
          options: [...(field.options ?? [])]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((option) => ({
              value: option.value,
              label: option.label,
              color: option.color,
              score: option.score,
              sort_order: option.sort_order,
              metadata_json: option.metadata_json,
            })),
        })),
    },
  };
}

function huellaEnvio(envio: any): string {
  return huella({
    id: envio.id,
    status: envio.status,
    business_date: envio.business_date,
    period_key: envio.period_key,
    service_id: envio.service_id,
    supersedes_submission_id: envio.supersedes_submission_id,
    context_json: envio.context_json,
    device_json: envio.device_json,
    started_at: envio.started_at,
    updated_at: envio.updated_at,
    submitted_at: envio.submitted_at,
    voided_at: envio.voided_at,
    void_reason: envio.void_reason,
    actor: envio.conductor
      ? {
          tipo: envio.conductor.tipo_identificacion,
          numero: envio.conductor.numero_identificacion,
          nombre: envio.conductor.nombre,
          apellido: envio.conductor.apellido,
        }
      : { correo: envio.usuario?.correo },
    vehicle: envio.vehiculo
      ? { placa: envio.vehiculo.placa, clase: envio.vehiculo.clase_vehiculo }
      : null,
    assignment: {
      id: envio.assignment.id,
      name: envio.assignment.name,
      frequency: envio.assignment.frequency,
      limit_policy: envio.assignment.limit_policy,
      timezone: envio.assignment.timezone,
      context_schema_json: envio.assignment.context_schema_json,
      settings_json: envio.assignment.settings_json,
    },
    version: estructuraVersion(envio.version),
    answers: [...(envio.answers ?? [])]
      .sort(
        (a, b) =>
          a.field.key.localeCompare(b.field.key) ||
          (a.row_index ?? -1) - (b.row_index ?? -1) ||
          String(a.occurrence_id ?? "").localeCompare(
            String(b.occurrence_id ?? ""),
          ),
      )
      .map((answer) => ({
        field: answer.field.key,
        occurrence_id: answer.occurrence_id,
        row_index: answer.row_index,
        value_text: answer.value_text,
        value_decimal: answer.value_decimal,
        value_boolean: answer.value_boolean,
        value_date: answer.value_date,
        value_datetime: answer.value_datetime,
        value_json: answer.value_json,
        options: [...(answer.options ?? [])]
          .map((entry) => entry.option.value)
          .sort(),
        attachments: [...(answer.attachments ?? [])]
          .map((attachment) => ({
            id: attachment.id,
            sha256: attachment.sha256,
            byte_size: attachment.byte_size,
            object_key: attachment.object_key,
            status: attachment.status,
            answer_id: attachment.answer_id,
            kind: attachment.kind,
            mime_type: attachment.mime_type,
            original_name: attachment.original_name,
            metadata_json: attachment.metadata_json,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      })),
    attachments: [...(envio.attachments ?? [])]
      .map((attachment) => ({
        id: attachment.id,
        sha256: attachment.sha256,
        byte_size: attachment.byte_size,
        object_key: attachment.object_key,
        status: attachment.status,
        answer_id: attachment.answer_id,
        kind: attachment.kind,
        mime_type: attachment.mime_type,
        original_name: attachment.original_name,
        metadata_json: attachment.metadata_json,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: (envio.events ?? []).map((event: any) => ({
      event_type: event.event_type,
      actor_type: event.actor_type,
      actor_id: event.actor_id,
      payload_json: event.payload_json,
      created_at: event.created_at,
    })),
  });
}

function bucketOrigen(config: ImportadorConfig): string {
  return String(process.env[config.variableBucketOrigen] ?? "").trim();
}

function clienteS3(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION || "us-east-2" });
}

function errorConCodigo(
  code: string,
  message: string,
): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function resumirEnvio(envio: any) {
  return {
    id: envio.id,
    formCode: envio.version.form.code,
    formName: envio.version.form.name,
    formVersion: envio.version.version_number,
    formTitle: envio.version.title,
    status: envio.status,
    businessDate: envio.business_date,
    submittedAt: envio.submitted_at,
    driver: envio.conductor
      ? {
          id: envio.conductor.id,
          nombre:
            `${envio.conductor.nombre} ${envio.conductor.apellido}`.trim(),
          tipoIdentificacion: envio.conductor.tipo_identificacion,
          numeroIdentificacion: envio.conductor.numero_identificacion,
        }
      : envio.usuario
        ? {
            id: envio.usuario.id,
            nombre: envio.usuario.nombre,
            correo: envio.usuario.correo,
          }
        : null,
    vehicle: envio.vehiculo
      ? {
          id: envio.vehiculo.id,
          placa: envio.vehiculo.placa,
          clase: envio.vehiculo.clase_vehiculo,
        }
      : null,
    answers: envio.answers.length,
    attachments: envio.attachments.length,
  };
}

export interface ImportadorConfig {
  empresaLocal: Empresa;
  empresaOrigen: Empresa;
  variableBucketOrigen: string;
  local: PrismaAny;
  origen: PrismaAny;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function enriquecerVehiculosContexto(envios: any[], origen: PrismaAny) {
  const idsPorEnvio = new Map<string, string>();
  for (const envio of envios) {
    if (envio.vehiculo) continue;
    const vehicleId = (envio.context_json as any)?.vehicleId;
    if (typeof vehicleId !== "string" || !vehicleId.trim()) continue;
    if (!UUID_PATTERN.test(vehicleId)) {
      envio.contextVehicleUnresolved = true;
      continue;
    }
    idsPorEnvio.set(envio.id, vehicleId);
  }
  if (!idsPorEnvio.size) return;
  const vehiculos = await origen.vehiculos.findMany({
    where: { id: { in: [...new Set(idsPorEnvio.values())] } },
    select: {
      id: true,
      placa: true,
      clase_vehiculo: true,
      marca: true,
      linea: true,
      modelo: true,
      deleted_at: true,
    },
  });
  const porId = new Map(
    vehiculos.map((vehiculo: any) => [vehiculo.id, vehiculo]),
  );
  for (const envio of envios) {
    const vehicleId = idsPorEnvio.get(envio.id);
    if (!vehicleId) continue;
    const vehicle = porId.get(vehicleId);
    if (vehicle) envio.vehiculo = vehicle;
    else envio.contextVehicleUnresolved = true;
  }
}

async function cargarEnvioOrigen(
  config: ImportadorConfig,
  submissionId: string,
) {
  const envio = await config.origen.form_submission.findUnique({
    where: { id: submissionId },
    include: INCLUDE_ENVIO,
  });
  if (envio) await enriquecerVehiculosContexto([envio], config.origen);
  return envio;
}

function crearContextoImportado(
  envio: any,
  vehicleId: string | null,
  empresaOrigen: Empresa,
) {
  const original =
    envio.context_json &&
    typeof envio.context_json === "object" &&
    !Array.isArray(envio.context_json)
      ? ({ ...envio.context_json } as Record<string, any>)
      : {};
  const sourceVehicleId = envio.vehicle_id ?? original.vehicleId ?? null;
  const sourceServiceId = envio.service_id ?? original.serviceId ?? null;
  if (vehicleId) original.vehicleId = vehicleId;
  else delete original.vehicleId;
  delete original.serviceId;
  original.crossCompanyImport = {
    sourceCompany: empresaOrigen,
    sourceSubmissionId: envio.id,
    sourceFormId: envio.version.form.id,
    sourceVersionId: envio.version.id,
    sourceAssignmentId: envio.assignment.id,
    sourceServiceId,
    sourceDriverId: envio.conductor_id ?? null,
    sourceVehicleId,
    sourceUserId: envio.usuario_id ?? null,
    sourceSupersedesSubmissionId: envio.supersedes_submission_id ?? null,
  };
  return original;
}

async function buscarConductores(
  cliente: PrismaAny,
  conductores: any[],
): Promise<Map<string, any>> {
  const claves = [
    ...new Set(
      conductores
        .map((conductor) => normalizar(conductor.numero_identificacion))
        .filter(Boolean),
    ),
  ];
  if (!claves.length) return new Map();
  const filas = await cliente.$queryRaw(Prisma.sql`
    SELECT id::text AS id, nombre, apellido, tipo_identificacion, numero_identificacion, deleted_at
    FROM conductores
    WHERE regexp_replace(upper(coalesce(numero_identificacion, '')), '[^A-Z0-9]', '', 'g') IN (${Prisma.join(claves)})
  `);
  const mapa = new Map<string, any>();
  for (const fila of filas as any[]) {
    const key = `${normalizar(fila.tipo_identificacion)}:${normalizar(fila.numero_identificacion)}`;
    if (mapa.has(key)) mapa.set(key, { ambiguo: true });
    else mapa.set(key, fila);
  }
  return mapa;
}

async function buscarVehiculos(
  cliente: PrismaAny,
  vehiculos: any[],
): Promise<Map<string, any>> {
  const claves = [
    ...new Set(
      vehiculos.map((vehiculo) => normalizar(vehiculo.placa)).filter(Boolean),
    ),
  ];
  if (!claves.length) return new Map();
  const filas = await cliente.$queryRaw(Prisma.sql`
    SELECT id::text AS id, placa, clase_vehiculo, deleted_at
    FROM vehiculos
    WHERE regexp_replace(upper(coalesce(placa, '')), '[^A-Z0-9]', '', 'g') IN (${Prisma.join(claves)})
  `);
  const mapa = new Map<string, any>();
  for (const fila of filas as any[]) {
    const key = normalizar(fila.placa);
    if (mapa.has(key)) mapa.set(key, { ambiguo: true });
    else mapa.set(key, fila);
  }
  return mapa;
}

function motivoConductor(
  conductor: any,
  existente: any,
  permitirCrear: boolean,
): string | null {
  if (!conductor) return null;
  if (existente) return null;
  if (
    !String(conductor.tipo_identificacion ?? "").trim() ||
    !String(conductor.numero_identificacion ?? "").trim()
  ) {
    return "El conductor no tiene tipo y número de identificación; no se puede enlazar de forma segura.";
  }
  return permitirCrear
    ? null
    : "El conductor no existe en esta empresa. Activa “crear conductores faltantes” para incluirlo inactivo.";
}

function motivoVehiculo(
  vehiculo: any,
  existente: any,
  permitirCrear: boolean,
): string | null {
  if (!vehiculo) return null;
  if (existente) return null;
  if (!String(vehiculo.placa ?? "").trim())
    return "El envío referencia un vehículo sin placa.";
  return permitirCrear
    ? null
    : "La placa no existe en esta empresa. Activa “crear vehículos faltantes” para incluirla inactiva.";
}

export function crearMotorImportacionFormularios(config: ImportadorConfig) {
  async function cargarPagina(input: PrevisualizarImportacionFormulariosInput) {
    const desde = new Date(`${input.fechaDesde}T00:00:00.000Z`);
    const hasta = new Date(`${input.fechaHasta}T00:00:00.000Z`);
    const where: any = {
      status: input.estado,
      deleted_at: null,
      business_date: { gte: desde, lte: hasta },
      import_origin: { is: null },
    };
    if (input.codigoFormulario)
      where.version = {
        form: { code: { equals: input.codigoFormulario, mode: "insensitive" } },
      };
    if (input.busqueda) {
      const texto = input.busqueda;
      where.OR = [
        {
          version: { form: { code: { contains: texto, mode: "insensitive" } } },
        },
        {
          version: { form: { name: { contains: texto, mode: "insensitive" } } },
        },
        {
          conductor: {
            is: { nombre: { contains: texto, mode: "insensitive" } },
          },
        },
        {
          conductor: {
            is: { apellido: { contains: texto, mode: "insensitive" } },
          },
        },
        {
          conductor: {
            is: {
              numero_identificacion: { contains: texto, mode: "insensitive" },
            },
          },
        },
        {
          vehiculo: { is: { placa: { contains: texto, mode: "insensitive" } } },
        },
        {
          usuario: { is: { nombre: { contains: texto, mode: "insensitive" } } },
        },
        {
          usuario: { is: { correo: { contains: texto, mode: "insensitive" } } },
        },
      ];
    }
    const [total, envios] = await Promise.all([
      config.origen.form_submission.count({ where }),
      config.origen.form_submission.findMany({
        where,
        include: INCLUDE_ENVIO,
        orderBy: [{ submitted_at: "desc" }, { id: "asc" }],
        skip: (input.pagina - 1) * input.porPagina,
        take: input.porPagina,
      }),
    ]);
    await enriquecerVehiculosContexto(envios, config.origen);
    const [conductores, vehiculos, codigos] = await Promise.all([
      buscarConductores(
        config.local,
        envios.map((envio: any) => envio.conductor).filter(Boolean),
      ),
      buscarVehiculos(
        config.local,
        envios.map((envio: any) => envio.vehiculo).filter(Boolean),
      ),
      [...new Set(envios.map((envio: any) => envio.version.form.code))],
    ]);
    const correosUsuarios = [
      ...new Set(
        envios
          .map((envio: any) => String(envio.usuario?.correo ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const [registros, formularios, usuarios] = await Promise.all([
      config.local.form_submission_import.findMany({
        where: {
          source_company: config.empresaOrigen,
          source_submission_id: { in: envios.map((envio: any) => envio.id) },
        },
        select: {
          source_submission_id: true,
          status: true,
          destination_submission_id: true,
          imported_at: true,
        },
      }),
      config.local.form_definition.findMany({
        where: { code: { in: codigos } },
        include: {
          versions: {
            include: {
              form: true,
              sections: true,
              fields: { include: { options: true } },
            },
          },
        },
      }),
      correosUsuarios.length
        ? config.local.usuarios.findMany({
            where: { correo: { in: correosUsuarios, mode: "insensitive" } },
            select: { correo: true },
          })
        : Promise.resolve([]),
    ]);
    const registroPorEnvio = new Map(
      registros.map((registro: any) => [
        registro.source_submission_id,
        registro,
      ]),
    );
    const correosDestino = new Set(
      usuarios.map((usuario: any) =>
        String(usuario.correo).toLocaleLowerCase("es-CO"),
      ),
    );
    const items = envios.map((envio: any) => {
      const registro: any = registroPorEnvio.get(envio.id);
      const driver = envio.conductor
        ? (conductores.get(
            `${normalizar(envio.conductor.tipo_identificacion)}:${normalizar(envio.conductor.numero_identificacion)}`,
          ) ?? null)
        : null;
      const vehicle = envio.vehiculo
        ? (vehiculos.get(normalizar(envio.vehiculo.placa)) ?? null)
        : null;
      const formulario = formularios.find(
        (item: any) =>
          item.code.toLowerCase() === envio.version.form.code.toLowerCase(),
      ) as any;
      const bloqueos: string[] = [];
      if (envio.contextVehicleUnresolved)
        bloqueos.push(
          "El contexto del envío referencia una placa que no existe en la empresa de origen; corrige el registro antes de importar.",
        );
      if (registro?.status === "IMPORTED")
        bloqueos.push("Este envío ya está importado en esta empresa.");
      if (formulario?.deleted_at)
        bloqueos.push(
          "El formulario con ese código está eliminado en el destino; restáuralo antes de importar.",
        );
      if (!["PUBLISHED", "ARCHIVED"].includes(envio.version.status))
        bloqueos.push("La versión de origen no es publicada ni archivada.");
      if (
        envio.attachments.some(
          (adjunto: any) =>
            adjunto.status !== "UPLOADED" || !adjunto.object_key,
        )
      )
        bloqueos.push(
          "El envío tiene evidencia pendiente o sin archivo en S3.",
        );
      if (envio.attachments.length && !bucketOrigen(config))
        bloqueos.push(
          `Configura ${config.variableBucketOrigen} para copiar la evidencia.`,
        );
      if (
        envio.usuario &&
        !correosDestino.has(
          String(envio.usuario.correo ?? "").toLocaleLowerCase("es-CO"),
        )
      ) {
        bloqueos.push(
          "El usuario interno no tiene una cuenta con el mismo correo en destino; no se crea una cuenta automáticamente.",
        );
      }
      if (driver?.ambiguo)
        bloqueos.push(
          "Hay más de un conductor destino con ese documento normalizado; resuelve el duplicado antes de importar.",
        );
      else if (driver?.deleted_at)
        bloqueos.push(
          "El conductor destino con ese documento está eliminado; restáuralo antes de importar.",
        );
      else if (envio.conductor && !driver)
        bloqueos.push(
          motivoConductor(
            envio.conductor,
            driver,
            input.crearConductoresFaltantes,
          )!,
        );
      if (vehicle?.ambiguo)
        bloqueos.push(
          "Hay más de un vehículo destino con esa placa normalizada; resuelve el duplicado antes de importar.",
        );
      else if (vehicle?.deleted_at)
        bloqueos.push(
          "El vehículo destino con esa placa está eliminado; restáuralo antes de importar.",
        );
      else if (envio.vehiculo && !vehicle)
        bloqueos.push(
          motivoVehiculo(
            envio.vehiculo,
            vehicle,
            input.crearVehiculosFaltantes,
          )!,
        );
      const reusarVersion = Boolean(
        formulario?.versions?.some(
          (version: any) =>
            ["PUBLISHED", "ARCHIVED"].includes(version.status) &&
            huella(estructuraVersion(version)) ===
              huella(estructuraVersion(envio.version)),
        ),
      );
      return {
        ...resumirEnvio(envio),
        huella: huellaEnvio(envio),
        yaImportado: registro?.status === "IMPORTED",
        versionDestino: formulario
          ? reusarVersion
            ? "REUTILIZAR"
            : "COPIAR"
          : "CREAR",
        conductorDestino: driver
          ? {
              id: driver.id,
              nombre: `${driver.nombre} ${driver.apellido}`.trim(),
              creado: false,
            }
          : null,
        vehiculoDestino: vehicle
          ? { id: vehicle.id, placa: vehicle.placa, creado: false }
          : null,
        accionesRequeridas: {
          crearConductor: Boolean(envio.conductor && !driver),
          crearVehiculo: Boolean(envio.vehiculo && !vehicle),
        },
        importable: bloqueos.length === 0,
        bloqueos,
      };
    });
    return {
      items,
      pagina: input.pagina,
      porPagina: input.porPagina,
      total,
      paginas: Math.ceil(total / input.porPagina),
    };
  }

  async function crearClienteS3(): Promise<AdjuntosS3> {
    const origen = bucketOrigen(config);
    const destino = String(
      process.env.AWS_S3_BUCKET_NAME ??
        (config.empresaLocal === "TRANSMERALDA"
          ? "transmeralda"
          : "cotransmeq"),
    ).trim();
    if (!origen || !destino)
      throw errorConCodigo(
        "S3_NO_CONFIGURADO",
        "Configura los buckets S3 de origen y destino para copiar adjuntos.",
      );
    return { origen, destino, client: clienteS3() };
  }

  async function mapearActor(
    envio: any,
    tx: PrismaAny,
    actorId: string,
    crearConductor: boolean,
    conductoresDestino: Map<string, any>,
  ) {
    if (envio.conductor) {
      const clave = `${normalizar(envio.conductor.tipo_identificacion)}:${normalizar(envio.conductor.numero_identificacion)}`;
      let conductor = conductoresDestino.get(clave);
      if (conductor?.ambiguo)
        throw errorConCodigo(
          "CONDUCTOR_AMBIGUO",
          "Hay más de un conductor destino con ese documento normalizado.",
        );
      if (conductor?.deleted_at)
        throw errorConCodigo(
          "CONDUCTOR_ELIMINADO",
          "El conductor destino con ese documento está eliminado; restáuralo antes de importar.",
        );
      if (!conductor && crearConductor) {
        if (
          !normalizar(envio.conductor.numero_identificacion) ||
          !String(envio.conductor.tipo_identificacion ?? "").trim()
        ) {
          throw errorConCodigo(
            "CONDUCTOR_SIN_IDENTIFICACION",
            "No se puede crear el conductor: falta tipo o número de identificación.",
          );
        }
        conductor = await tx.conductores.create({
          data: {
            id: randomUUID(),
            nombre: envio.conductor.nombre,
            apellido: envio.conductor.apellido,
            tipo_identificacion: envio.conductor.tipo_identificacion,
            numero_identificacion: String(
              envio.conductor.numero_identificacion,
            ).trim(),
            cargo: "CONDUCTOR",
            estado: "inactivo",
            creado_por_id: actorId,
            created_at: new Date(),
            updated_at: new Date(),
            oculto: false,
            nomina: false,
          },
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        });
        conductoresDestino.set(clave, conductor);
      }
      if (!conductor)
        throw errorConCodigo(
          "CONDUCTOR_FALTANTE",
          "El conductor no existe en destino y no se autorizó su creación.",
        );
      return { conductorId: conductor.id, usuarioId: null };
    }
    const correo = String(envio.usuario?.correo ?? "").trim();
    const usuario = correo
      ? await tx.usuarios.findFirst({
          where: { correo: { equals: correo, mode: "insensitive" } },
          select: { id: true },
        })
      : null;
    if (!usuario)
      throw errorConCodigo(
        "USUARIO_SIN_MAPEO",
        "El usuario interno de origen no existe en destino con el mismo correo; no se crea una cuenta automáticamente.",
      );
    return { conductorId: null, usuarioId: usuario.id };
  }

  async function mapearVehiculo(
    envio: any,
    tx: PrismaAny,
    crearVehiculo: boolean,
    vehiculosDestino: Map<string, any>,
  ) {
    if (!envio.vehiculo) return null;
    const clave = normalizar(envio.vehiculo.placa);
    let vehiculo = vehiculosDestino.get(clave);
    if (vehiculo?.ambiguo)
      throw errorConCodigo(
        "VEHICULO_AMBIGUO",
        "Hay más de un vehículo destino con esa placa normalizada.",
      );
    if (vehiculo?.deleted_at)
      throw errorConCodigo(
        "VEHICULO_ELIMINADO",
        "El vehículo destino con esa placa está eliminado; restáuralo antes de importar.",
      );
    if (!vehiculo && crearVehiculo) {
      if (!clave)
        throw errorConCodigo(
          "VEHICULO_SIN_PLACA",
          "No se puede crear el vehículo: el envío no contiene una placa válida.",
        );
      vehiculo = await tx.vehiculos.create({
        data: {
          id: randomUUID(),
          placa: String(envio.vehiculo.placa).trim().toUpperCase(),
          clase_vehiculo:
            String(envio.vehiculo.clase_vehiculo ?? "").trim() ||
            "PENDIENTE_VALIDACION",
          estado: "inactivo",
          created_at: new Date(),
          updated_at: new Date(),
          oculto: false,
        },
        select: { id: true, placa: true },
      });
      vehiculosDestino.set(clave, vehiculo);
    }
    if (!vehiculo)
      throw errorConCodigo(
        "VEHICULO_FALTANTE",
        "La placa no existe en destino y no se autorizó su creación.",
      );
    return vehiculo.id;
  }

  async function asegurarFormularioYVersion(
    envio: any,
    tx: PrismaAny,
    actorId: string,
  ) {
    const source = envio.version;
    let formulario = await tx.form_definition.findUnique({
      where: { code: source.form.code },
      include: {
        versions: {
          include: {
            form: true,
            sections: true,
            fields: { include: { options: true } },
          },
        },
      },
    });
    if (formulario?.deleted_at)
      throw errorConCodigo(
        "FORMULARIO_ELIMINADO",
        "El formulario destino está eliminado; restáuralo antes de importar.",
      );
    if (!formulario) {
      const slugBase =
        String(source.form.slug || source.form.code)
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 100) || "formulario";
      let slug = slugBase;
      let suffix = 2;
      while (
        await tx.form_definition.findUnique({
          where: { slug },
          select: { id: true },
        })
      ) {
        slug = `${slugBase.slice(0, 110)}-${suffix++}`;
      }
      formulario = await tx.form_definition.create({
        data: {
          id: randomUUID(),
          code: source.form.code,
          slug,
          name: source.form.name,
          description: source.form.description,
          owner_area: source.form.owner_area,
          created_by_id: actorId,
          updated_by_id: actorId,
        },
        include: {
          versions: {
            include: {
              form: true,
              sections: true,
              fields: { include: { options: true } },
            },
          },
        },
      });
    }
    const canonical = huella(estructuraVersion(source));
    let version = formulario.versions.find(
      (candidate: any) =>
        ["PUBLISHED", "ARCHIVED"].includes(candidate.status) &&
        huella(estructuraVersion(candidate)) === canonical,
    );
    if (!version) {
      if (!["PUBLISHED", "ARCHIVED"].includes(source.status))
        throw errorConCodigo(
          "VERSION_NO_PUBLICADA",
          "No se importan envíos de una versión en borrador.",
        );
      const versionNumber =
        Math.max(
          0,
          ...formulario.versions.map(
            (candidate: any) => candidate.version_number,
          ),
        ) + 1;
      const ahora = new Date();
      version = await tx.form_version.create({
        data: {
          id: randomUUID(),
          form_id: formulario.id,
          version_number: versionNumber,
          status: source.status,
          title: source.title,
          description: source.description,
          instructions: source.instructions,
          settings_json: source.settings_json ?? {},
          source_metadata_json: {
            ...(source.source_metadata_json ?? {}),
            crossCompanyImport: {
              sourceCompany: config.empresaOrigen,
              sourceFormId: source.form.id,
              sourceFormName: source.form.name,
              sourceVersionId: source.id,
              sourceRevision: source.version_number,
            },
          },
          created_by_id: actorId,
          published_by_id: actorId,
          created_at: ahora,
          updated_at: ahora,
          published_at: source.published_at ?? source.created_at ?? ahora,
          archived_at:
            source.status === "ARCHIVED" ? (source.archived_at ?? ahora) : null,
        },
      });
      const secciones = new Map<string, string>();
      for (const section of [...source.sections].sort(
        (a: any, b: any) => a.sort_order - b.sort_order,
      )) {
        const creada = await tx.form_section.create({
          data: {
            id: randomUUID(),
            version_id: version.id,
            key: section.key,
            title: section.title,
            description: section.description,
            sort_order: section.sort_order,
            settings_json: section.settings_json ?? {},
          },
          select: { id: true, key: true },
        });
        secciones.set(creada.key, creada.id);
      }
      const campos = new Map<string, string>();
      const pendientes = [...source.fields].sort(
        (a: any, b: any) => a.sort_order - b.sort_order,
      );
      while (pendientes.length) {
        const indice = pendientes.findIndex((field: any) => {
          if (!field.parent_field_id) return true;
          const parent = source.fields.find(
            (item: any) => item.id === field.parent_field_id,
          );
          return Boolean(parent && campos.has(parent.key));
        });
        if (indice < 0)
          throw errorConCodigo(
            "VERSION_ESTRUCTURA_INVALIDA",
            "La versión tiene un ciclo o campo padre inválido.",
          );
        const [field] = pendientes.splice(indice, 1);
        const section = source.sections.find(
          (item: any) => item.id === field.section_id,
        );
        const parent = field.parent_field_id
          ? source.fields.find((item: any) => item.id === field.parent_field_id)
          : null;
        if (!section || (parent && !campos.has(parent.key)))
          throw errorConCodigo(
            "VERSION_ESTRUCTURA_INVALIDA",
            "La versión contiene una sección o campo padre inválido.",
          );
        const creado = await tx.form_field.create({
          data: {
            id: randomUUID(),
            version_id: version.id,
            section_id: secciones.get(section.key)!,
            parent_field_id: parent ? campos.get(parent.key)! : null,
            key: field.key,
            type: field.type,
            label: field.label,
            help_text: field.help_text,
            placeholder: field.placeholder,
            required: field.required,
            sort_order: field.sort_order,
            config_json: field.config_json ?? {},
            validation_json: field.validation_json ?? {},
            visibility_rule_json: field.visibility_rule_json,
            default_value_json: field.default_value_json,
          },
          select: { id: true, key: true },
        });
        campos.set(creado.key, creado.id);
        for (const option of field.options ?? [])
          await tx.form_field_option.create({
            data: {
              id: randomUUID(),
              field_id: creado.id,
              value: option.value,
              label: option.label,
              color: option.color,
              score: option.score == null ? null : String(option.score),
              sort_order: option.sort_order,
              metadata_json: option.metadata_json ?? {},
            },
          });
      }
      formulario.versions.push({
        ...version,
        form: formulario,
        sections: source.sections,
        fields: [],
      });
    }
    const versionDestino = await tx.form_version.findUnique({
      where: { id: version.id },
      include: { sections: true, fields: { include: { options: true } } },
    });
    const seccionIds = new Map(
      versionDestino.sections.map((section: any) => [section.key, section.id]),
    );
    const campoIds = new Map(
      versionDestino.fields.map((field: any) => [field.key, field.id]),
    );
    const opciones = new Map<string, string>();
    for (const field of versionDestino.fields)
      for (const option of field.options)
        opciones.set(`${field.key}:${option.value}`, option.id);
    return { formulario, version: versionDestino, campoIds, opciones };
  }

  async function asegurarAsignacion(
    envio: any,
    tx: PrismaAny,
    versionId: string,
    actorId: string,
  ) {
    const nombre = `Importado ${config.empresaOrigen} · ${envio.assignment.id}`;
    const existentes = await tx.form_assignment.findMany({
      where: { version_id: versionId, name: nombre, status: "CLOSED" },
      select: { id: true, settings_json: true },
    });
    const existente = existentes.find(
      (item: any) =>
        item.settings_json?.crossCompanyImport?.sourceAssignmentId ===
          envio.assignment.id &&
        item.settings_json?.crossCompanyImport?.sourceCompany ===
          config.empresaOrigen,
    );
    if (existente) return existente.id;
    const lockKey = `${config.empresaOrigen}:${envio.assignment.id}`;
    /// PostgreSQL devuelve `void` para el bloqueo; se castea a texto para que Prisma pueda deserializar el resultado.
    await tx.$queryRaw<Array<{ locked: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS locked
    `;
    const trasLock = await tx.form_assignment.findMany({
      where: { version_id: versionId, name: nombre, status: "CLOSED" },
      select: { id: true, settings_json: true },
    });
    const duplicado = trasLock.find(
      (item: any) =>
        item.settings_json?.crossCompanyImport?.sourceAssignmentId ===
          envio.assignment.id &&
        item.settings_json?.crossCompanyImport?.sourceCompany ===
          config.empresaOrigen,
    );
    if (duplicado) return duplicado.id;
    const settings = {
      ...(envio.assignment.settings_json ?? {}),
      crossCompanyImport: {
        sourceCompany: config.empresaOrigen,
        sourceAssignmentId: envio.assignment.id,
      },
    };
    const asignacion = await tx.form_assignment.create({
      data: {
        id: randomUUID(),
        version_id: versionId,
        name: nombre,
        status: "CLOSED",
        frequency: envio.assignment.frequency,
        limit_policy: envio.assignment.limit_policy,
        timezone: envio.assignment.timezone,
        starts_at: null,
        ends_at: new Date(),
        context_schema_json: envio.assignment.context_schema_json ?? {},
        settings_json: settings,
        created_by_id: actorId,
      },
      select: { id: true },
    });
    return asignacion.id;
  }

  async function copiarAdjuntos(envio: any, s3: AdjuntosS3) {
    const subidos: string[] = [];
    try {
      for (const attachment of envio.attachments) {
        if (attachment.status !== "UPLOADED" || !attachment.object_key)
          throw errorConCodigo(
            "ADJUNTO_INCOMPLETO",
            "No se puede importar evidencia que no esté cargada en origen.",
          );
        const max =
          attachment.kind === "PHOTO"
            ? 10 * 1024 * 1024
            : attachment.kind === "SIGNATURE"
              ? 2 * 1024 * 1024
              : 25 * 1024 * 1024;
        const size = Number(attachment.byte_size);
        if (!Number.isSafeInteger(size) || size < 0 || size > max)
          throw errorConCodigo(
            "ADJUNTO_TAMANO_INVALIDO",
            "La evidencia excede el límite permitido por el módulo de formularios.",
          );
        const response = await s3.client.send(
          new GetObjectCommand({
            Bucket: s3.origen,
            Key: attachment.object_key,
          }),
        );
        if (!response.Body)
          throw errorConCodigo(
            "ADJUNTO_NO_ENCONTRADO",
            "No se pudo descargar una evidencia de origen.",
          );
        const bytes = Buffer.from(await response.Body.transformToByteArray());
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== size || digest !== attachment.sha256)
          throw errorConCodigo(
            "ADJUNTO_INTEGRO_INVALIDO",
            "La evidencia no coincide con el tamaño o SHA-256 registrado.",
          );
        const extension =
          attachment.mime_type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ||
          "bin";
        const key = `formularios/imports/${config.empresaOrigen.toLowerCase()}/${envio.id}/${attachment.id}.${extension}`;
        await s3.client.send(
          new PutObjectCommand({
            Bucket: s3.destino,
            Key: key,
            Body: bytes,
            ContentType: attachment.mime_type,
            ContentLength: bytes.length,
            ChecksumSHA256: Buffer.from(digest, "hex").toString("base64"),
          }),
        );
        subidos.push(key);
      }
    } catch (error) {
      await Promise.allSettled(
        subidos.map((Key) =>
          s3.client.send(new DeleteObjectCommand({ Bucket: s3.destino, Key })),
        ),
      );
      throw error;
    }
    return {
      subidos,
      llavePorAdjunto: new Map(
        envio.attachments.map((a: any, i: number) => [a.id, subidos[i]]),
      ),
    };
  }

  async function importarUno(
    item: { submissionId: string; huella: string },
    batchId: string,
    opciones: ImportarEnviosFormulariosInput,
    actorId: string,
  ) {
    let intentoId: string | null = null;
    let registroId: string | null = null;
    let subidos: string[] = [];
    try {
      const intento = await config.local.form_import_batch_item.create({
        data: {
          id: randomUUID(),
          batch_id: batchId,
          source_submission_id: item.submissionId,
          source_fingerprint: item.huella,
          status: "PENDING",
        },
        select: { id: true },
      });
      intentoId = intento.id;
      const registroActual =
        await config.local.form_submission_import.findUnique({
          where: {
            source_company_source_submission_id: {
              source_company: config.empresaOrigen,
              source_submission_id: item.submissionId,
            },
          },
        });
      if (registroActual?.status === "IMPORTED") {
        await config.local.form_import_batch_item.update({
          where: { id: intento.id },
          data: {
            form_submission_import_id: registroActual.id,
            status: "ALREADY_IMPORTED",
            finished_at: new Date(),
          },
        });
        return {
          submissionId: item.submissionId,
          estado: "ALREADY_IMPORTED",
          destinationSubmissionId: registroActual.destination_submission_id,
        };
      }
      if (
        registroActual?.status === "PENDING" &&
        Date.now() - new Date(registroActual.updated_at).getTime() <
          15 * 60 * 1000
      ) {
        throw errorConCodigo(
          "IMPORTACION_EN_CURSO",
          "Este envío ya está siendo procesado por otra solicitud.",
        );
      }
      const envio = await cargarEnvioOrigen(config, item.submissionId);
      if (!envio || envio.deleted_at || envio.import_origin)
        throw errorConCodigo(
          "ENVIO_NO_DISPONIBLE",
          "El envío ya no existe o fue importado previamente a la empresa de origen.",
        );
      if (envio.contextVehicleUnresolved)
        throw errorConCodigo(
          "VEHICULO_CONTEXTO_NO_RESUELTO",
          "El contexto del envío referencia una placa que no existe en la empresa de origen.",
        );
      if (!["SUBMITTED", "VOIDED"].includes(envio.status))
        throw errorConCodigo(
          "ESTADO_NO_IMPORTABLE",
          "Solo se importan envíos entregados o anulados.",
        );
      const actual = huellaEnvio(envio);
      if (actual !== item.huella)
        throw errorConCodigo(
          "PREVIEW_DESACTUALIZADO",
          "El envío cambió desde la vista previa. Actualiza la lista y vuelve a seleccionarlo.",
        );
      const claveConductor = envio.conductor
        ? `${normalizar(envio.conductor.tipo_identificacion)}:${normalizar(envio.conductor.numero_identificacion)}`
        : "";
      const claveVehiculo = envio.vehiculo
        ? normalizar(envio.vehiculo.placa)
        : "";
      const destinoConductor = envio.conductor
        ? await buscarConductores(config.local, [envio.conductor])
        : new Map();
      const destinoVehiculo = envio.vehiculo
        ? await buscarVehiculos(config.local, [envio.vehiculo])
        : new Map();
      if (
        envio.conductor &&
        !destinoConductor.has(claveConductor) &&
        !opciones.crearConductoresFaltantes
      )
        throw errorConCodigo(
          "CONDUCTOR_FALTANTE",
          motivoConductor(envio.conductor, null, false)!,
        );
      if (
        envio.vehiculo &&
        !destinoVehiculo.has(claveVehiculo) &&
        !opciones.crearVehiculosFaltantes
      )
        throw errorConCodigo(
          "VEHICULO_FALTANTE",
          motivoVehiculo(envio.vehiculo, null, false)!,
        );
      const s3 = envio.attachments.length ? await crearClienteS3() : null;
      let registro: any;
      if (registroActual) {
        const reserva = await config.local.form_submission_import.updateMany({
          where: {
            id: registroActual.id,
            OR: [
              { status: "FAILED" },
              {
                status: "PENDING",
                updated_at: { lt: new Date(Date.now() - 15 * 60 * 1000) },
              },
            ],
          },
          data: {
            status: "PENDING",
            attempt_count: { increment: 1 },
            source_fingerprint: actual,
            last_error_code: null,
            last_error_message: null,
            destination_submission_id: null,
          },
        });
        if (reserva.count !== 1)
          throw errorConCodigo(
            "IMPORTACION_EN_CURSO",
            "Este envío ya está siendo procesado por otra solicitud.",
          );
        registro = await config.local.form_submission_import.findUnique({
          where: { id: registroActual.id },
        });
      } else {
        registro = await config.local.form_submission_import.create({
          data: {
            id: randomUUID(),
            source_company: config.empresaOrigen,
            source_submission_id: envio.id,
            source_form_id: envio.version.form.id,
            source_version_id: envio.version.id,
            source_assignment_id: envio.assignment.id,
            source_fingerprint: actual,
            status: "PENDING",
            attempt_count: 1,
          },
        });
      }
      registroId = registro.id;
      await config.local.form_import_batch_item.update({
        where: { id: intento.id },
        data: {
          form_submission_import_id: registro.id,
          source_fingerprint: actual,
        },
      });
      if (s3) {
        const copiados = await copiarAdjuntos(envio, s3);
        subidos = copiados.subidos;
        const mapaAdjuntos = copiados.llavePorAdjunto;
        const resultado = await config.local.$transaction(
          async (tx: PrismaAny) => {
            const conductorExistia = Boolean(
              envio.conductor && destinoConductor.has(claveConductor),
            );
            const vehiculoExistia = Boolean(
              envio.vehiculo && destinoVehiculo.has(claveVehiculo),
            );
            const actor = await mapearActor(
              envio,
              tx,
              actorId,
              opciones.crearConductoresFaltantes,
              destinoConductor,
            );
            const vehicleId = await mapearVehiculo(
              envio,
              tx,
              opciones.crearVehiculosFaltantes,
              destinoVehiculo,
            );
            const destino = await asegurarFormularioYVersion(
              envio,
              tx,
              actorId,
            );
            const assignmentId = await asegurarAsignacion(
              envio,
              tx,
              destino.version.id,
              actorId,
            );
            const idEnvioDestino = randomUUID();
            const idCliente = randomUUID();
            const context = crearContextoImportado(
              envio,
              vehicleId,
              config.empresaOrigen,
            );
            await tx.form_submission.create({
              data: {
                id: idEnvioDestino,
                client_submission_id: idCliente,
                assignment_id: assignmentId,
                version_id: destino.version.id,
                conductor_id: actor.conductorId,
                usuario_id: actor.usuarioId,
                vehicle_id: vehicleId,
                service_id: null,
                status: envio.status,
                business_date: envio.business_date,
                period_key: envio.period_key,
                context_json: context,
                device_json: {
                  ...(envio.device_json ?? {}),
                  crossCompanySource: config.empresaOrigen,
                },
                started_at: envio.started_at,
                updated_at: envio.updated_at,
                submitted_at: envio.submitted_at,
                voided_at: envio.voided_at,
                voided_by_id: null,
                void_reason: envio.void_reason,
              },
            });
            const occurrenceIds = new Map<string, string>();
            const answerIds = new Map<string, string>();
            for (const answer of envio.answers) {
              const fieldId = destino.campoIds.get(answer.field.key);
              if (!fieldId)
                throw errorConCodigo(
                  "CAMPO_NO_MAPEADO",
                  `No se pudo mapear el campo ${answer.field.key} de la versión importada.`,
                );
              const occurrenceId = answer.occurrence_id
                ? (occurrenceIds.get(answer.occurrence_id) ?? randomUUID())
                : null;
              if (answer.occurrence_id && occurrenceId)
                occurrenceIds.set(answer.occurrence_id, occurrenceId);
              const answerId = randomUUID();
              answerIds.set(answer.id, answerId);
              await tx.form_answer.create({
                data: {
                  id: answerId,
                  submission_id: idEnvioDestino,
                  field_id: fieldId,
                  occurrence_id: occurrenceId,
                  row_index: answer.row_index,
                  value_text: answer.value_text,
                  value_decimal: answer.value_decimal,
                  value_boolean: answer.value_boolean,
                  value_date: answer.value_date,
                  value_datetime: answer.value_datetime,
                  value_json: normalizarJsonNulo(answer.value_json),
                },
              });
              for (const option of answer.options) {
                const optionId = destino.opciones.get(
                  `${answer.field.key}:${option.option.value}`,
                );
                if (!optionId)
                  throw errorConCodigo(
                    "OPCION_NO_MAPEADA",
                    `No se pudo mapear la opción ${option.option.value} del campo ${answer.field.key}.`,
                  );
                await tx.form_answer_option.create({
                  data: { answer_id: answerId, option_id: optionId },
                });
              }
            }
            for (const attachment of envio.attachments) {
              const originalMeta = (attachment.metadata_json ?? {}) as Record<
                string,
                any
              >;
              const answerId = attachment.answer_id
                ? (answerIds.get(attachment.answer_id) ?? null)
                : null;
              const sourceFieldId = originalMeta.fieldId
                ? envio.version.fields.find(
                    (field: any) => field.id === originalMeta.fieldId,
                  )?.key
                : null;
              const fieldId = sourceFieldId
                ? destino.campoIds.get(sourceFieldId)
                : null;
              const sourceOccurrence = originalMeta.occurrenceId
                ? String(originalMeta.occurrenceId)
                : null;
              const occurrenceId = sourceOccurrence
                ? (occurrenceIds.get(sourceOccurrence) ?? null)
                : null;
              await tx.form_attachment.create({
                data: {
                  id: randomUUID(),
                  submission_id: idEnvioDestino,
                  answer_id: answerId,
                  client_attachment_id: randomUUID(),
                  kind: attachment.kind,
                  status: "UPLOADED",
                  object_key: mapaAdjuntos.get(attachment.id),
                  original_name: attachment.original_name,
                  mime_type: attachment.mime_type,
                  byte_size: attachment.byte_size,
                  sha256: attachment.sha256,
                  metadata_json: {
                    ...originalMeta,
                    fieldId,
                    occurrenceId,
                    importedFrom: {
                      sourceCompany: config.empresaOrigen,
                      sourceAttachmentId: attachment.id,
                    },
                  },
                  created_at: attachment.created_at,
                  uploaded_at: attachment.uploaded_at ?? new Date(),
                },
              });
            }
            for (const event of envio.events)
              await tx.form_submission_event.create({
                data: {
                  id: randomUUID(),
                  submission_id: idEnvioDestino,
                  event_type: event.event_type,
                  actor_type: "SYSTEM",
                  actor_id: null,
                  payload_json: {
                    sourceCompany: config.empresaOrigen,
                    sourceActorType: event.actor_type,
                    sourceActorId: event.actor_id,
                    sourcePayload: event.payload_json,
                  },
                  created_at: event.created_at,
                },
              });
            await tx.form_submission_event.create({
              data: {
                id: randomUUID(),
                submission_id: idEnvioDestino,
                event_type: "IMPORTED_FROM_COMPANY",
                actor_type: "USER",
                actor_id: actorId,
                payload_json: {
                  sourceCompany: config.empresaOrigen,
                  sourceSubmissionId: envio.id,
                },
              },
            });
            await tx.form_submission_import.update({
              where: { id: registro.id },
              data: {
                status: "IMPORTED",
                destination_submission_id: idEnvioDestino,
                imported_at: new Date(),
                last_error_code: null,
                last_error_message: null,
              },
            });
            await tx.form_import_batch_item.update({
              where: { id: intento.id },
              data: { status: "IMPORTED", finished_at: new Date() },
            });
            return {
              destinationSubmissionId: idEnvioDestino,
              createdDriver: Boolean(envio.conductor && !conductorExistia),
              createdVehicle: Boolean(envio.vehiculo && !vehiculoExistia),
            };
          },
          { timeout: 120_000, maxWait: 15_000 },
        );
        return { submissionId: envio.id, estado: "IMPORTED", ...resultado };
      }
      const resultado = await config.local.$transaction(
        async (tx: PrismaAny) => {
          const conductorExistia = Boolean(
            envio.conductor && destinoConductor.has(claveConductor),
          );
          const vehiculoExistia = Boolean(
            envio.vehiculo && destinoVehiculo.has(claveVehiculo),
          );
          const actor = await mapearActor(
            envio,
            tx,
            actorId,
            opciones.crearConductoresFaltantes,
            destinoConductor,
          );
          const vehicleId = await mapearVehiculo(
            envio,
            tx,
            opciones.crearVehiculosFaltantes,
            destinoVehiculo,
          );
          const destino = await asegurarFormularioYVersion(envio, tx, actorId);
          const assignmentId = await asegurarAsignacion(
            envio,
            tx,
            destino.version.id,
            actorId,
          );
          const idEnvioDestino = randomUUID();
          await tx.form_submission.create({
            data: {
              id: idEnvioDestino,
              client_submission_id: randomUUID(),
              assignment_id: assignmentId,
              version_id: destino.version.id,
              conductor_id: actor.conductorId,
              usuario_id: actor.usuarioId,
              vehicle_id: vehicleId,
              service_id: null,
              status: envio.status,
              business_date: envio.business_date,
              period_key: envio.period_key,
              context_json: crearContextoImportado(
                envio,
                vehicleId,
                config.empresaOrigen,
              ),
              device_json: {
                ...(envio.device_json ?? {}),
                crossCompanySource: config.empresaOrigen,
              },
              started_at: envio.started_at,
              updated_at: envio.updated_at,
              submitted_at: envio.submitted_at,
              voided_at: envio.voided_at,
              voided_by_id: null,
              void_reason: envio.void_reason,
            },
          });
          const occurrenceIds = new Map<string, string>();
          const answerIds = new Map<string, string>();
          for (const answer of envio.answers) {
            const fieldId = destino.campoIds.get(answer.field.key);
            if (!fieldId)
              throw errorConCodigo(
                "CAMPO_NO_MAPEADO",
                `No se pudo mapear el campo ${answer.field.key}.`,
              );
            let occurrenceId: string | null = null;
            if (answer.occurrence_id) {
              occurrenceId =
                occurrenceIds.get(answer.occurrence_id) ?? randomUUID();
              occurrenceIds.set(answer.occurrence_id, occurrenceId);
            }
            const answerId = randomUUID();
            answerIds.set(answer.id, answerId);
            await tx.form_answer.create({
              data: {
                id: answerId,
                submission_id: idEnvioDestino,
                field_id: fieldId,
                occurrence_id: occurrenceId,
                row_index: answer.row_index,
                value_text: answer.value_text,
                value_decimal: answer.value_decimal,
                value_boolean: answer.value_boolean,
                value_date: answer.value_date,
                value_datetime: answer.value_datetime,
                value_json: normalizarJsonNulo(answer.value_json),
              },
            });
            for (const option of answer.options) {
              const optionId = destino.opciones.get(
                `${answer.field.key}:${option.option.value}`,
              );
              if (!optionId)
                throw errorConCodigo(
                  "OPCION_NO_MAPEADA",
                  `No se pudo mapear la opción ${option.option.value}.`,
                );
              await tx.form_answer_option.create({
                data: { answer_id: answerId, option_id: optionId },
              });
            }
          }
          // Un envío sin adjuntos entra por esta rama; el resto comparte el camino de copia S3.
          for (const event of envio.events)
            await tx.form_submission_event.create({
              data: {
                id: randomUUID(),
                submission_id: idEnvioDestino,
                event_type: event.event_type,
                actor_type: "SYSTEM",
                actor_id: null,
                payload_json: {
                  sourceCompany: config.empresaOrigen,
                  sourceActorType: event.actor_type,
                  sourceActorId: event.actor_id,
                  sourcePayload: event.payload_json,
                },
                created_at: event.created_at,
              },
            });
          await tx.form_submission_event.create({
            data: {
              id: randomUUID(),
              submission_id: idEnvioDestino,
              event_type: "IMPORTED_FROM_COMPANY",
              actor_type: "USER",
              actor_id: actorId,
              payload_json: {
                sourceCompany: config.empresaOrigen,
                sourceSubmissionId: envio.id,
              },
            },
          });
          await tx.form_submission_import.update({
            where: { id: registro.id },
            data: {
              status: "IMPORTED",
              destination_submission_id: idEnvioDestino,
              imported_at: new Date(),
            },
          });
          await tx.form_import_batch_item.update({
            where: { id: intento.id },
            data: { status: "IMPORTED", finished_at: new Date() },
          });
          return {
            destinationSubmissionId: idEnvioDestino,
            createdDriver: Boolean(envio.conductor && !conductorExistia),
            createdVehicle: Boolean(envio.vehiculo && !vehiculoExistia),
          };
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
      return { submissionId: envio.id, estado: "IMPORTED", ...resultado };
    } catch (error: any) {
      if (subidos.length) {
        const s3 = await crearClienteS3().catch(() => null);
        if (s3)
          await Promise.allSettled(
            subidos.map((Key) =>
              s3.client.send(
                new DeleteObjectCommand({ Bucket: s3.destino, Key }),
              ),
            ),
          );
      }
      const code = String(error?.code ?? "IMPORTACION_FALLIDA");
      const mensajesSeguros: Record<string, string> = {
        P2002:
          "Ya existe un registro con una placa o identificación equivalente. Actualiza la vista previa.",
        P2003: "Un registro relacionado dejó de estar disponible en destino.",
      };
      const message =
        mensajesSeguros[code] ??
        (error instanceof Error
          ? error.message
          : "No fue posible importar el envío.");
      if (registroId)
        await config.local.form_submission_import
          .update({
            where: { id: registroId },
            data: {
              status: "FAILED",
              last_error_code: code.slice(0, 50),
              last_error_message: message.slice(0, 500),
            },
          })
          .catch(() => undefined);
      if (intentoId)
        await config.local.form_import_batch_item
          .update({
            where: { id: intentoId },
            data: {
              status: "FAILED",
              error_code: code.slice(0, 50),
              error_message: message.slice(0, 500),
              finished_at: new Date(),
            },
          })
          .catch(() => undefined);
      return {
        submissionId: item.submissionId,
        estado: "FAILED",
        codigo: code,
        mensaje: message,
      };
    }
  }

  async function importar(
    input: ImportarEnviosFormulariosInput,
    actorId: string,
  ) {
    if (!actorId)
      throw errorConCodigo(
        "ACTOR_REQUERIDO",
        "No se pudo identificar al usuario que solicita la importación.",
      );
    const batch = await config.local.form_import_batch.create({
      data: {
        id: randomUUID(),
        source_company: config.empresaOrigen,
        requested_by_id: actorId,
        selected_count: input.seleccion.length,
        status: "RUNNING",
      },
      select: { id: true },
    });
    const results = [];
    for (const selection of input.seleccion as Array<{
      submissionId: string;
      huella: string;
    }>)
      results.push(await importarUno(selection, batch.id, input, actorId));
    for (const selection of input.seleccion as Array<{
      submissionId: string;
      huella: string;
    }>) {
      try {
        const source = await config.origen.form_submission.findUnique({
          where: { id: selection.submissionId },
          select: { supersedes_submission_id: true },
        });
        if (!source?.supersedes_submission_id) continue;
        const [current, prior] = await Promise.all([
          config.local.form_submission_import.findUnique({
            where: {
              source_company_source_submission_id: {
                source_company: config.empresaOrigen,
                source_submission_id: selection.submissionId,
              },
            },
            select: { status: true, destination_submission_id: true },
          }),
          config.local.form_submission_import.findUnique({
            where: {
              source_company_source_submission_id: {
                source_company: config.empresaOrigen,
                source_submission_id: source.supersedes_submission_id,
              },
            },
            select: { status: true, destination_submission_id: true },
          }),
        ]);
        if (
          current?.status === "IMPORTED" &&
          current.destination_submission_id &&
          prior?.status === "IMPORTED" &&
          prior.destination_submission_id
        ) {
          await config.local.form_submission.update({
            where: { id: current.destination_submission_id },
            data: { supersedes_submission_id: prior.destination_submission_id },
          });
        }
      } catch {
        const result = results.find(
          (item: any) => item.submissionId === selection.submissionId,
        ) as any;
        if (result)
          result.advertencia =
            "No fue posible enlazar el envío anterior de la corrección; el ID de origen quedó en la procedencia.";
      }
    }
    const imported = results.filter(
      (item) => item.estado === "IMPORTED",
    ).length;
    const already = results.filter(
      (item) => item.estado === "ALREADY_IMPORTED",
    ).length;
    const failed = results.filter((item) => item.estado === "FAILED").length;
    const skipped = already;
    const status =
      failed === 0
        ? "COMPLETED"
        : imported + already > 0
          ? "PARTIAL"
          : "FAILED";
    await config.local.form_import_batch.update({
      where: { id: batch.id },
      data: {
        status,
        imported_count: imported,
        skipped_count: skipped,
        failed_count: failed,
        finished_at: new Date(),
        summary_json: { results },
      },
    });
    return {
      batchId: batch.id,
      status,
      selected: results.length,
      imported,
      alreadyImported: already,
      failed,
      results,
    };
  }

  return { previsualizar: cargarPagina, importar };
}
