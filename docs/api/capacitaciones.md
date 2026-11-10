# Capacitaciones

Módulo interno de Cotransmeq para personal administrativo y conductores. Los cursos,
lecciones, asignaciones, progreso, evaluaciones, plantillas faciales cifradas y
certificados viven en la base PostgreSQL de esta aplicación. No requiere un LMS
externo ni SSO.

## Acceso

- Personal administrativo: sesión del equipo y permiso `capacitaciones:read`.
- Gestión: rol `admin` o área `administracion`, `talento_humano` o `hseq`.
- Conductor: token revocable del portal y recursos limitados a su propio ID.
- Verificación pública: solo código, nombre, curso y vigencia del certificado.

## Rutas

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/capacitaciones/cursos` | Cursos asignados al administrativo autenticado |
| GET | `/api/capacitaciones/cursos/:id` | Módulos, lecciones y progreso propios |
| PUT | `/api/capacitaciones/cursos/:id/lecciones/:leccionId/progreso` | Registrar avance |
| POST | `/api/capacitaciones/cursos/:id/evaluacion` | Corregir evaluación y emitir certificado si aprueba |
| GET/POST/DELETE | `/api/capacitaciones/biometria` y `/enrolar` | Estado, registro y eliminación facial |
| POST | `/api/capacitaciones/cursos/:id/biometria/verificar` | Verificación previa a evaluación |
| GET | `/api/capacitaciones/cursos/:id/certificado` | Certificado propio |
| GET | `/api/capacitaciones/cursos/:id/certificado/pdf` | Descarga PDF con código y QR de verificación |
| GET/POST/PUT/DELETE | `/api/capacitaciones/gestion/*` | Cursos, módulos, lecciones, preguntas y asignaciones |
| GET | `/api/capacitaciones/certificados/verificar/:codigo` | Verificación pública |

Los conductores usan las mismas rutas de alumno bajo
`/api/conductor-portal/capacitaciones`. La ruta antigua
`/api/conductor-portal/capacitaciones` se conserva para el historial HSEQ.

## Datos y despliegue

Ejecutar las migraciones `20261025120000_capacitaciones_nativas` y
`20261025140000_capacitaciones_archivos` antes de abrir el módulo. El editor
organiza módulos y lecciones, permite subir video, audio, PDF, PPTX, Markdown,
H5P y SCORM, y presenta una vista previa. El banco de preguntas admite edición,
vista previa e importación JSON. Los paquetes H5P y SCORM se conservan como
archivos privados descargables: falta el reproductor ejecutable y el seguimiento
de eventos de esos formatos. Se valida que el ZIP tenga `h5p.json` o
`imsmanifest.xml` en la raíz, con límite de 200 MB y expansión declarada de
1 GB. Las presentaciones PPTX se convierten a PDF para
vista previa si `soffice` está instalado en el backend.

El navegador genera un
vector facial de 128 dimensiones tras pruebas de vida. El backend cifra el
vector con AES-256-GCM mediante una clave derivada del secreto JWT. Rotar dicho
secreto invalida los registros faciales existentes; se deben volver a enrolar.
La imagen no se envía ni se almacena.

## Archivos de cursos

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/capacitaciones/gestion/cursos/:id/archivos/iniciar` | Reserva un archivo, valida tipo/tamaño y devuelve URL de subida |
| POST | `/api/capacitaciones/gestion/archivos/:id/contenido` | Subida local multipart (hasta 200 MB) |
| POST | `/api/capacitaciones/gestion/archivos/:id/confirmar` | Comprueba una subida S3 directa |
| POST | `/api/capacitaciones/gestion/archivos/:id/multipart/completar` | Valida y completa una subida S3 por partes |
| POST | `/api/capacitaciones/gestion/archivos/:id/multipart/abortar` | Aborta una subida S3 incompleta |
| GET | `/api/capacitaciones/gestion/archivos/:id/url` | URL firmada y vista previa PDF, si existe |
| GET | `/api/capacitaciones/archivos/:id/contenido` | Lectura local firmada; admite rangos HTTP |

`CAP_CONTENT_MODE=local` guarda archivos en `CAP_CONTENT_ROOT` (por defecto
`.data/capacitaciones`). Debe ser un volumen persistente con copia de seguridad.
El `docker-compose.yml` monta `cap_course_files` en esa ruta para conservar
archivos entre despliegues mientras se habilita S3.
Para un almacén S3 compatible independiente: `CAP_CONTENT_MODE=s3`,
`CAP_S3_ENDPOINT` HTTPS, `CAP_S3_BUCKET`, `CAP_S3_ACCESS_KEY`,
`CAP_S3_SECRET_KEY` y opcional `CAP_S3_REGION`. El endpoint debe ser accesible
desde el navegador para subir y leer archivos; configurar CORS para los orígenes
web de ambas empresas y los métodos GET, PUT, HEAD. Usar buckets separados
por empresa y credenciales de mínimo acceso. Archivos S3 mayores a 64 MiB usan
fragmentos firmados de 8 MiB y se completan después de validar ETag y tamaño;
así no dependen del límite de cuerpo de una única solicitud en Cloudflare.
Garage puede devolver 403 en `HEAD` para objetos completados por multipart; por
eso el backend verifica sus partes con `ListParts` antes de completarlos y usa
la lectura del objeto para validar paquetes H5P/SCORM.
`CAP_SOFFICE_PATH` permite señalar el ejecutable de LibreOffice cuando no está
en PATH.

El despliegue en Proxmox (Garage S3, túnel HTTPS, dos buckets y estado de
respaldos) está en [`ops/course-storage/README.md`](../../ops/course-storage/README.md).

## Inventario de rutas verificadas

Las rutas siguientes completan el listado anterior con cada método y parámetro concreto.

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/capacitaciones/archivos/:id/contenido` | Consulta de capacitaciones |
| DELETE | `/api/capacitaciones/biometria` | Operación de capacitaciones |
| GET | `/api/capacitaciones/biometria` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/biometria/enrolar` | Operación de capacitaciones |
| GET | `/api/capacitaciones/certificados/verificar/:codigo` | Consulta de capacitaciones |
| GET | `/api/capacitaciones/cursos` | Consulta de capacitaciones |
| GET | `/api/capacitaciones/cursos/:id` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/cursos/:id/biometria/verificar` | Operación de capacitaciones |
| GET | `/api/capacitaciones/cursos/:id/certificado` | Consulta de capacitaciones |
| GET | `/api/capacitaciones/cursos/:id/certificado/pdf` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/cursos/:id/evaluacion` | Operación de capacitaciones |
| PUT | `/api/capacitaciones/cursos/:id/lecciones/:leccionId/progreso` | Operación de capacitaciones |
| GET | `/api/capacitaciones/gestion/acceso` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/gestion/archivos/:id/confirmar` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/archivos/:id/contenido` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/archivos/:id/multipart/abortar` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/archivos/:id/multipart/completar` | Operación de capacitaciones |
| GET | `/api/capacitaciones/gestion/archivos/:id/url` | Consulta de capacitaciones |
| GET | `/api/capacitaciones/gestion/cursos` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/gestion/cursos` | Operación de capacitaciones |
| GET | `/api/capacitaciones/gestion/cursos/:id` | Consulta de capacitaciones |
| PUT | `/api/capacitaciones/gestion/cursos/:id` | Operación de capacitaciones |
| GET | `/api/capacitaciones/gestion/cursos/:id/archivos` | Consulta de capacitaciones |
| POST | `/api/capacitaciones/gestion/cursos/:id/archivos/iniciar` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/cursos/:id/asignaciones` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/cursos/:id/modulos` | Operación de capacitaciones |
| PUT | `/api/capacitaciones/gestion/cursos/:id/modulos/:moduloId` | Operación de capacitaciones |
| PUT | `/api/capacitaciones/gestion/cursos/:id/preguntas` | Operación de capacitaciones |
| DELETE | `/api/capacitaciones/gestion/lecciones/:id` | Operación de capacitaciones |
| DELETE | `/api/capacitaciones/gestion/modulos/:id` | Operación de capacitaciones |
| POST | `/api/capacitaciones/gestion/modulos/:moduloId/lecciones` | Operación de capacitaciones |
| PUT | `/api/capacitaciones/gestion/modulos/:moduloId/lecciones/:leccionId` | Operación de capacitaciones |
| GET | `/api/capacitaciones/gestion/personas` | Consulta de capacitaciones |
| DELETE | `/api/conductor-portal/capacitaciones/biometria` | Operación de capacitaciones |
| GET | `/api/conductor-portal/capacitaciones/biometria` | Consulta de capacitaciones |
| POST | `/api/conductor-portal/capacitaciones/biometria/enrolar` | Operación de capacitaciones |
| GET | `/api/conductor-portal/capacitaciones/cursos` | Consulta de capacitaciones |
| GET | `/api/conductor-portal/capacitaciones/cursos/:id` | Consulta de capacitaciones |
| POST | `/api/conductor-portal/capacitaciones/cursos/:id/biometria/verificar` | Operación de capacitaciones |
| GET | `/api/conductor-portal/capacitaciones/cursos/:id/certificado` | Consulta de capacitaciones |
| GET | `/api/conductor-portal/capacitaciones/cursos/:id/certificado/pdf` | Consulta de capacitaciones |
| POST | `/api/conductor-portal/capacitaciones/cursos/:id/evaluacion` | Operación de capacitaciones |
| PUT | `/api/conductor-portal/capacitaciones/cursos/:id/lecciones/:leccionId/progreso` | Operación de capacitaciones |
