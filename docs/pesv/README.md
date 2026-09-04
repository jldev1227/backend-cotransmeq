# Centro integral PESV

Este directorio es la especificación funcional y técnica para transformar el módulo PESV
existente en un centro de cumplimiento para una empresa de transporte terrestre automotor
especial. La implementación se administra como nivel **Avanzado**: aplican los 24 pasos de
la metodología y los 13 indicadores mínimos.

El módulo no reemplaza Flota, Conductores, Servicios, Formularios, Asistencias, Acciones
Correctivas, Terceros ni Extractos. Esos dominios siguen siendo las fuentes operativas; PESV
los consolida, revisa su calidad, vincula evidencias y permite demostrar de dónde salió cada
resultado.

## Resultado esperado

- Un ciclo PESV por año, con líder, responsables, metas, riesgos y plan anual.
- Matriz de los 24 pasos con estado, fecha límite, responsable y evidencias revisadas.
- Los 13 indicadores con fórmula, numerador, denominador, meta, tendencia y procedencia.
- Alertas de documentos, jornadas, velocidad, inspecciones, mantenimiento, siniestros y FUEC.
- Expediente auditable: un indicador permite llegar al registro y soporte que lo originó.
- Flujo de aporte por áreas y aprobación exclusiva de HSEQ o Administración.

## Decisiones cerradas

1. El nivel de implementación es `AVANZADO`; no se reduce automáticamente por el tamaño
   observado en un mes.
2. Un envío válido de Formularios Dinámicos es la fuente oficial de una inspección
   preoperacional nueva. Los checks PESV manuales quedan como histórico.
3. Una evidencia vinculada o cargada no acredita cumplimiento hasta ser aprobada por HSEQ.
4. Un indicador sin insumos suficientes se presenta como `SIN_DATOS`, nunca como cero.
5. Contratos y FUEC se gestionan en Extractos; PESV controla su cobertura y trazabilidad.
6. Las migraciones son aditivas, conservan históricos y usan borrado lógico.

## Flujo de información

```text
Módulos operativos
    │
    ├── registros confiables ───────────────┐
    ├── soportes candidatos                 │
    └── inconsistencias                     │
                                             ▼
                                  Normalización PESV
                                             │
                              revisión y aprobación HSEQ
                                             │
                    ┌────────────────────────┴───────────────────────┐
                    ▼                                                ▼
             Expediente 24 pasos                            13 indicadores
                    └────────────────────────┬───────────────────────┘
                                             ▼
                              Dashboard y autogestión
```

## Documentos del expediente

- [Requisitos normativos](README_REQUISITOS_NORMATIVOS.md)
- [Datos y trazabilidad](README_DATOS_Y_TRAZABILIDAD.md)
- [Indicadores](README_INDICADORES.md)
- [Arquitectura backend](README_ARQUITECTURA_BACKEND.md)
- [Contratos y FUEC](README_CONTRATOS_FUEC.md)
- [Implementación y QA](README_IMPLEMENTACION_QA.md)
- [**Lo que se implementó, y en qué difiere del diseño**](README_IMPLEMENTADO.md) —
  correspondencia real entre esta especificación y el código, decisiones que
  cambiaron al encontrarse con el esquema, y el procedimiento de migración.
- [Dashboard frontend](../../../cotransmeq-app/docs/pesv/README_DASHBOARD_FRONTEND.md)
- [Flujos de usuario](../../../cotransmeq-app/docs/pesv/README_FLUJOS_USUARIO.md)

## Marco de referencia

- [Resolución 20223040040595 de 2022 y metodología PESV](https://mintransporte.gov.co/info/mintransporte/media/anexos/6xstrxQ1.pdf),
  compilada en el Anexo 63 de la Resolución Única 20223040045295.
- [Decreto 1252 de 2021](https://www.suin-juriscol.gov.co/viewDocument.asp?ruta=Decretos/30042173)
  y Decreto 1079 de 2015.
- [Resolución 6652 de 2019 y FUEC](https://mintransporte.gov.co/publicaciones/8167/mintransporte-expide-nuevo-formato-unico-de-extracto-del-contrato-fuec-para-transporte-especial/).
- [Sistema de Información de Seguimiento e Implementación del PESV](https://www.supertransporte.gov.co/index.php/sisi-pesv/)
  de la Superintendencia de Transporte.

La documentación describe controles de producto; HSEQ debe validar periódicamente la matriz
legal y las metas internas antes de cerrar cada ciclo. Referencias consultadas el 3 de
septiembre de 2026; la especificación no reemplaza el concepto del responsable jurídico o HSEQ.
