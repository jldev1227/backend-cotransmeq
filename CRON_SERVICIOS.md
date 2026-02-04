# CRON Service - Actualización Automática de Servicios

## 📋 Descripción

El sistema incluye un **CRON job automático** que se ejecuta cada hora para actualizar el estado de los servicios planificados.

## ⏰ Funcionamiento

### Ejecución Automática
- **Frecuencia**: Cada hora (en el minuto 0)
- **Expresión CRON**: `0 * * * *`
- **Inicio automático**: Al iniciar el servidor backend

### Lógica de Actualización

El CRON busca servicios que cumplan **TODAS** estas condiciones:

1. **Estado**: `planificado`
2. **Fecha de realización**: Igual o anterior a la fecha/hora actual

Cuando encuentra servicios que cumplen estas condiciones, los actualiza automáticamente a:
- **Nuevo estado**: `en_curso`
- **Observaciones**: Agrega nota con fecha de actualización automática

## 🚀 Uso

### Inicio Automático

El CRON se inicia automáticamente cuando arrancas el servidor:

```bash
npm run dev
# o
npm start
```

Verás en la consola:
```
🕐 [CRON] Iniciando tareas programadas...
✅ [CRON] Tareas programadas iniciadas:
   - Actualización de servicios planificados: cada hora
```

### Ejecución Manual (Testing)

Para probar la actualización sin esperar la hora:

```bash
curl -X POST http://localhost:3001/api/cron/ejecutar-actualizacion
```

Respuesta:
```json
{
  "success": true,
  "message": "Actualización manual ejecutada correctamente",
  "timestamp": "2026-02-04T12:00:00.000Z"
}
```

## 📊 Salida de Ejemplo

Cuando el CRON encuentra servicios para actualizar:

```
⏰ [CRON] Ejecutando actualización de servicios planificados - 2026-02-04T12:00:00.000Z
📋 [CRON] Encontrados 3 servicio(s) para actualizar:

   ✅ Servicio actualizado:
      - Planilla: PL-2026-001
      - Conductor: Juan Pérez
      - Vehículo: ABC123
      - Fecha realización: 4/2/2026, 11:00:00 a. m.
      - Estado: PLANIFICADO → EN_CURSO

   ✅ Servicio actualizado:
      - Planilla: PL-2026-002
      - Conductor: María López
      - Vehículo: XYZ789
      - Fecha realización: 4/2/2026, 10:30:00 a. m.
      - Estado: PLANIFICADO → EN_CURSO

============================================================
📊 RESUMEN DE ACTUALIZACIÓN AUTOMÁTICA
============================================================
Total encontrados: 3
✅ Actualizados correctamente: 2
❌ Errores: 1
============================================================
```

Cuando NO hay servicios para actualizar:
```
⏰ [CRON] Ejecutando actualización de servicios planificados - 2026-02-04T13:00:00.000Z
ℹ️  [CRON] No hay servicios planificados para actualizar
```

## 🔧 Configuración

### Cambiar Frecuencia de Ejecución

Edita `src/services/cron.service.ts`:

```typescript
// Cada hora (actual)
const updateServiciosTask = cron.schedule('0 * * * *', async () => {
  await this.actualizarServiciosPlanificados()
})

// Cada 30 minutos
const updateServiciosTask = cron.schedule('*/30 * * * *', async () => {
  await this.actualizarServiciosPlanificados()
})

// Cada 15 minutos
const updateServiciosTask = cron.schedule('*/15 * * * *', async () => {
  await this.actualizarServiciosPlanificados()
})

// A las 8:00 AM todos los días
const updateServiciosTask = cron.schedule('0 8 * * *', async () => {
  await this.actualizarServiciosPlanificados()
})
```

### Formato de Expresión CRON

```
 ┌────────────── minuto (0 - 59)
 │ ┌──────────── hora (0 - 23)
 │ │ ┌────────── día del mes (1 - 31)
 │ │ │ ┌──────── mes (1 - 12)
 │ │ │ │ ┌────── día de la semana (0 - 6) (0=Domingo)
 │ │ │ │ │
 * * * * *
```

Ejemplos comunes:
- `0 * * * *` - Cada hora
- `*/30 * * * *` - Cada 30 minutos
- `0 0 * * *` - Todos los días a medianoche
- `0 */6 * * *` - Cada 6 horas
- `0 9 * * 1-5` - Lunes a viernes a las 9 AM

## 🛑 Detener el CRON

El CRON se detiene automáticamente cuando detienes el servidor (SIGINT):

```bash
# Presiona Ctrl+C
```

Verás:
```
📴 Shutting down server...
🛑 [CRON] Deteniendo tareas programadas...
✅ Database disconnected successfully
```

## ⚠️ Notas Importantes

1. **Zona Horaria**: El CRON usa la zona horaria del servidor
2. **Base de Datos**: Asegúrate de que las fechas en la BD están en el formato correcto
3. **Logs**: Todos los eventos se registran en la consola del servidor
4. **Testing**: Usa el endpoint manual para probar sin esperar
5. **Concurrencia**: El CRON no se ejecuta múltiples veces simultáneamente

## 📝 Dependencias

- `node-cron`: ^3.0.3
- `@types/node-cron`: ^3.0.11

## 🔍 Troubleshooting

### El CRON no se ejecuta

1. Verifica que el servidor esté corriendo
2. Revisa los logs de inicio: debe aparecer "Tareas programadas iniciadas"
3. Verifica la expresión CRON

### Los servicios no se actualizan

1. Verifica que los servicios tengan estado `planificado`
2. Verifica que `fecha_realizacion` sea <= fecha actual
3. Ejecuta manualmente para ver detalles del error

### Testing

```typescript
// En src/services/cron.service.ts
// Cambia temporalmente la expresión a:
const updateServiciosTask = cron.schedule('* * * * *', async () => {
  // Se ejecutará cada minuto para testing
})
```

## 🎯 Beneficios

✅ **Automático**: No requiere intervención manual
✅ **Preciso**: Se ejecuta exactamente cada hora
✅ **Visible**: Logs detallados de cada ejecución
✅ **Testeable**: Endpoint manual para pruebas
✅ **Confiable**: Manejo de errores por servicio
✅ **Escalable**: Fácil agregar más tareas programadas

## 🚀 Próximas Mejoras

- [ ] Agregar notificaciones por email/SMS
- [ ] Dashboard de histórico de ejecuciones
- [ ] Configuración de frecuencia desde UI
- [ ] Métricas de performance
- [ ] Alertas si falla la actualización
