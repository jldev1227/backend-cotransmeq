import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export async function listTiposCertificado() {
  return prisma.tipo_certificado.findMany({
    where: { activo: true },
    orderBy: { nombre: 'asc' }
  })
}

export async function createTipoCertificado(data: { nombre: string; descripcion?: string; codigo: string }) {
  return prisma.tipo_certificado.create({ data })
}

export async function updateTipoCertificado(id: string, data: { nombre?: string; descripcion?: string; codigo?: string; activo?: boolean }) {
  return prisma.tipo_certificado.update({
    where: { id },
    data
  })
}

export async function deleteTipoCertificado(id: string) {
  return prisma.tipo_certificado.update({
    where: { id },
    data: { activo: false }
  })
}
