# STEP 4 Y STEP 5 - ESPECIFICACIÓN FUNCIONAL Y LÓGICA DE NEGOCIO

## Objetivo

Implementar los pasos 4 (Aprobación del Plan de Acción) y 5 (Estado de la Acción) de un flujo de gestión de hallazgos HSEQ.

No implementar diseño visual específico ni paleta de colores. Concentrarse exclusivamente en:

* Estructura de datos.
* Campos.
* Reglas de negocio.
* Validaciones.
* Dependencias entre secciones.
* Lógica dinámica.

---

# STEP 4 - APROBACIÓN DEL PLAN DE ACCIÓN

## Descripción

La sección de aprobación es dinámica.

Su contenido depende del tipo de hallazgo seleccionado previamente en el Step 1.

La sección no debe mostrar campos hasta que exista un tipo de hallazgo seleccionado.

---

## Regla de priorización

Cuando existan múltiples hallazgos activos simultáneamente, la aprobación debe seguir la siguiente prioridad:

1. No Conformidad Mayor
2. No Conformidad Menor
3. Observación
4. Posibilidad de Mejora

El sistema debe determinar automáticamente cuál es el hallazgo prioritario y construir la cadena de aprobación correspondiente.

---

# Estructura de datos

```typescript
type HallazgoTipo =
  | "NC_MAYOR"
  | "NC_MENOR"
  | "OBSERVACION"
  | "MEJORA";
```

---

## Campo principal

```typescript
hallazgoTipo: HallazgoTipo
```

---

# Configuración de flujo de aprobación

La cadena de aprobación debe construirse desde configuración.

Ejemplo:

```typescript
const approvalFlow = {
  NC_MAYOR: [
    "ResponsableProceso",
    "CoordinadorHSEQ",
    "Gerencia"
  ],

  NC_MENOR: [
    "ResponsableProceso",
    "CoordinadorHSEQ"
  ],

  OBSERVACION: [
    "ResponsableProceso"
  ],

  MEJORA: [
    "ResponsableProceso"
  ]
};
```

---

# Estructura de aprobadores

```typescript
interface ApprovalUser {
  id: string;
  nombre: string;
  cargo: string;
}
```

---

# Registro de aprobación

```typescript
interface ApprovalRecord {
  rol: string;
  aprobador: ApprovalUser | null;

  estado:
    | "PENDIENTE"
    | "APROBADO"
    | "RECHAZADO";

  fecha: Date | null;

  comentario: string;
}
```

---

# Estado completo de la sección

```typescript
interface Step4Approval {
  hallazgoTipo: HallazgoTipo;

  approvals: ApprovalRecord[];

  estadoGeneral:
    | "PENDIENTE"
    | "EN_REVISION"
    | "APROBADO"
    | "RECHAZADO";
}
```

---

# Reglas de negocio

## Regla 1

Si no existe tipo de hallazgo:

```typescript
hallazgoTipo == null
```

Mostrar:

```text
Seleccione el tipo de hallazgo para visualizar el flujo de aprobación.
```

---

## Regla 2

Al seleccionar un tipo de hallazgo:

```typescript
hallazgoTipo != null
```

Generar automáticamente:

```typescript
approvalFlow[hallazgoTipo]
```

---

## Regla 3

La aprobación debe ser secuencial.

Un aprobador no puede aprobar hasta que el anterior esté aprobado.

Ejemplo:

```text
Responsable Proceso
↓
Coordinador HSEQ
↓
Gerencia
```

---

## Regla 4

Si algún aprobador rechaza:

```typescript
estado = RECHAZADO
```

Entonces:

```typescript
estadoGeneral = RECHAZADO
```

y se bloquean los aprobadores siguientes.

---

## Regla 5

Si todos aprueban:

```typescript
estadoGeneral = APROBADO
```

---

# STEP 5 - ESTADO DE LA ACCIÓN

## Descripción

Representa el estado global de la acción registrada.

Debe evaluar:

* Corrección inmediata.
* Planes de acción.
* Cumplimiento de plazos.
* Reprogramaciones.

No representa una tarea individual.

Representa el estado consolidado del caso.

---

# Estados posibles

```typescript
type ActionStatus =
  | "EN_PROCESO"
  | "VENCIDA"
  | "CUMPLIDA"
  | "REPLANTEADA";
```

---

# Campos

## Estado global

```typescript
estadoGlobal: ActionStatus
```

Obligatorio.

---

## Fecha de actualización

```typescript
fechaActualizacion: Date
```

---

## Registrado por

```typescript
registradoPor: string
```

Formato sugerido:

```text
Nombre Apellido - Cargo
```

---

## Observaciones

```typescript
observaciones: string
```

---

# Modelo completo

```typescript
interface Step5ActionStatus {
  estadoGlobal: ActionStatus;

  fechaActualizacion: Date;

  registradoPor: string;

  observaciones: string;
}
```

---

# Reglas de negocio

## Estado EN_PROCESO

Condición:

```typescript
accionesTerminadas = false
```

y

```typescript
fechaLimite >= hoy
```

Resultado:

```typescript
estadoGlobal = EN_PROCESO
```

---

## Estado VENCIDA

Condición:

```typescript
accionesTerminadas = false
```

y

```typescript
fechaLimite < hoy
```

Resultado:

```typescript
estadoGlobal = VENCIDA
```

---

## Estado CUMPLIDA

Condición:

```typescript
correccionImplementada = true

AND

planesAccionImplementados = true

AND

evidenciasAdjuntas = true
```

Resultado:

```typescript
estadoGlobal = CUMPLIDA
```

---

## Estado REPLANTEADA

Condición:

Existe una nueva fecha objetivo aprobada.

```typescript
fechaReprogramada != null
```

y

```typescript
justificacion != ""
```

Resultado:

```typescript
estadoGlobal = REPLANTEADA
```

---

# Dependencia con Step 6

La evaluación de eficacia (Step 6) solo puede habilitarse cuando:

```typescript
estadoGlobal === "CUMPLIDA"
```

---

## Regla de bloqueo

Si:

```typescript
estadoGlobal !== "CUMPLIDA"
```

Entonces:

```typescript
Step6.disabled = true
```

Mostrar mensaje:

```text
La evaluación de eficacia solo puede realizarse cuando la acción registrada se encuentre en estado Cumplida.
```

---

# Validaciones obligatorias

## Step 4

* Debe existir hallazgo seleccionado.
* Debe existir flujo de aprobación.
* Debe existir al menos un aprobador.
* No permitir saltos de aprobación.
* No permitir aprobación posterior si existe rechazo previo.

---

## Step 5

* Estado global obligatorio.
* Fecha de actualización obligatoria.
* Registrado por obligatorio.
* Observaciones recomendadas.
* Si estado = REPLANTEADA, exigir justificación y nueva fecha.
* Si estado = CUMPLIDA, verificar evidencia asociada.

---

# Resultado esperado

Generar componentes desacoplados:

```typescript
<Step4Approval />
<Step5ActionStatus />
```

Con estado administrado mediante:

```typescript
React Context
Redux
Zustand
o equivalente
```

Toda la lógica debe ser independiente de la capa visual para permitir reutilización en Web, Mobile o sistemas BPM.
