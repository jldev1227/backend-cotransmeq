import { defineConfig } from 'vitest/config'

/**
 * Prueba manual de Web Push: dispara las últimas notificaciones de UN usuario
 * a los navegadores donde activó los avisos.
 *
 * A diferencia del resto de suites, esta usa la base del `.env` (la de
 * desarrollo), porque las suscripciones de tu Chrome viven ahí, y NO carga
 * `tests/setup.ts`, que limpia tablas. El spec solo lee: lo único que puede
 * escribir es marcar como inactiva una suscripción que el navegador ya revocó.
 *
 *   WEB_PUSH_CORREO=tu@correo.com npm run test:web-push
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.push.spec.ts'],
    setupFiles: [],
    testTimeout: 60_000,
    // Sin el log de cada consulta: la salida útil es la tabla de entregas.
    env: { LOG_LEVEL: 'warn' },
  },
})
