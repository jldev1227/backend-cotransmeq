# Semillas HSEQ — formularios dinámicos

Trece formatos HSEQ transcritos desde `documentos_transmeralda.zip` (inspeccionado
el 19-08-2026) al modelo del módulo `formularios-dinamicos`.

**Estos archivos no son datos: son artefactos revisables.** Ninguno está cargado en
ninguna base. Todos producen versiones en `DRAFT` y ninguno crea asignaciones.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `types.ts` | Forma de una semilla: identidad, sugerencias de asignación, procedencia documental y advertencias de transcripción. |
| `ids.ts` | UUID v5 determinístico. El id del formulario depende del código; el de la versión, del código **y** la revisión documental. |
| `factories.ts` | Los nueve patrones reutilizables (escalas de estado, ítem de inspección con observación condicional, plan de acción, firma…). |
| `preoperacional-comun.ts` | Base compartida por FR-08 y FR-09, que coinciden en el 80 % de los ítems. |
| `hseq-fr-*.ts` | Una semilla por código. |
| `index.ts` | Registro de las trece, en el orden de revisión recomendado. |
| `validate.ts` | Validación e inventario, **sin base de datos**. |
| `inventario.ts` | Genera `INVENTARIO.txt` para la revisión de HSEQ. |
| `cargar.ts` | Cargador idempotente. **Simulacro por defecto.** |
| `INVENTARIO.txt` | Último informe generado. |

## Revisar antes de cargar

```bash
npm run seeds:formularios:inventario
```

Valida las trece con el **mismo** `validateFormDefinition` que ejecuta el
`publish` del backend, y escribe `INVENTARIO.txt` con:

- conteo de secciones, campos, opciones y reglas por código;
- errores (bloquean la publicación) y advertencias del validador;
- las notas de transcripción de cada semilla — discrepancias de versión, erratas
  del original, decisiones que HSEQ debe confirmar;
- el checklist previo a publicar.

Sale con código 1 si algo falla, así que sirve en un pipeline.

## Cargar (lo hace el usuario)

Requisitos previos, en este orden:

1. **Aplicar a mano** el SQL de
   `prisma/migrations/19-08-2026-formularios-dinamicos/migration.sql`.
2. Revisar `INVENTARIO.txt` con HSEQ y resolver las notas de transcripción.

```bash
# Simulacro: valida e imprime los ids que se usarían. NO escribe nada.
npm run seeds:formularios:cargar

# Carga real
npm run seeds:formularios:cargar -- --apply --user <uuid-de-users.id>

# Una sola semilla
npm run seeds:formularios:cargar -- --apply --user <uuid> --only HSEQ-FR-22
```

El cargador es idempotente: los ids son determinísticos y cada nodo se escribe con
`upsert`. Volver a cargar actualiza etiquetas y ayuda sin duplicar nada. Si la
versión ya está `PUBLISHED`, **aborta**: sobrescribir el árbol de una versión
publicada rompería los envíos que la referencian.

## Decisiones de transcripción que aplican a todas

**Las columnas de fecha del Excel no se transcriben como campos.** Varios formatos
imprimen seis o siete columnas para cubrir una semana o un semestre en una sola
hoja. En el motor dinámico cada diligenciamiento es un envío con su
`business_date`, y el historial se consulta en la lista de envíos. Transcribirlas
produciría formularios que hay que rellenar siete veces el lunes.

**Los duplicados de impresión no crean formularios.** FR-07 imprime dos copias del
mismo formato en la misma hoja; FR-42 tiene dos hojas de formato (se usa la más
completa, `Formato`). Se transcribe una vez.

**Las listas en blanco del papel se vuelven grupos repetibles.** Las nueve
observaciones numeradas de FR-56, el plan de acción de FR-21 o las reposiciones de
FR-05 están en blanco en el papel porque el papel obliga a fijar el número de
renglones. Como repetibles, una inspección puede tener cero o quince.

**Las listas cerradas siguen siendo campos fijos.** Los once elementos del kit de
derrames o los 33 del botiquín NO son repetibles: la lista la define el documento y
el inspector no debe poder quitar renglones. Un repetible ahí permitiría entregar
un botiquín «completo» con tres elementos.

**Cada ítem de inspección lleva su propia observación condicional.** Se exige y se
muestra solo cuando el estado es negativo. Una observación por sección obligaría a
leer texto libre para averiguar a cuál de treinta ítems se refería.

**Las erratas del original se conservan o se corrigen, pero siempre se declaran.**
Cada semilla lista en `warnings` lo que se cambió y por qué.

## Si HSEQ pide cambios

Edita el archivo de la semilla, vuelve a correr el inventario y recarga. Si el
cambio corresponde a una **revisión nueva del documento**, actualiza
`source.sourceRevision`: los ids de versión cambian y la carga crea una versión
nueva en vez de pisar la anterior, que puede tener envíos colgando.
