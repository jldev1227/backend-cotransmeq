import { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) return reply.status(401).send({ error: 'No token' })
  const parts = auth.split(' ')
  if (parts.length !== 2) return reply.status(401).send({ error: 'Invalid token' })
  const token = parts[1]
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any
    ;(request as any).user = payload
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid token' })
  }
}
