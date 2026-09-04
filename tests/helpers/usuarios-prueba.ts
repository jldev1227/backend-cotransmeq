/**
 * Usuarios sembrados para los tests que necesitan varias identidades a la vez.
 *
 * `usuarioConAreas()` (en `canvas-servicios.ts`) busca usuarios REALES en la
 * base y se salta el caso si no encuentra ninguno: sirve cuando se corre
 * contra una copia con datos, pero contra la base efímera de
 * `docker-compose.test.yml` —que arranca vacía— eso significa no probar nada.
 *
 * Aquí se crean a propósito. Todos llevan el prefijo `MARCA_USUARIO` en el
 * correo para poder borrarlos sin tocar nada más.
 */

import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { env } from '../../src/config/env'

const prisma = new PrismaClient()

export const MARCA_USUARIO = 'zztest-seguridad'

export interface UsuarioSembrado {
	id: string
	nombre: string
	correo: string
	token: string
}

/** Firma un token con la misma forma que emite `/auth/login`. */
function firmarToken(u: { id: string; nombre: string; correo: string }): string {
	return jwt.sign(
		{
			sub: u.id,
			id: u.id,
			nombre: u.nombre,
			name: u.nombre,
			correo: u.correo,
			area: ['Administración'],
			role: 'admin'
		},
		env.JWT_SECRET,
		{ expiresIn: '2h' }
	)
}

export async function sembrarUsuario(etiqueta: string): Promise<UsuarioSembrado> {
	const id = randomUUID()
	const correo = `${MARCA_USUARIO}-${etiqueta}-${id.slice(0, 8)}@example.test`
	const nombre = `Usuario ${etiqueta}`

	await prisma.usuarios.create({
		data: {
			// `usuarios` no tiene @default ni en `id` ni en las marcas de tiempo.
			id,
			nombre,
			correo,
			password: 'no-se-usa-en-tests',
			role: 'admin',
			area: ['Administración'],
			created_at: new Date(),
			updated_at: new Date()
		}
	})

	return { id, nombre, correo, token: firmarToken({ id, nombre, correo }) }
}

/** Borra SOLO los usuarios sembrados por estos tests. */
export async function limpiarUsuariosSembrados(): Promise<void> {
	await prisma.usuarios.deleteMany({ where: { correo: { contains: MARCA_USUARIO } } })
}

export async function cerrarPrisma(): Promise<void> {
	await prisma.$disconnect()
}
