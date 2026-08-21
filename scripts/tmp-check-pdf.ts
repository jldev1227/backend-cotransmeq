import * as fs from 'fs'
import { prisma } from '../src/config/prisma'
import { FormulariosSarlaftService } from '../src/modules/formularios-sarlaft/formularios-sarlaft.service'
;(async () => {
  const pdf = await FormulariosSarlaftService.generarPDFRespuesta('5d1af977-d877-4ea2-b06a-9038ea042a2a')
  fs.writeFileSync('/private/tmp/claude-501/-Users-julianlopez-Desktop-Cotransmeq/349f8950-817f-4c3e-855e-da48ce8f7f3d/scratchpad/adjunto.pdf', pdf!.buffer)
  console.log('escrito:', pdf!.nombre_archivo, pdf!.buffer.length, 'bytes')
})().finally(() => prisma.$disconnect())
