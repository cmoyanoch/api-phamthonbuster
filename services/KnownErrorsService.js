const { Pool } = require('pg');

class KnownErrorsService {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'n8n_postgres',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'n8n_db',
      user: process.env.DB_USER || 'n8n_user',
      password: process.env.DB_PASSWORD,
    });
  }

  /**
   * Guardar un nuevo error conocido en la base de datos
   */
  async saveKnownError(errorData) {
    const {
      containerId,
      errorType,
      errorMessage,
      errorDetails,
      exitCode,
      endType,
      durationMs
    } = errorData;

    try {
      const query = `
        INSERT INTO phantombuster.known_errors
        (container_id, error_type, error_message, error_details, exit_code, end_type, duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (container_id) DO UPDATE SET
          error_type = EXCLUDED.error_type,
          error_message = EXCLUDED.error_message,
          error_details = EXCLUDED.error_details,
          exit_code = EXCLUDED.exit_code,
          end_type = EXCLUDED.end_type,
          duration_ms = EXCLUDED.duration_ms,
          created_at = CURRENT_TIMESTAMP
        RETURNING id, container_id, error_type, created_at
      `;

      const values = [
        containerId,
        errorType,
        errorMessage,
        JSON.stringify(errorDetails),
        exitCode,
        endType,
        durationMs
      ];

      const result = await this.pool.query(query, values);

      console.log(`✅ Error conocido guardado: ${containerId} - ${errorType}`);
      return result.rows[0];
    } catch (error) {
      console.error(`❌ Error guardando error conocido: ${error.message}`);
      throw error;
    }
  }

  /**
   * Buscar errores conocidos por tipo
   */
  async findKnownErrorsByType(errorType) {
    try {
      const query = `
        SELECT * FROM phantombuster.known_errors
        WHERE error_type = $1 AND is_resolved = false
        ORDER BY created_at DESC
      `;

      const result = await this.pool.query(query, [errorType]);
      return result.rows;
    } catch (error) {
      console.error(`❌ Error buscando errores conocidos: ${error.message}`);
      throw error;
    }
  }

  /**
   * Buscar error conocido por container ID
   */
  async findKnownErrorByContainerId(containerId) {
    try {
      const query = `
        SELECT * FROM phantombuster.known_errors
        WHERE container_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await this.pool.query(query, [containerId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`❌ Error buscando error conocido por container: ${error.message}`);
      throw error;
    }
  }

  /**
   * Marcar un error como resuelto
   */
  async markErrorAsResolved(containerId, resolutionNotes = null) {
    try {
      const query = `
        UPDATE phantombuster.known_errors
        SET is_resolved = true,
            resolved_at = CURRENT_TIMESTAMP,
            resolution_notes = $2
        WHERE container_id = $1
        RETURNING id, container_id, error_type, resolved_at
      `;

      const result = await this.pool.query(query, [containerId, resolutionNotes]);

      if (result.rows.length > 0) {
        console.log(`✅ Error marcado como resuelto: ${containerId}`);
        return result.rows[0];
      }

      return null;
    } catch (error) {
      console.error(`❌ Error marcando error como resuelto: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtener estadísticas de errores
   */
  async getErrorStatistics() {
    try {
      const query = `
        SELECT
          error_type,
          COUNT(*) as total_errors,
          COUNT(CASE WHEN is_resolved = true THEN 1 END) as resolved_errors,
          COUNT(CASE WHEN is_resolved = false THEN 1 END) as unresolved_errors,
          MIN(created_at) as first_occurrence,
          MAX(created_at) as last_occurrence
        FROM phantombuster.known_errors
        GROUP BY error_type
        ORDER BY total_errors DESC
      `;

      const result = await this.pool.query(query);
      return result.rows;
    } catch (error) {
      console.error(`❌ Error obteniendo estadísticas: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cerrar la conexión a la base de datos
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = KnownErrorsService;
