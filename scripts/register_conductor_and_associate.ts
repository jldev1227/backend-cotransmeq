import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

async function main() {
  // Conductor data from user
  const conductor = {
    id: '174954b5-9539-4369-bcf5-69d2813f7a73',
    nombre: 'KEVIN ESNEIDER',
    apellido: 'FORERO AGUDELO',
    tipo_identificacion: 'CC',
    numero_identificacion: '100097237',
    fecha_ingreso: new Date('2026-03-14'),
    salario_base: '1750905.00',
    permisos: { verViajes: true, verDocumentos: true, actualizarPerfil: false, verMantenimientos: false },
    creado_por_id: '9a710070-9fc5-426e-849b-bf802c11f940',
    actualizado_por_id: '9a710070-9fc5-426e-849b-bf802c11f940',
    created_at: new Date('2026-03-14T23:43:39.353Z')
  } as any;

  console.log('Upserting conductor:', conductor.numero_identificacion);

  const upserted = await prisma.conductores.upsert({
    where: { numero_identificacion: conductor.numero_identificacion },
    update: {
      nombre: conductor.nombre,
      apellido: conductor.apellido,
      tipo_identificacion: conductor.tipo_identificacion,
      fecha_ingreso: conductor.fecha_ingreso,
      salario_base: conductor.salario_base,
      permisos: conductor.permisos,
      actualizado_por_id: conductor.actualizado_por_id
    },
    create: {
      id: conductor.id,
      nombre: conductor.nombre,
      apellido: conductor.apellido,
      tipo_identificacion: conductor.tipo_identificacion,
      numero_identificacion: conductor.numero_identificacion,
      fecha_ingreso: conductor.fecha_ingreso,
      salario_base: conductor.salario_base,
      permisos: conductor.permisos,
      creado_por_id: conductor.creado_por_id,
      actualizado_por_id: conductor.actualizado_por_id,
      created_at: conductor.created_at,
      updated_at: new Date()
    }
  });

  console.log('Conductor upserted id=', upserted.id);

  // Find the documentos_compartidos record for Kevin and associate
  const filenamePattern = 'KEVIN ESNEIDER FORERO AGUDELO';
  const doc = await prisma.documentos_compartidos.findFirst({ where: { filename: { contains: filenamePattern } } });
  if (!doc) {
    console.warn('No se encontró documentos_compartidos con filename containing', filenamePattern);
  } else {
    await prisma.documentos_compartidos.update({ where: { id: doc.id }, data: { conductor_id: upserted.id } });
    console.log('Asociado documento', doc.filename, '-> conductor_id', upserted.id);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
