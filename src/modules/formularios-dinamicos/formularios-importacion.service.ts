import { prisma } from "../../config/prisma";
import {
  getPrismaTransmeralda,
  requireTransmeraldaConfigured,
} from "../../config/prismaTransmeralda";
import { crearMotorImportacionFormularios } from "./formularios-importacion.core";
import type {
  ImportarEnviosFormulariosInput,
  PrevisualizarImportacionFormulariosInput,
} from "./formularios-importacion.schema";

function motor() {
  requireTransmeraldaConfigured();
  return crearMotorImportacionFormularios({
    empresaLocal: "COTRANSMEQ",
    empresaOrigen: "TRANSMERALDA",
    variableBucketOrigen: "TRANSMERALDA_S3_BUCKET_NAME",
    local: prisma,
    origen: getPrismaTransmeralda(),
  });
}

export async function previsualizarEnviosTransmeralda(
  input: PrevisualizarImportacionFormulariosInput,
) {
  return motor().previsualizar(input);
}

export async function importarEnviosTransmeralda(
  input: ImportarEnviosFormulariosInput,
  actorId: string,
) {
  return motor().importar(input, actorId);
}
