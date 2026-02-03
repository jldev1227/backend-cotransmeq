# 🚀 GUÍA RÁPIDA: Migración a Azure PostgreSQL

## 📋 Resumen
Has creado 2 scripts para migrar tu base de datos PostgreSQL actual a Azure:
1. **check-databases.ts** - Verifica conexiones y compara registros
2. **migrate-to-azure.ts** - Migra todos los datos

---

## ⚡ PASOS RÁPIDOS

### 1️⃣ Instalar Dependencias (Solo una vez)
```bash
cd backend-nest
npm install pg @types/pg
```

### 2️⃣ Configurar Base de Datos ORIGEN

Edita `scripts/migrate-to-azure.ts` y `scripts/check-databases.ts` (líneas 4-11):

```typescript
const sourceDb = new Client({
  host: 'localhost',              // ← TU HOST AQUÍ
  port: 5432,                     // ← TU PUERTO
  user: 'postgres',               // ← TU USUARIO
  password: 'tu_password',        // ← TU PASSWORD
  database: 'cotransmeq',       // ← NOMBRE DE TU DB
  ssl: false
});
```

### 3️⃣ Verificar Conexión (RECOMENDADO)
```bash
npm run migrate:check
```

Esto te mostrará:
- ✅ Si las conexiones funcionan
- 📊 Cuántos registros hay en cada tabla
- ⚠️ Diferencias entre origen y destino

### 4️⃣ Hacer Backup (IMPORTANTE)
```bash
# Backup de tu DB origen
pg_dump -h localhost -U tu_usuario -d cotransmeq -F c -f backup_$(date +%Y%m%d).dump

# Backup de Azure (opcional)
pg_dump -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -F c -f backup_azure_$(date +%Y%m%d).dump
```

### 5️⃣ Ejecutar Migración
```bash
npm run migrate:to-azure
```

El script te pedirá confirmación:
```
⚠️  ADVERTENCIA: Esta operación eliminará los datos existentes en Azure!
⏸️  Presiona Ctrl+C para cancelar o Enter para continuar...
```

Presiona **Enter** para continuar.

### 6️⃣ Verificar Resultado
```bash
# Opción 1: Ejecutar check nuevamente
npm run migrate:check

# Opción 2: Conectar a Azure y verificar
psql -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres
```

---

## 📊 Ejemplo de Salida

### `npm run migrate:check`
```
================================================================================
TABLA                              ORIGEN         DESTINO        DIFERENCIA
================================================================================
usuarios                           15             15             ✅ IGUAL
conductores                        42             42             ✅ IGUAL
vehiculos                          38             38             ✅ IGUAL
clientes                           12             12             ✅ IGUAL
servicio                           1,234          1,234          ✅ IGUAL
================================================================================

📈 RESUMEN:
   Total registros en ORIGEN: 5,432
   Total registros en DESTINO: 5,432
   Tablas con diferencias: 0

✅ Las bases de datos están sincronizadas!
```

### `npm run migrate:to-azure`
```
🚀 Iniciando migración de base de datos...

[1/34] ▶️  Procesando: usuarios
   📊 Registros en origen: 15
   📤 Insertando datos... 100% (15/15)
   ✅ Migración completada: 15 registros copiados

[2/34] ▶️  Procesando: conductores
   📊 Registros en origen: 42
   📤 Insertando datos... 100% (42/42)
   ✅ Migración completada: 42 registros copiados

...

================================================================================
📊 RESUMEN DE MIGRACIÓN
================================================================================

✅ Tablas migradas exitosamente: 32
⚠️  Tablas saltadas (vacías/no existen): 2
❌ Tablas con errores: 0
📊 Total de registros copiados: 5,432
⏱️  Duración total: 45.32s

🎉 Migración completada!
```

---

## ❓ Problemas Comunes

### ❌ "Cannot find module 'pg'"
```bash
npm install pg @types/pg
```

### ❌ "connection refused"
- Verifica que tu base de datos origen esté corriendo
- Revisa los datos de conexión (host, port, user, password)
- Asegúrate de que Azure permite conexiones desde tu IP

### ❌ "relation does not exist"
La tabla no existe en Azure. Ejecuta las migraciones de Prisma:
```bash
npx prisma migrate deploy
```

### ❌ "authentication failed"
- Verifica usuario y password
- En Azure, asegúrate de usar el formato: `usuario@servidor` si es necesario

---

## 🎯 Comandos Útiles

```bash
# Ver todas las tablas en Azure
psql -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -c "\dt"

# Contar registros en una tabla específica
psql -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -c "SELECT COUNT(*) FROM usuarios;"

# Ver estructura de una tabla
psql -h cotransmeq.postgres.database.azure.com -U admintransmeralda -d postgres -c "\d usuarios"
```

---

## 📝 Notas Importantes

1. **El script TRUNCATE las tablas** en Azure antes de insertar. Esto significa que **borrará los datos existentes**.

2. **El orden importa**: Las tablas se migran en orden para respetar las foreign keys.

3. **Los IDs se mantienen**: Los UUIDs originales se conservan, por lo que las relaciones se mantienen intactas.

4. **Secuencias automáticas**: El script reinicia las secuencias al final para que los nuevos registros no tengan conflictos.

5. **Transacciones**: Cada tabla se migra de forma independiente, si una falla, las demás continúan.

---

## 🔧 Personalización

### Migrar solo algunas tablas

Edita `tablesToMigrate` en `migrate-to-azure.ts`:

```typescript
const tablesToMigrate = [
  'usuarios',
  'conductores',
  // 'vehiculos', // ← Comentar para no migrar
];
```

### Cambiar tamaño de lote

Edita la línea 127 en `migrate-to-azure.ts`:

```typescript
const batchSize = 500; // ← Aumentar para mayor velocidad
```

---

## ✅ Checklist Final

Antes de migrar, asegúrate de:

- [ ] Instalar dependencias (`npm install pg @types/pg`)
- [ ] Configurar datos de origen en ambos scripts
- [ ] Hacer backup de ambas bases de datos
- [ ] Verificar conexiones con `npm run migrate:check`
- [ ] Ejecutar en horario de bajo tráfico
- [ ] Tener acceso a ambas bases de datos
- [ ] Verificar que Prisma haya creado todas las tablas en Azure

---

📚 **Documentación completa**: Ver `MIGRATION_README.md` para más detalles.

🆘 **Soporte**: Si tienes problemas, revisa los logs completos y verifica las conexiones.
