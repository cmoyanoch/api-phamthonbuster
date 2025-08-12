#!/bin/bash

# Script para inicializar la base de datos con tablas de monitoreo automático

echo "🔧 =========================================="
echo "🔧 INICIALIZACIÓN DE BASE DE DATOS DE MONITOREO"
echo "🔧 =========================================="

# Configuración
DB_HOST="localhost"
DB_PORT="5432"
DB_NAME="n8n_db"
DB_USER="n8n_user"
DB_PASSWORD="${POSTGRES_PASSWORD:-n8n_password}"

# Función para ejecutar SQL
execute_sql() {
    local sql_file="$1"
    echo "📊 Ejecutando: $sql_file"

    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$sql_file"

    if [ $? -eq 0 ]; then
        echo "✅ $sql_file ejecutado exitosamente"
    else
        echo "❌ Error ejecutando $sql_file"
        exit 1
    fi
}

# Verificar conexión a la base de datos
echo "🔍 Verificando conexión a la base de datos..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" worflo -c "SELECT 1;" > /dev/null 2>&1

if [ $? -ne 0 ]; then
    echo "❌ No se puede conectar a la base de datos"
    echo "   Host: $DB_HOST"
    echo "   Puerto: $DB_PORT"
    echo "   Base de datos: $DB_NAME"
    echo "   Usuario: $DB_USER"
    exit 1
fi

echo "✅ Conexión a la base de datos establecida"

# Crear tabla de logs de completación
echo ""
echo "📊 Creando tabla de logs de completación..."
execute_sql "scripts/create-container-logs-table.sql"

# Verificar que la tabla se creó correctamente
echo ""
echo "🔍 Verificando tabla creada..."
PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "\dt phantombuster.container_completion_logs;"

echo ""
echo "🎯 =========================================="
echo "🎯 INICIALIZACIÓN COMPLETADA"
echo "🎯 =========================================="
echo "✅ Tabla container_completion_logs creada"
echo "✅ Índices creados"
echo "✅ Base de datos lista para monitoreo automático"
echo ""
echo "📋 Próximos pasos:"
echo "   1. Compilar el proyecto: ./compile-api-phantombuster.sh"
echo "   2. Iniciar el servidor: npm start"
echo "   3. Probar monitoreo: curl -X POST http://localhost:3001/api/monitoring/start"
