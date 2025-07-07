# 🚀 API Phantombuster Real - Servidor de Producción

## 📋 Descripción

API de producción que integra directamente con la API real de Phantombuster para extracción de leads de LinkedIn. El servidor ejecuta búsquedas reales en Phantombuster y procesa los resultados incluyendo el campo `connectionDegree` para clasificación automática de leads.

## ✨ Características Principales

### 🔄 Integración Real con Phantombuster

- **API Real**: Integración directa con la API oficial de Phantombuster
- **Búsquedas en tiempo real**: Ejecuta búsquedas reales en LinkedIn a través de Phantombuster
- **Monitoreo de estado**: Consulta el progreso real de las búsquedas en Phantombuster
- **Resultados reales**: Procesa y enriquece los datos reales extraídos de LinkedIn

### 🎯 Clasificación Automática de Leads

- **connectionDegree**: Campo automático basado en datos reales de LinkedIn
- **Mapeo inteligente**: Determina el grado de conexión (`1st`, `2nd`, `3rd`) basado en:
  - Conexiones mutuas
  - Nivel de conexión en LinkedIn
  - Información de red directa
- **Clasificación por tipo**: Mapea automáticamente a tipos de lead (`hot`, `warm`, `cold`)

### 🌍 Procesamiento de Datos Reales

- **Datos reales de LinkedIn**: Nombres, empresas, ubicaciones reales
- **Información de conexiones**: Datos reales de la red de LinkedIn
- **Enriquecimiento automático**: Agrega campos adicionales como `connectionDegree`
- **Validación de datos**: Procesa y valida los datos recibidos de Phantombuster

## 🛠️ Tecnologías Utilizadas

- **Node.js** - Runtime de JavaScript
- **Express.js** - Framework web
- **Helmet** - Seguridad HTTP
- **CORS** - Cross-Origin Resource Sharing
- **Morgan** - Logging de requests
- **Compression** - Compresión de respuestas
- **Rate Limiting** - Limitación de requests
- **Docker** - Containerización

## 🚀 Instalación y Configuración

### Prerrequisitos

- Docker y Docker Compose
- Node.js 18+ (para desarrollo local)

### 1. Clonar el Repositorio

```bash
git clone <repository-url>
cd api-phamthonbuster
```

### 2. Configurar Variables de Entorno

```bash
# Copiar archivo de configuración
cp env.example env

# Editar variables de entorno
nano env
```

### 3. Variables de Entorno Principales

```bash
# Configuración del servidor
NODE_ENV=production
PORT=3001
SKIP_DATABASE=true

# API Key para autenticación
API_KEY=your-secure-api-key

# Phantombuster API (REQUERIDO para producción)
PHANTOMBUSTER_API_KEY=your-phantombuster-api-key
PHANTOMBUSTER_AGENT_ID=your-phantombuster-agent-id

# Redis (opcional para cache)
REDIS_URL=redis://localhost:6379
```

### ⚠️ Configuración de Phantombuster

Para usar la API real de Phantombuster, necesitas:

1. **API Key de Phantombuster**: Obtén tu API key desde el panel de Phantombuster
2. **Agent ID**: ID del agente de LinkedIn que quieres usar para las búsquedas
3. **Configurar el agente**: Asegúrate de que tu agente esté configurado correctamente en Phantombuster

### 4. Ejecutar con Docker

```bash
# Construir y ejecutar
docker compose up --build -d

# Ver logs
docker compose logs -f phantombuster-api

# Detener
docker compose down
```

### 5. Verificar Instalación

```bash
# Health check
curl http://localhost:3001/health

# Verificar API
curl http://localhost:3001/api/health
```

## 📊 Estructura de Datos

### Parámetros de Búsqueda

```json
{
  "searchParams": {
    "job_title": "string", // Título de trabajo
    "industry_codes": ["string"], // Códigos de industria
    "location": "string" // Ubicación (ciudades, país)
  },
  "options": {
    "numberOfResultsPerSearch": 100, // Número de resultados
    "numberOfPagesPerSearch": 10, // Páginas por búsqueda
    "removeDuplicateProfiles": true, // Eliminar duplicados
    "includeEmails": true // Incluir emails
  }
}
```

