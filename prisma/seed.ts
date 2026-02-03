import { PrismaClient, Prisma } from "@prisma/client";
import { faker } from "@faker-js/faker";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

// Función para hashear password
async function hashPassword(password: string): Promise<string> {
  return await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 2 ** 16,
    timeCost: 3,
    parallelism: 1,
  });
}

async function main() {
  console.log("🌱 Iniciando seed de datos...");

  try {
    // --- Limpiar todas las tablas en orden inverso de dependencias ---
    console.log("🧹 Limpiando datos existentes...");

    await prisma.liquidacionVehiculo.deleteMany({});
    await prisma.liquidacion.deleteMany({});
    await prisma.anticipo.deleteMany({});
    await prisma.bonificacion.deleteMany({});
    await prisma.recargo.deleteMany({});
    await prisma.pernote.deleteMany({});
    await prisma.mantenimiento.deleteMany({});
    await prisma.servicio.deleteMany({});
    await prisma.vehiculo.deleteMany({});
    await prisma.conductor.deleteMany({});
    await prisma.cliente.deleteMany({});
    await prisma.municipio.deleteMany({});
    await prisma.usuario.deleteMany({});

    console.log("✨ Tablas limpias. Iniciando creación de registros...\n");

    // --- Usuarios base ---
    console.log("👤 Creando usuarios...");
    const adminPassword = await hashPassword("123456");
    const gestorPassword = await hashPassword("123456");

    const admin = await prisma.usuario.create({
      data: {
        nombre: "Administrador",
        correo: "admin@cotransmeq.com",
        password: adminPassword,
        rol: "ADMIN",
        permisos: {},
      },
    });

    const gestor = await prisma.usuario.create({
      data: {
        nombre: "Gestor de Servicios",
        correo: "gestor@cotransmeq.com",
        password: gestorPassword,
        rol: "GESTOR",
        permisos: {},
      },
    });
    console.log(`✅ ${2} usuarios creados\n`);

    // --- Municipios ---
    console.log("🏙️ Creando municipios...");
    const municipios = await prisma.$transaction(
      Array.from({ length: 5 }).map(() =>
        prisma.municipio.create({
          data: {
            codigo_departamento: faker.number.int({ min: 1, max: 99 }),
            nombre_departamento: faker.location.state(),
            codigo_municipio: faker.number.int({ min: 1000, max: 9999 }),
            nombre_municipio: faker.location.city(),
            tipo: "Municipio",
            longitud: new Prisma.Decimal(faker.location.longitude()),
            latitud: new Prisma.Decimal(faker.location.latitude()),
          },
        })
      )
    );
    console.log(`✅ ${municipios.length} municipios creados\n`);

    // --- Conductores ---
    console.log("🚗 Creando conductores...");

    // Primero crear usuarios conductores con password hasheado
    const conductorPassword = await hashPassword("123456");
    const usuariosConductores = await prisma.$transaction(
      Array.from({ length: 5 }).map(() =>
        prisma.usuario.create({
          data: {
            nombre: faker.person.firstName(),
            correo: faker.internet.email(),
            password: conductorPassword,
            rol: "CONDUCTOR",
          },
        })
      )
    );

    // Luego crear los conductores
    const conductores = await prisma.$transaction(
      usuariosConductores.map((usuario) =>
        prisma.conductor.create({
          data: {
            usuarioId: usuario.id,
            nombre: usuario.nombre,
            apellido: faker.person.lastName(),
            numero_identificacion: faker.string.numeric(10),
            telefono: faker.phone.number(),
            fecha_ingreso: faker.date.past(),
            salario_base: new Prisma.Decimal(
              faker.number.int({ min: 1000000, max: 2500000 })
            ),
            estado: "disponible",
            eps: faker.company.name(),
            fondo_pension: faker.company.name(),
          },
        })
      )
    );
    console.log(`✅ ${conductores.length} conductores creados\n`);

    // --- Clientes ---
    console.log("🏢 Creando clientes...");
    const clientes = await prisma.$transaction(
      Array.from({ length: 3 }).map(() =>
        prisma.cliente.create({
          data: {
            tipo: "EMPRESA",
            nit: faker.string.numeric(9),
            nombre: faker.company.name(),
            representante: faker.person.fullName(),
            telefono: faker.phone.number(),
            direccion: faker.location.streetAddress(),
            correo: faker.internet.email(),
          },
        })
      )
    );
    console.log(`✅ ${clientes.length} clientes creados\n`);

    // --- Vehículos ---
    console.log("🚙 Creando vehículos...");
    const vehiculos = await prisma.$transaction(
      Array.from({ length: 5 }).map(() =>
        prisma.vehiculo.create({
          data: {
            placa: faker.string.alphanumeric(6).toUpperCase(),
            marca: faker.vehicle.manufacturer(),
            modelo: faker.vehicle.model(),
            clase_vehiculo: "Camioneta",
            combustible: "Diesel",
            conductor_id: faker.helpers.arrayElement(conductores).id,
          },
        })
      )
    );
    console.log(`✅ ${vehiculos.length} vehículos creados\n`);

    // --- Servicios ---
    console.log("📋 Creando servicios...");
    const servicios = await prisma.$transaction(
      Array.from({ length: 10 }).map(() =>
        prisma.servicio.create({
          data: {
            conductor_id: faker.helpers.arrayElement(conductores).id,
            vehiculo_id: faker.helpers.arrayElement(vehiculos).id,
            cliente_id: faker.helpers.arrayElement(clientes).id,
            origen_id: faker.helpers.arrayElement(municipios).id,
            destino_id: faker.helpers.arrayElement(municipios).id,
            fecha_solicitud: faker.date.recent(),
            valor: new Prisma.Decimal(
              faker.number.int({ min: 100000, max: 500000 })
            ),
            observaciones: faker.lorem.sentence(),
          },
        })
      )
    );
    console.log(`✅ ${servicios.length} servicios creados\n`);

    console.log("✅ Seed ejecutado con éxito");
    console.log("═".repeat(50));
  } catch (error) {
    console.error("❌ Error durante el seed:", error);
    throw error;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });