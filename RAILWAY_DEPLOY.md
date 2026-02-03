# Railway Deploy - Backend NestJS

## Variables de entorno requeridas en Railway:

```
DATABASE_URL=postgresql://user:password@host:5432/database
JWT_SECRET=tu-secreto-jwt-super-seguro
PORT=4000
NODE_ENV=production
```

## Pasos para deployar en Railway:

1. **Crear nuevo proyecto en Railway**
   - Ir a https://railway.app
   - Crear nuevo proyecto
   - Seleccionar "Deploy from GitHub repo"

2. **Conectar repositorio**
   - Autorizar acceso a GitHub
   - Seleccionar el repositorio
   - Seleccionar el directorio `backend-nest`

3. **Configurar base de datos**
   - Agregar PostgreSQL al proyecto
   - Railway generará automáticamente DATABASE_URL
   
4. **Configurar variables de entorno**
   - En Settings → Variables
   - Agregar:
     - `JWT_SECRET`: Generar un secret seguro
     - `PORT`: 4000
     - `NODE_ENV`: production

5. **Configurar Build**
   - Railway detectará automáticamente el Dockerfile
   - O configurar manualmente:
     - Build Command: `npm run build`
     - Start Command: `node dist/server.js`

6. **Deploy**
   - Railway deployará automáticamente
   - Obtendrás una URL pública

## Notas importantes:

- El Dockerfile está configurado para build multi-stage
- Prisma Client se genera durante el build
- Las migraciones deben ejecutarse manualmente la primera vez:
  ```bash
  railway run npx prisma migrate deploy
  ```

## Healthcheck:

El servidor expondrá el endpoint:
- `GET /health` o `/` para verificar que está corriendo