### Estructura de Resultados

```json
{
  "linkedin_url": "string", // URL del perfil de LinkedIn
  "first_name": "string", // Nombre
  "last_name": "string", // Apellido
  "headline": "string", // Título profesional
  "company_name": "string", // Nombre de la empresa
  "location": "string", // Ubicación
  "industry": "string", // Industria
  "profile_url": "string", // URL del perfil
  "email": "string|null", // Email (puede ser null)
  "phone": "string", // Teléfono
  "extracted_at": "string" // Fecha de extracción
}
```

### Clasificación Automática de Leads por Grado de Conexión

Cuando envías un array de leads con el campo `connectionDegree` (`1st`, `2nd`, `3rd`), el endpoint `/api/leads/process` agrega automáticamente el campo `leadType`:

- `1st` → `hot` (contacto directo)
- `2nd` → `warm` (segundo grado)
- `3rd` o cualquier otro → `cold` (tercer grado o desconocido)

**Ejemplo de request:**

```json
{
  "leads": [
    { "first_name": "Juan", "connectionDegree": "1st" },
    { "first_name": "Ana", "connectionDegree": "2nd" },
    { "first_name": "Pedro", "connectionDegree": "3rd" }
  ]
}
```

**Respuesta:**

```json
{
  "success": true,
  "data": [
    { "first_name": "Juan", "connectionDegree": "1st", "leadType": "hot" },
    { "first_name": "Ana", "connectionDegree": "2nd", "leadType": "warm" },
    { "first_name": "Pedro", "connectionDegree": "3rd", "leadType": "cold" }
  ]
}
```

## 🔍 Endpoints Disponibles

### Health Check (Sin Autenticación)

| Método | Endpoint      | Descripción                 |
| ------ | ------------- | --------------------------- |
| GET    | `/health`     | Estado general del servidor |
| GET    | `/api/health` | Estado de la API            |

### Autenticación y Configuración

| Método | Endpoint             | Descripción                       |
| ------ | -------------------- | --------------------------------- |
| GET    | `/api/auth/validate` | Validar API Key                   |
| GET    | `/api/config`        | Obtener configuración del sistema |

### Búsqueda Automática

| Método | Endpoint                        | Descripción                                   |
| ------ | ------------------------------- | --------------------------------------------- |
| POST   | `/api/search/start`             | Iniciar búsqueda (completada automáticamente) |
| GET    | `/api/search/status/:searchId`  | Estado de búsqueda                            |
| GET    | `/api/search/results/:searchId` | Obtener resultados                            |
| GET    | `/api/search/list`              | Listar todas las búsquedas                    |
| GET    | `/api/search/active`            | Búsquedas activas                             |

### Procesamiento y Clasificación de Leads

| Método | Endpoint             | Descripción                                                          |
| ------ | -------------------- | -------------------------------------------------------------------- |
| POST   | `/api/leads/process` | Procesa un array de leads y agrega el campo leadType automáticamente |

### Exportación de Datos

| Método | Endpoint                            | Descripción     |
| ------ | ----------------------------------- | --------------- |
| GET    | `/api/search/export/:searchId/json` | Exportar a JSON |
| GET    | `/api/search/export/:searchId/csv`  | Exportar a CSV  |

### Estadísticas

| Método | Endpoint              | Descripción            |
| ------ | --------------------- | ---------------------- |
| GET    | `/api/stats/overview` | Estadísticas generales |

## 🎯 Ejemplos de Uso

### 1. Procesar y clasificar leads por grado de conexión

```bash
curl -X POST http://localhost:3001/api/leads/process \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "leads": [
      { "first_name": "Juan", "connectionDegree": "1st" },
      { "first_name": "Ana", "connectionDegree": "2nd" },
      { "first_name": "Pedro", "connectionDegree": "3rd" }
    ]
  }'
```

