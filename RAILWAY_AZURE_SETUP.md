# 🔧 Configuración de Azure PostgreSQL para Railway

## Problema Actual

```
Can't reach database server at cotransmeq.postgres.database.azure.com:5432
```

**Causa**: Azure PostgreSQL tiene un firewall que bloquea conexiones externas por defecto. Railway no puede conectarse.

---

## ✅ Solución: Configurar Firewall de Azure

### Opción 1: Permitir Todos los IPs de Azure (Recomendado para Railway)

1. **Accede al Azure Portal**
   - Ve a: https://portal.azure.com/
   - Busca tu servidor: `cotransmeq`

2. **Configurar Networking/Firewall**
   - En el menú lateral, selecciona **"Networking"** o **"Firewall settings"**
   - Marca la casilla: **"Allow access to Azure services"**
   - Esto permite que servicios como Railway se conecten

3. **Agregar Regla de Firewall para Railway**
   - Haz clic en **"Add current client IP address"** (tu IP local)
   - Haz clic en **"Add firewall rule"**
   - Nombre: `Railway`
   - Start IP: `0.0.0.0`
   - End IP: `255.255.255.255`
   - **⚠️ Advertencia**: Esto permite cualquier IP. Solo para desarrollo.

4. **Guardar Cambios**
   - Haz clic en **"Save"**
   - Espera 1-2 minutos para que se apliquen los cambios

---

### Opción 2: IPs Específicas de Railway (Más Seguro)

Railway no proporciona IPs estáticas públicamente, pero puedes:

1. **Desplegar temporalmente con firewall abierto**
2. **Revisar los logs de Railway** para ver la IP desde la que se conecta
3. **Agregar esa IP específica** al firewall de Azure
4. **Cerrar el acceso general**

---

### Opción 3: Usar una Base de Datos en Railway (Alternativa)

Si prefieres no abrir el firewall de Azure:

1. **Crear PostgreSQL en Railway**
   ```bash
   # En Railway dashboard:
   # - New → Database → PostgreSQL
   # - Copiar DATABASE_URL generada
   ```

2. **Actualizar Variable de Entorno**
   ```bash
   # En Railway, variables de entorno:
   DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE
   ```

3. **Migrar Datos** (si es necesario)
   ```bash
   # Exportar desde Azure
   pg_dump -h cotransmeq.postgres.database.azure.com -U Cotrans900 -d postgres > backup.sql
   
   # Importar a Railway
   psql $DATABASE_URL < backup.sql
   ```

---

## 🔍 Verificar Conectividad

### Desde tu Máquina Local

```bash
# Test de conexión con psql
psql "postgresql://USUARIO:CLAVE@HOST:5432/BASE?sslmode=require"

# Test de conexión con telnet
telnet cotransmeq.postgres.database.azure.com 5432

# Test de conexión con curl
curl -v telnet://cotransmeq.postgres.database.azure.com:5432
```

### Desde Railway

```bash
# En Railway Shell (si está disponible)
nc -zv cotransmeq.postgres.database.azure.com 5432
```

---

## 📝 Actualizar Variables de Entorno en Railway

### Variables Requeridas:

```bash
PORT=4000
NODE_ENV=production

# Database - Azure PostgreSQL
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE?schema=public&sslmode=require

# JWT
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRY=30d

# AWS S3
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=<AWS_SECRET_ACCESS_KEY>
AWS_REGION=us-east-2
AWS_S3_BUCKET_NAME=your-bucket-name

# Redis (si usas Railway Redis)
REDIS_HOST=redis-railway-host
REDIS_PORT=6379
```

---

## 🔐 Configuración SSL para Azure PostgreSQL

Azure PostgreSQL requiere SSL. Asegúrate de que tu `DATABASE_URL` incluya:

```bash
# ✅ CORRECTO - Con sslmode=require
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public&sslmode=require"

# ❌ INCORRECTO - Sin sslmode
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public"
```

### Configuración Alternativa de SSL en Prisma

Si `sslmode=require` no funciona, prueba con:

```typescript
// src/config/prisma.ts
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  },
  // Configuración SSL explícita
  __internal: {
    engine: {
      endpoint: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    }
  }
})
```

O en el `DATABASE_URL`:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?schema=public&sslmode=require&sslaccept=accept_invalid_certs"
```

---

## 🚀 Pasos para Railway

1. **Configurar Firewall de Azure** (Opción 1 arriba)
2. **Configurar Variables de Entorno en Railway**
3. **Redesplegar**
4. **Verificar Logs**

### Comandos para Redesplegar:

```bash
# Commit cambios
git add .
git commit -m "fix: configure database connection for Railway"
git push origin main

# Railway debería redesplegar automáticamente
```

---

## 🐛 Troubleshooting

### Error: "Can't reach database server"

1. ✅ Verificar que el firewall de Azure permite la IP de Railway
2. ✅ Verificar que `sslmode=require` está en la URL
3. ✅ Verificar que la contraseña está URL-encoded: `**` → `%2A%2A`
4. ✅ Verificar que el servidor de Azure está activo

### Error: "SSL connection required"

```bash
# Agregar sslmode=require a la URL
DATABASE_URL="...?sslmode=require"
```

### Error: "Connection timeout"

```bash
# Aumentar timeout en DATABASE_URL
DATABASE_URL="...?connect_timeout=30"
```

### Ver Logs en Railway

```bash
# En Railway dashboard:
# 1. Selecciona tu servicio
# 2. Ve a "Deployments"
# 3. Haz clic en el deployment activo
# 4. Ve a "Logs"
```

---

## 📞 Soporte

Si después de configurar el firewall aún no funciona:

1. Verifica que el servidor de Azure esté corriendo
2. Contacta al soporte de Azure
3. Considera usar Railway PostgreSQL como alternativa

---

**Última actualización**: 3 de febrero de 2026
