# Guía para Configurar Permisos de S3 en AWS

## Error Actual
```
User: arn:aws:iam::949486796286:user/transmeralda_user is not authorized to perform: s3:PutObject
```

## Solución: Agregar Política de Permisos al Usuario IAM

### Opción 1: Usar la Consola de AWS (Recomendado)

1. **Accede a la Consola de AWS IAM**
   - Ve a: https://console.aws.amazon.com/iam/
   - Inicia sesión con tu cuenta

2. **Encuentra el Usuario**
   - En el menú lateral, selecciona "Users" (Usuarios)
   - Busca y haz clic en: `transmeralda_user`

3. **Agregar Política de Permisos**
   - Ve a la pestaña "Permissions" (Permisos)
   - Haz clic en "Add permissions" → "Add inline policy"
   - Selecciona la pestaña "JSON"

4. **Pega esta Política JSON**

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CotransmeqBucketFullAccess",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetObjectAcl",
                "s3:PutObjectAcl"
            ],
            "Resource": [
                "arn:aws:s3:::cotransmeq",
                "arn:aws:s3:::cotransmeq/*"
            ]
        }
    ]
}
```

5. **Guardar la Política**
   - Haz clic en "Review policy"
   - Dale un nombre: `CotransmeqS3FullAccess`
   - Haz clic en "Create policy"

---

### Opción 2: Usar AWS CLI

Si prefieres usar la línea de comandos:

```bash
# 1. Crea un archivo con la política
cat > s3-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CotransmeqBucketFullAccess",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject",
                "s3:ListBucket",
                "s3:GetObjectAcl",
                "s3:PutObjectAcl"
            ],
            "Resource": [
                "arn:aws:s3:::cotransmeq",
                "arn:aws:s3:::cotransmeq/*"
            ]
        }
    ]
}
EOF

# 2. Aplica la política al usuario
aws iam put-user-policy \
    --user-name transmeralda_user \
    --policy-name CotransmeqS3FullAccess \
    --policy-document file://s3-policy.json
```

---

### Opción 3: Política más Restrictiva (Solo Carpetas Específicas)

Si quieres permisos solo para carpetas específicas (conductores, vehiculos, etc.):

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CotransmeqSpecificFoldersAccess",
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:GetObject",
                "s3:DeleteObject"
            ],
            "Resource": [
                "arn:aws:s3:::cotransmeq/conductores/*",
                "arn:aws:s3:::cotransmeq/vehiculos/*",
                "arn:aws:s3:::cotransmeq/servicios/*",
                "arn:aws:s3:::cotransmeq/asistencias/*",
                "arn:aws:s3:::cotransmeq/planillas/*"
            ]
        },
        {
            "Sid": "ListBucket",
            "Effect": "Allow",
            "Action": "s3:ListBucket",
            "Resource": "arn:aws:s3:::cotransmeq"
        }
    ]
}
```

---

## Verificación de Permisos

Después de aplicar la política, verifica que funcione:

### Usando AWS CLI:
```bash
# Verifica que puedes listar el bucket
aws s3 ls s3://cotransmeq/

# Intenta subir un archivo de prueba
echo "test" > test.txt
aws s3 cp test.txt s3://cotransmeq/test.txt

# Si funciona, elimina el archivo de prueba
aws s3 rm s3://cotransmeq/test.txt
rm test.txt
```

### Desde tu aplicación:
Una vez aplicados los permisos, reinicia el backend y prueba subir una foto de conductor nuevamente.

---

## Configuración del Bucket S3 (Opcional pero Recomendado)

### 1. Habilitar CORS en el Bucket

Si subes archivos directamente desde el navegador, necesitas configurar CORS:

1. Ve a la consola de S3: https://console.aws.amazon.com/s3/
2. Selecciona el bucket `cotransmeq`
3. Ve a la pestaña "Permissions" → "CORS"
4. Agrega esta configuración:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
        "AllowedOrigins": ["*"],
        "ExposeHeaders": ["ETag"]
    }
]
```

### 2. Configurar Acceso Público (Solo si es necesario)

Si necesitas que las imágenes sean públicamente accesibles:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "PublicReadGetObject",
            "Effect": "Allow",
            "Principal": "*",
            "Action": "s3:GetObject",
            "Resource": "arn:aws:s3:::cotransmeq/*"
        }
    ]
}
```

**⚠️ Advertencia**: Esto hace que TODO el contenido del bucket sea público. Úsalo solo si es necesario.

---

## Troubleshooting

### Si los permisos no funcionan inmediatamente:
1. Espera 1-2 minutos (propagación de políticas en AWS)
2. Reinicia tu aplicación backend
3. Verifica que las credenciales en `.env` sean correctas

### Si persiste el error:
1. Verifica que el usuario IAM existe: `transmeralda_user`
2. Verifica que las credenciales (ACCESS_KEY_ID y SECRET_ACCESS_KEY) sean del usuario correcto
3. Verifica que el bucket `cotransmeq` existe y está en la región correcta (`us-east-2`)

---

## Contacto de Soporte

Si necesitas ayuda adicional, contacta a tu administrador de AWS o revisa la documentación oficial:
- https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html
- https://docs.aws.amazon.com/s3/
