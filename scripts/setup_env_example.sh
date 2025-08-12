#!/bin/bash

# =====================================================
# SCRIPT: Configuración de Variables de Entorno
# Versión: 1.0.0
# Fecha: 2025-01-27
# Descripción: Ejemplo de configuración para los scripts de dump
# =====================================================

echo "🔧 Configurando variables de entorno para scripts de dump..."

# =====================================================
# CONFIGURACIÓN DE BASE DE DATOS
# =====================================================

# Host de la base de datos
export DB_HOST="localhost"

# Puerto de PostgreSQL
export DB_PORT="5432"

# Nombre de la base de datos
export DB_NAME="n8n"

# Usuario de la base de datos
export DB_USER="n8n_user"

# Contraseña de la base de datos (CAMBIAR ESTA CONTRASEÑA)
export DB_PASSWORD="n8n_password"

# =====================================================
# VERIFICACIÓN DE CONFIGURACIÓN
# =====================================================

echo "✅ Variables de entorno configuradas:"
echo "   DB_HOST: $DB_HOST"
echo "   DB_PORT: $DB_PORT"
echo "   DB_NAME: $DB_NAME"
echo "   DB_USER: $DB_USER"
echo "   DB_PASSWORD: [OCULTO]"

echo ""
echo "🚀 Ahora puedes ejecutar los scripts de dump:"
echo "   ./generate_webapp_leads_dump.sh    # Dump completo"
echo "   ./quick_webapp_leads_dump.sh       # Dump rápido"
echo ""

# =====================================================
# VERIFICACIÓN DE CONEXIÓN (OPCIONAL)
# =====================================================

read -p "¿Deseas verificar la conexión a la base de datos? (y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔍 Verificando conexión a la base de datos..."

    if PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" >/dev/null 2>&1; then
        echo "✅ Conexión exitosa a la base de datos"

        # Verificar si la tabla existe
        table_exists=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'webapp'
                AND table_name = 'leads'
            );
        " | xargs)

        if [ "$table_exists" = "t" ]; then
            echo "✅ La tabla webapp.leads existe"

            # Obtener estadísticas básicas
            row_count=$(PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "
                SELECT COUNT(*) FROM webapp.leads;
            " | xargs)

            echo "📊 Número de registros en webapp.leads: $row_count"
        else
            echo "❌ La tabla webapp.leads no existe"
        fi
    else
        echo "❌ No se puede conectar a la base de datos"
        echo "   Verifica las credenciales y la configuración"
    fi
fi

echo ""
echo "📝 Para hacer esta configuración permanente, agrega las variables al archivo ~/.bashrc:"
echo ""
echo "   # Configuración para scripts de dump"
echo "   export DB_HOST=\"localhost\""
echo "   export DB_PORT=\"5432\""
echo "   export DB_NAME=\"n8n\""
echo "   export DB_USER=\"n8n_user\""
echo "   export DB_PASSWORD=\"tu_password_real\""
echo ""