### 2. Búsqueda Real en Phantombuster

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secure-api-key" \
  -d '{
    "searchParams": {
      "job_title": "Software Engineer"
    },
    "options": {
      "numberOfResultsPerSearch": 10,
      "includeEmails": true
    }
  }'
```

**Respuesta:**

```json
{
  "success": true,
  "message": "Búsqueda iniciada en Phantombuster",
  "data": {
    "searchId": "search_1234567890_abc123",
    "containerId": "container_1234567890_xyz789",
    "status": "running",
    "progress": 10,
    "message": "La búsqueda está ejecutándose en Phantombuster. Usa /api/search/status/:searchId para monitorear el progreso."
  }
}
```

### 3. Búsqueda con Ubicación Específica (Francia)

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "searchParams": {
      "job_title": "Supply Chain Director",
      "industry_codes": ["20","27","50","53","96"],
      "location": "Paris, Lyon, Marseille, Toulouse, Nice, Lille, France"
    },
    "options": {
      "numberOfResultsPerSearch": 50,
      "numberOfPagesPerSearch": 5,
      "removeDuplicateProfiles": true,
      "includeEmails": true
    }
  }'
```

### 4. Búsqueda con Industrias Específicas

```bash
curl -X POST http://localhost:3001/api/search/start \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-api-key-12345" \
  -d '{
    "searchParams": {
      "job_title": "Marketing Manager",
      "industry_codes": ["4", "6"]
    },
    "options": {
      "numberOfResultsPerSearch": 15,
      "removeDuplicateProfiles": true,
      "includeEmails": true
    }
  }'
```

### 5. Monitorear Estado de Búsqueda

```bash
curl -X GET "http://localhost:3001/api/search/status/SEARCH_ID" \
  -H "X-API-Key: your-secure-api-key"
```

**Respuesta:**

```json
{
  "success": true,
  "data": {
    "searchId": "search_1234567890_abc123",
    "containerId": "container_1234567890_xyz789",
    "status": "running",
    "progress": 45,
    "totalResults": 0
  }
}
```

### 6. Obtener Resultados Reales

```bash
curl -X GET "http://localhost:3001/api/search/results/SEARCH_ID" \
  -H "X-API-Key: your-secure-api-key"
```

**Respuesta con connectionDegree:**

```json
{
  "success": true,
  "data": {
    "searchId": "search_1234567890_abc123",
    "status": "completed",
    "leads": [
      {
        "linkedin_url": "https://linkedin.com/in/john-doe",
        "first_name": "John",
        "last_name": "Doe",
        "headline": "Software Engineer at Tech Corp",
        "company_name": "Tech Corp",
        "location": "San Francisco, CA",
        "industry": "Technology",
        "email": "john.doe@techcorp.com",
        "phone": "+1 (555) 123-4567",
        "connectionDegree": "2nd",
        "mutual_connections": 5,
        "connection_level": 2,
        "extracted_at": "2024-01-05T17:12:00.000Z"
      }
    ],
    "total": 1,
    "connectionDegree_available": true
  }
}
```

### 6. Exportar Datos

```bash
# Exportar a JSON
curl -X GET "http://localhost:3001/api/search/export/SEARCH_ID/json" \
  -H "X-API-Key: dev-api-key-12345" > results.json

# Exportar a CSV
curl -X GET "http://localhost:3001/api/search/export/SEARCH_ID/csv" \
  -H "X-API-Key: dev-api-key-12345" > results.csv
```

## 🗺️ Mapeo de Industrias

El servidor mapea automáticamente los códigos de industria a nombres legibles:

| Código | Industria      |
| ------ | -------------- |
| 4      | Technology     |
| 6      | Finance        |
| 20     | Manufacturing  |
| 27     | Transportation |
| 50     | Supply Chain   |
| 53     | Logistics      |
| 96     | Retail         |

## 🌍 Soporte de Países

### Francia 🇫🇷

