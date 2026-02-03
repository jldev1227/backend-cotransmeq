# 🔐 Guía de Seguridad - Backend Cotransmeq

## ⚠️ Archivos Sensibles - NUNCA Subir a Git

### Archivos Protegidos por .gitignore

```
.env                    # Credenciales de producción
.env.local             # Credenciales locales
.env.*.local           # Cualquier archivo .env local
```

### ✅ Contenido de .env (Ejemplo)

```bash
# NUNCA subir este archivo a Git
PORT=4000
DB_HOST=cotransmeq.postgres.database.azure.com
DB_USER=Cotrans900
DB_PASSWORD=tu_password_aqui
DB_NAME=postgres
DB_PORT=5432
JWT_SECRET=tu_secret_jwt_aqui
JWT_EXPIRY=30d
NODE_ENV=development

# AWS S3 Configuration
AWS_ACCESS_KEY_ID=tu_access_key_aqui
AWS_SECRET_ACCESS_KEY=tu_secret_access_key_aqui
AWS_REGION=us-east-2
AWS_S3_BUCKET_NAME=cotransmeq

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Database URL para Prisma - Azure PostgreSQL
DATABASE_URL="postgresql://user:password@host:5432/database?schema=public&sslmode=require"

# Ministral AI (opcional)
# MINISTRAL_API_KEY=tu_api_key_aqui
# MINISTRAL_ENDPOINT=tu_endpoint_aqui
# MINISTRAL_MODEL_NAME=Ministral-3B-2
```

## 🚨 Si Expusiste Credenciales Accidentalmente

### 1. Revocar Credenciales Inmediatamente

#### AWS:
1. Ve a AWS Console → IAM → Users
2. Selecciona el usuario
3. Security Credentials → Access Keys
4. Haz clic en "Make Inactive" o "Delete"
5. Genera nuevas credenciales

#### Base de Datos:
```sql
-- Cambiar contraseña de usuario
ALTER USER Cotrans900 WITH PASSWORD 'nueva_contraseña_segura';
```

#### JWT Secret:
```bash
# Generar nuevo secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2. Limpiar Historial de Git

```bash
# Si las credenciales están en el último commit
git commit --amend -m "Mensaje del commit"
git push -f origin main

# Si están en commits anteriores, usar git filter-repo
# Instalar: brew install git-filter-repo
git filter-repo --path-match 'archivo_con_credenciales.md' --invert-paths
git push -f origin main
```

### 3. Notificar al Equipo

- Informa a todos los desarrolladores sobre las nuevas credenciales
- Actualiza las variables de entorno en:
  - Servidores de producción
  - Servidores de desarrollo
  - CI/CD pipelines
  - Railway/Vercel/otros servicios

## 🛡️ Mejores Prácticas

### 1. Variables de Entorno

```bash
# ✅ CORRECTO - Usar variables de entorno
const apiKey = process.env.AWS_ACCESS_KEY_ID

# ❌ INCORRECTO - Hardcodear credenciales
const apiKey = 'AKIAXXXXXXXXXXXXXXXX'
```

### 2. Archivos de Documentación

```markdown
<!-- ✅ CORRECTO -->
AWS_ACCESS_KEY_ID=<tu_access_key_id>
AWS_SECRET_ACCESS_KEY=<tu_secret_access_key>

<!-- ❌ INCORRECTO -->
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Verificar Antes de Commit

```bash
# Verificar qué archivos se van a subir
git status

# Ver el contenido de los archivos
git diff --cached

# Si ves credenciales, no hagas commit!
git reset HEAD archivo_con_credenciales.md
```

### 4. Usar .env.example

```bash
# Crear archivo de ejemplo sin credenciales
cp .env .env.example

# Editar .env.example y reemplazar valores reales con placeholders
# Después hacer commit del .env.example (SIN credenciales)
git add .env.example
git commit -m "Add .env.example"
```

## 🔍 Herramientas de Seguridad

### git-secrets (AWS)

```bash
# Instalar
brew install git-secrets

# Configurar
git secrets --install
git secrets --register-aws

# Escanear
git secrets --scan
```

### truffleHog

```bash
# Instalar
pip install truffleHog

# Escanear repositorio
trufflehog git https://github.com/jldev1227/backend-cotransmeq.git
```

### GitHub Secret Scanning

- GitHub automáticamente escanea commits en busca de secretos
- Si detecta uno, bloqueará el push (como en tu caso)
- Revoca las credenciales inmediatamente si ves esta alerta

## 📋 Checklist de Seguridad

- [ ] `.env` está en `.gitignore`
- [ ] No hay credenciales en archivos de documentación
- [ ] `.env.example` tiene solo placeholders
- [ ] Credenciales rotadas regularmente (cada 90 días)
- [ ] Acceso IAM configurado con permisos mínimos
- [ ] JWT secrets son aleatorios y largos (64+ caracteres)
- [ ] Variables de entorno diferentes en dev/prod
- [ ] Backups encriptados de credenciales en lugar seguro
- [ ] Equipo capacitado en manejo de secretos

## 🆘 Contactos de Emergencia

Si detectas una exposición de credenciales:

1. **Revocar credenciales inmediatamente**
2. **Notificar al equipo de seguridad**
3. **Revisar logs de acceso**
4. **Generar nuevas credenciales**
5. **Actualizar todos los servicios**

---

**Última actualización**: 3 de febrero de 2026  
**Responsable**: Equipo de Desarrollo Cotransmeq
