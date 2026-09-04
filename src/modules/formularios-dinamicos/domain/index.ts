/**
 * Dominio de formularios dinámicos.
 *
 * Todo lo que hay aquí es puro: sin Prisma, sin Fastify, sin red. El service
 * del módulo importa de aquí; nada de aquí importa del service.
 *
 * Es también el contrato que el frontend replica en
 * `ingreso-svelte/src/lib/formularios/`. Cuando cambie un literal (un tipo de
 * campo, un operador, un código de error) hay que actualizar las dos copias y
 * el CHECK correspondiente de la migración.
 */

export * from './field-types'
export * from './rules'
export * from './definition'
export * from './assignments'
export * from './submissions'
export * from './fecha-diligenciamiento'
export * from './errors'
export * from './limits'
export * from './sanitize'
export * from './validate-definition'