- **Nombres**: Jean, Marie, Pierre, Sophie, François, etc.
- **Empresas**: LVMH, TotalEnergies, BNP Paribas, Carrefour, Orange, Sanofi, etc.
- **Teléfonos**: Formato `+33 X XX XX XX`
- **Detectado por**: `location` contiene "France"

### España 🇪🇸

- **Nombres**: Juan, María, Carlos, Ana, Luis, Carmen, etc.
- **Empresas**: Inditex, Santander, Telefónica, BBVA, Iberdrola, etc.
- **Teléfonos**: Formato `+34 XXX XXX XXX`
- **Detectado por**: `location` contiene "Spain"

### Internacional 🌐

- **Nombres**: John, Mary, James, Patricia, Robert, etc.
- **Empresas**: TechCorp, InnovateLab, Digital Solutions, etc.
- **Teléfonos**: Formato `+1 XXX XXX XXXX`
- **Detectado por**: Ubicación no específica

## 🔧 Configuración Avanzada

### Rate Limiting

```javascript
// Configurado en el servidor
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // máximo 100 requests por ventana
});
```

### Seguridad

- **Helmet**: Headers de seguridad HTTP
- **CORS**: Configuración de cross-origin
- **Compression**: Compresión de respuestas
- **API Key**: Autenticación requerida

### Logging

- **Morgan**: Logging de requests HTTP
- **Console**: Logs de aplicación
- **Error Handling**: Manejo centralizado de errores

## 📈 Monitoreo y Estadísticas

### Estadísticas Disponibles

- Total de búsquedas realizadas
- Búsquedas completadas vs. fallidas
- Total de leads extraídos
- Última extracción realizada

### Health Check

```bash
# Verificar estado del servidor
curl http://localhost:3001/health

# Respuesta esperada
{
  "status": "ok",
  "timestamp": "2025-07-07T01:44:28.452Z",
  "version": "1.0.0",
  "environment": "development",
  "database": "memory"
}
```

## 🐛 Solución de Problemas

### Problemas Comunes

1. **API Key inválida**

   ```bash
   # Verificar API Key en el archivo env
   cat env | grep API_KEY
   ```

2. **Puerto ocupado**

   ```bash
   # Cambiar puerto en env
   PORT=3002
   ```

3. **Docker no inicia**

   ```bash
   # Verificar logs
   docker compose logs phantombuster-api

   # Reconstruir
   docker compose down
   docker compose up --build -d
   ```

4. **Búsqueda no genera resultados**
   - Verificar parámetros de búsqueda
   - Comprobar que la ubicación sea válida
   - Revisar códigos de industria

### Logs de Debug

```bash
# Ver logs en tiempo real
docker compose logs -f phantombuster-api

# Ver logs específicos
docker compose logs phantombuster-api | grep "ERROR"
```

## 🔄 Desarrollo Local

### Instalación de Dependencias

```bash
npm install
```

### Ejecutar en Desarrollo

```bash
npm start
# o
node server-enhanced.js
```

### Variables de Entorno de Desarrollo

```bash
NODE_ENV=development
PORT=3001
API_KEY=dev-api-key-12345
SKIP_DATABASE=true
```

## 📝 Notas de Implementación

### Almacenamiento en Memoria

- Los datos se almacenan en memoria (Map)
- No hay persistencia entre reinicios
- Ideal para desarrollo y pruebas

### Búsqueda Automática

- Se completa inmediatamente al iniciar
- Genera datos simulados realistas
- No requiere monitoreo de estado

### Datos Simulados

- Basados en parámetros de búsqueda
- Localizados según país/ubicación
- Incluyen todos los campos requeridos

## 🤝 Contribución

1. Fork el proyecto
2. Crear una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 🆘 Soporte

Para soporte técnico o preguntas:

- Crear un issue en el repositorio
- Revisar la documentación de la API
- Verificar los logs del servidor

---

**¡Disfruta usando la API de Phantombuster Local! 🚀**

# api-phamthonbuster
