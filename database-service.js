#!/usr/bin/env node

/**
 * Servicio de Base de Datos para Persistencia
 *
 * Este servicio maneja la persistencia de datos usando PostgreSQL y Redis
 * Reemplaza el almacenamiento en memoria con almacenamiento persistente
 */
const { Pool } = require("pg");
const Redis = require("redis");

class DatabaseService {
  constructor() {
    this.pgPool = null;
    this.redisClient = null;
    this.isInitialized = false;
  }

  /**
   * Función helper para parsear JSON de forma segura
   */
  safeParse(value, defaultValue = null) {
    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value === "object") {
      return value;
    }

    if (typeof value === "string") {
      if (value.trim() === "") {
        return defaultValue;
      }

      try {
        return JSON.parse(value);
      } catch (error) {
        console.error("Error parseando JSON:", error.message);
        return defaultValue;
      }
    }

    return defaultValue;
  }

  /**
   * Inicializar conexiones a bases de datos
   */
  async initialize() {
    try {
      // Inicializar PostgreSQL
      await this.initializePostgreSQL();

      // Inicializar Redis
      await this.initializeRedis();

      // Crear tablas si no existen
      await this.createTables();

      this.isInitialized = true;
      console.log("✅ Servicio de base de datos inicializado correctamente");
    } catch (error) {
      console.error("❌ Error inicializando servicio de base de datos:", error);
      throw error;
    }
  }

  /**
   * Inicializar conexión PostgreSQL
   */
  async initializePostgreSQL() {
    try {
      this.pgPool = new Pool({
        host: process.env.DB_HOST || "server_europbot-n8n_postgres-1",
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || "n8n_db",
        user: process.env.DB_USER || "n8n_user",
        password: process.env.DB_PASSWORD || "3Lchunch0",
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      // Verificar conexión
      const client = await this.pgPool.connect();
      await client.query("SELECT NOW()");
      client.release();

      console.log("✅ Conexión PostgreSQL establecida");
    } catch (error) {
      console.error("❌ Error conectando a PostgreSQL:", error);
      throw error;
    }
  }

  /**
   * Inicializar conexión Redis
   */
  async initializeRedis() {
    try {
      this.redisClient = Redis.createClient({
        url: `redis://${process.env.REDIS_HOST || "redis"}:${
          process.env.REDIS_PORT || 6379
        }`,
        retry_strategy: (options) => {
          if (options.error && options.error.code === "ECONNREFUSED") {
            return new Error("Redis server refused connection");
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error("Retry time exhausted");
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        },
      });

      this.redisClient.on("error", (err) => {
        console.error("❌ Error de Redis:", err);
      });

      this.redisClient.on("connect", () => {
        console.log("✅ Conexión Redis establecida");
      });

      await this.redisClient.connect();
    } catch (error) {
      console.error("❌ Error conectando a Redis:", error);
      throw error;
    }
  }

  /**
   * Crear tablas necesarias
   */
  async createTables() {
    try {
      const client = await this.pgPool.connect();

      // Crear esquema phantombuster si no existe
      await client.query(`
        CREATE SCHEMA IF NOT EXISTS phantombuster
      `);

      // Tabla de búsquedas
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.searches (
          id SERIAL PRIMARY KEY,
          search_id VARCHAR(255) UNIQUE NOT NULL,
          container_id VARCHAR(255),
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          search_params JSONB,
          search_urls TEXT[],
          options JSONB,
          results JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          error_message TEXT
        )
      `);

      // Tabla de visitas de perfiles
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.profile_visits (
          id SERIAL PRIMARY KEY,
          visit_id VARCHAR(255) UNIQUE NOT NULL,
          container_id VARCHAR(255),
          profile_url TEXT NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'pending',
          progress INTEGER DEFAULT 0,
          options JSONB,
          result JSONB,
          lead_type VARCHAR(50) DEFAULT 'cold',
          user_id VARCHAR(255) DEFAULT 'default',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP,
          error_message TEXT
        )
      `);

      // Tabla de límites diarios
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.daily_limits (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL,
          date DATE NOT NULL,
          visit_count INTEGER DEFAULT 0,
          search_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(user_id, date)
        )
      `);

      // Tabla de seguimientos programados
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.follow_ups (
          id SERIAL PRIMARY KEY,
          profile_url TEXT NOT NULL,
          scheduled_date DATE NOT NULL,
          status VARCHAR(50) DEFAULT 'pending',
          options JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // ============================================================================
      // TABLAS PARA DISTRIBUCIÓN SECUENCIAL
      // ============================================================================

      // Tabla para persistir el estado de la secuencia
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.sequential_distribution_state (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) UNIQUE NOT NULL,
          campaign_id VARCHAR(255) NOT NULL,
          total_leads_limit INTEGER DEFAULT 2000,
          current_offset INTEGER DEFAULT 0,
          total_distributed INTEGER DEFAULT 0,
          remaining_leads INTEGER DEFAULT 2000,
          current_sequence INTEGER DEFAULT 0,
          total_sequences INTEGER DEFAULT 0,
          distribution_config JSONB NOT NULL,
          execution_history JSONB DEFAULT '[]',
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP NULL
        )
      `);

      // Tabla para persistir el estado de cada URL en la secuencia
      await client.query(`
        CREATE TABLE IF NOT EXISTS phantombuster.sequential_url_states (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          url_id VARCHAR(255) NOT NULL,
          url_template TEXT NOT NULL,
          priority INTEGER NOT NULL,
          sequence_order INTEGER NOT NULL,
          allocated_leads INTEGER NOT NULL,
          container_id VARCHAR(255) NULL,
          status VARCHAR(50) DEFAULT 'pending',
          results_count INTEGER DEFAULT 0,
          execution_time TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(session_id, url_id),
          FOREIGN KEY (session_id) REFERENCES phantombuster.sequential_distribution_state(session_id) ON DELETE CASCADE
        )
      `);

      // Índices para optimizar consultas
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_searches_search_id ON phantombuster.searches(search_id);
        CREATE INDEX IF NOT EXISTS idx_searches_status ON phantombuster.searches(status);
        CREATE INDEX IF NOT EXISTS idx_searches_created_at ON phantombuster.searches(created_at);
        CREATE INDEX IF NOT EXISTS idx_visits_visit_id ON phantombuster.profile_visits(visit_id);
        CREATE INDEX IF NOT EXISTS idx_visits_status ON phantombuster.profile_visits(status);
        CREATE INDEX IF NOT EXISTS idx_visits_user_id ON phantombuster.profile_visits(user_id);
        CREATE INDEX IF NOT EXISTS idx_limits_user_date ON phantombuster.daily_limits(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_follow_ups_scheduled_date ON phantombuster.follow_ups(scheduled_date);

        -- Índices para distribución secuencial
        CREATE INDEX IF NOT EXISTS idx_sequential_state_session ON phantombuster.sequential_distribution_state(session_id);
        CREATE INDEX IF NOT EXISTS idx_sequential_state_campaign ON phantombuster.sequential_distribution_state(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_sequential_state_status ON phantombuster.sequential_distribution_state(status);
        CREATE INDEX IF NOT EXISTS idx_sequential_urls_session ON phantombuster.sequential_url_states(session_id);
        CREATE INDEX IF NOT EXISTS idx_sequential_urls_status ON phantombuster.sequential_url_states(status);
        CREATE INDEX IF NOT EXISTS idx_sequential_urls_order ON phantombuster.sequential_url_states(sequence_order);
      `);

      client.release();
      console.log(
        "✅ Esquema phantombuster y tablas creadas/verificadas correctamente"
      );
    } catch (error) {
      console.error("❌ Error creando esquema y tablas:", error);
      throw error;
    }
  }

  // ============================================================================
  // MÉTODOS PARA BÚSQUEDAS
  // ============================================================================

  /**
   * Guardar búsqueda
   */
  async saveSearch(searchData) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.searches
        (search_id, container_id, status, progress, search_params, search_urls, options, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (search_id)
        DO UPDATE SET
          container_id = EXCLUDED.container_id,
          status = EXCLUDED.status,
          progress = EXCLUDED.progress,
          search_params = EXCLUDED.search_params,
          search_urls = EXCLUDED.search_urls,
          options = EXCLUDED.options,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const values = [
        searchData.searchId,
        searchData.containerId,
        searchData.status,
        searchData.progress,
        JSON.stringify(searchData.searchParams),
        searchData.searchUrls,
        JSON.stringify(searchData.options),
        searchData.createdAt,
      ];

      const result = await client.query(query, values);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error guardando búsqueda:", error);
      throw error;
    }
  }

  /**
   * Obtener búsqueda por ID
   */
  async getSearch(searchId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.searches
        WHERE search_id = $1
      `;

      const result = await client.query(query, [searchId]);
      client.release();

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        searchId: row.search_id,
        containerId: row.container_id,
        status: row.status,
        progress: row.progress,
        searchParams: row.search_params,
        searchUrls: row.search_urls,
        options: row.options,
        results: row.results,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
      };
    } catch (error) {
      console.error("❌ Error obteniendo búsqueda:", error);
      throw error;
    }
  }

  /**
   * Actualizar estado de búsqueda
   */
  async updateSearchStatus(
    searchId,
    status,
    progress = null,
    results = null,
    errorMessage = null
  ) {
    try {
      const client = await this.pgPool.connect();

      let query = `
        UPDATE phantombuster.searches
        SET status = $2, updated_at = CURRENT_TIMESTAMP
      `;

      let values = [searchId, status];
      let paramIndex = 3;

      if (progress !== null) {
        query += `, progress = $${paramIndex}`;
        values.push(progress);
        paramIndex++;
      }

      if (results !== null) {
        query += `, results = $${paramIndex}`;
        values.push(JSON.stringify(results));
        paramIndex++;
      }

      if (errorMessage !== null) {
        query += `, error_message = $${paramIndex}`;
        values.push(errorMessage);
        paramIndex++;
      }

      if (status === "completed") {
        query += `, completed_at = CURRENT_TIMESTAMP`;
      }

      query += ` WHERE search_id = $1 RETURNING *`;

      const result = await client.query(query, values);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error actualizando estado de búsqueda:", error);
      throw error;
    }
  }

  // ============================================================================
  // MÉTODOS PARA VISITAS DE PERFILES
  // ============================================================================

  /**
   * Guardar visita de perfil
   */
  async saveProfileVisit(visitData) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.profile_visits
        (visit_id, container_id, profile_url, status, progress, options, lead_type, user_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (visit_id)
        DO UPDATE SET
          container_id = EXCLUDED.container_id,
          status = EXCLUDED.status,
          progress = EXCLUDED.progress,
          options = EXCLUDED.options,
          lead_type = EXCLUDED.lead_type,
          user_id = EXCLUDED.user_id,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const values = [
        visitData.visitId,
        visitData.containerId,
        visitData.profileUrl,
        visitData.status,
        visitData.progress,
        JSON.stringify(visitData.options),
        visitData.leadType || "cold",
        visitData.userId || "default",
        visitData.startedAt,
      ];

      const result = await client.query(query, values);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error guardando visita de perfil:", error);
      throw error;
    }
  }

  /**
   * Obtener visita por ID
   */
  async getProfileVisit(visitId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.profile_visits
        WHERE visit_id = $1
      `;

      const result = await client.query(query, [visitId]);
      client.release();

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        visitId: row.visit_id,
        containerId: row.container_id,
        profileUrl: row.profile_url,
        status: row.status,
        progress: row.progress,
        options: row.options,
        result: row.result,
        leadType: row.lead_type,
        userId: row.user_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
      };
    } catch (error) {
      console.error("❌ Error obteniendo visita de perfil:", error);
      throw error;
    }
  }

  /**
   * Actualizar estado de visita
   */
  async updateProfileVisitStatus(
    visitId,
    status,
    progress = null,
    result = null,
    errorMessage = null
  ) {
    try {
      const client = await this.pgPool.connect();

      let query = `
        UPDATE phantombuster.profile_visits
        SET status = $2, updated_at = CURRENT_TIMESTAMP
      `;

      let values = [visitId, status];
      let paramIndex = 3;

      if (progress !== null) {
        query += `, progress = $${paramIndex}`;
        values.push(progress);
        paramIndex++;
      }

      if (result !== null) {
        query += `, result = $${paramIndex}`;
        values.push(JSON.stringify(result));
        paramIndex++;
      }

      if (errorMessage !== null) {
        query += `, error_message = $${paramIndex}`;
        values.push(errorMessage);
        paramIndex++;
      }

      if (status === "completed") {
        query += `, completed_at = CURRENT_TIMESTAMP`;
      }

      query += ` WHERE visit_id = $1 RETURNING *`;

      const result2 = await client.query(query, values);
      client.release();

      return result2.rows[0];
    } catch (error) {
      console.error("❌ Error actualizando estado de visita:", error);
      throw error;
    }
  }

  // ============================================================================
  // MÉTODOS PARA LÍMITES DIARIOS
  // ============================================================================

  /**
   * Obtener límites diarios
   */
  async getDailyLimits(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.daily_limits
        WHERE user_id = $1 AND date = $2
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      if (result.rows.length === 0) {
        return {
          userId,
          date,
          visitCount: 0,
          searchCount: 0,
        };
      }

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error obteniendo límites diarios:", error);
      throw error;
    }
  }

  /**
   * Incrementar contador de visitas
   */
  async incrementVisitCount(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.daily_limits (user_id, date, visit_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          visit_count = phantombuster.daily_limits.visit_count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error incrementando contador de visitas:", error);
      throw error;
    }
  }

  /**
   * Incrementar contador de búsquedas
   */
  async incrementSearchCount(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.daily_limits (user_id, date, search_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          search_count = phantombuster.daily_limits.search_count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error incrementando contador de búsquedas:", error);
      throw error;
    }
  }

  /**
   * Incrementar contador de conexiones (Autoconnect)
   */
  async incrementConnectionCount(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.daily_limits (user_id, date, connection_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          connection_count = phantombuster.daily_limits.connection_count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error incrementando contador de conexiones:", error);
      throw error;
    }
  }

  /**
   * Incrementar contador de mensajes (Message Sender)
   */
  async incrementMessageCount(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.daily_limits (user_id, date, message_count)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id, date)
        DO UPDATE SET
          message_count = phantombuster.daily_limits.message_count + 1,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error incrementando contador de mensajes:", error);
      throw error;
    }
  }

  /**
   * Obtener límites completos diarios
   */
  async getCompleteDailyLimits(userId, date) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM get_complete_daily_limits($1, $2)
      `;

      const result = await client.query(query, [userId, date]);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error obteniendo límites completos diarios:", error);
      throw error;
    }
  }

  // ============================================================================
  // MÉTODOS PARA SEGUIMIENTOS PROGRAMADOS
  // ============================================================================

  /**
   * Guardar seguimiento programado
   */
  async saveFollowUp(followUpData) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.follow_ups
        (profile_url, scheduled_date, status, options)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `;

      const values = [
        followUpData.profileUrl,
        followUpData.scheduledDate,
        followUpData.status || "pending",
        JSON.stringify(followUpData.options || {}),
      ];

      const result = await client.query(query, values);
      client.release();

      return result.rows[0];
    } catch (error) {
      console.error("❌ Error guardando seguimiento:", error);
      throw error;
    }
  }

  /**
   * Obtener seguimientos del día
   */
  async getTodayFollowUps() {
    try {
      const client = await this.pgPool.connect();

      const today = new Date().toISOString().split("T")[0];
      const query = `
        SELECT * FROM phantombuster.follow_ups
        WHERE scheduled_date = $1 AND status = 'pending'
        ORDER BY created_at ASC
      `;

      const result = await client.query(query, [today]);
      client.release();

      return result.rows;
    } catch (error) {
      console.error("❌ Error obteniendo seguimientos del día:", error);
      throw error;
    }
  }

  // ============================================================================
  // MÉTODOS DE CACHÉ CON REDIS
  // ============================================================================

  /**
   * Guardar en caché
   */
  async setCache(key, value, ttl = 3600) {
    try {
      if (!this.redisClient) return;

      const serializedValue = JSON.stringify(value);
      await this.redisClient.setEx(key, ttl, serializedValue);
    } catch (error) {
      console.error("❌ Error guardando en caché:", error);
    }
  }

  /**
   * Obtener de caché
   */
  async getCache(key) {
    try {
      if (!this.redisClient) return null;

      const value = await this.redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error("❌ Error obteniendo de caché:", error);
      return null;
    }
  }

  /**
   * Eliminar de caché
   */
  async deleteCache(key) {
    try {
      if (!this.redisClient) return;

      await this.redisClient.del(key);
    } catch (error) {
      console.error("❌ Error eliminando de caché:", error);
    }
  }

  // ============================================================================
  // MÉTODOS DE LIMPIEZA Y MANTENIMIENTO
  // ============================================================================

  /**
   * Limpiar datos antiguos
   */
  async cleanupOldData(daysOld = 30) {
    try {
      const client = await this.pgPool.connect();

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      // Limpiar búsquedas antiguas
      await client.query(
        `
        DELETE FROM phantombuster.searches
        WHERE created_at < $1 AND status IN ('completed', 'failed')
      `,
        [cutoffDate]
      );

      // Limpiar visitas antiguas
      await client.query(
        `
        DELETE FROM phantombuster.profile_visits
        WHERE created_at < $1 AND status IN ('completed', 'failed')
      `,
        [cutoffDate]
      );

      // Limpiar límites diarios antiguos
      await client.query(
        `
        DELETE FROM phantombuster.daily_limits
        WHERE date < $1
      `,
        [cutoffDate.toISOString().split("T")[0]]
      );

      // Limpiar seguimientos antiguos
      await client.query(
        `
        DELETE FROM phantombuster.follow_ups
        WHERE scheduled_date < $1 AND status IN ('completed', 'cancelled')
      `,
        [cutoffDate.toISOString().split("T")[0]]
      );

      client.release();
      console.log(
        `✅ Limpieza completada. Datos más antiguos que ${daysOld} días eliminados.`
      );
    } catch (error) {
      console.error("❌ Error en limpieza de datos:", error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas
   */
  async getStats() {
    try {
      const client = await this.pgPool.connect();

      const stats = {};

      // Estadísticas de búsquedas
      const searchStats = await client.query(`
        SELECT
          COUNT(*) as total_searches,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_searches,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running_searches,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_searches
        FROM phantombuster.searches
      `);
      stats.searches = searchStats.rows[0];

      // Estadísticas de visitas
      const visitStats = await client.query(`
        SELECT
          COUNT(*) as total_visits,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_visits,
          COUNT(CASE WHEN status = 'running' THEN 1 END) as running_visits,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_visits
        FROM phantombuster.profile_visits
      `);
      stats.visits = visitStats.rows[0];

      // Estadísticas de límites diarios
      const limitStats = await client.query(`
        SELECT
          SUM(visit_count) as total_visits_today,
          SUM(search_count) as total_searches_today
        FROM phantombuster.daily_limits
        WHERE date = CURRENT_DATE
      `);
      stats.dailyLimits = limitStats.rows[0];

      client.release();
      return stats;
    } catch (error) {
      console.error("❌ Error obteniendo estadísticas:", error);
      throw error;
    }
  }

  /**
   * Cerrar conexiones
   */
  async close() {
    try {
      if (this.pgPool) {
        await this.pgPool.end();
        console.log("✅ Conexión PostgreSQL cerrada");
      }

      if (this.redisClient) {
        await this.redisClient.quit();
        console.log("✅ Conexión Redis cerrada");
      }
    } catch (error) {
      console.error("❌ Error cerrando conexiones:", error);
    }
  }

  // ============================================================================
  // MÉTODOS PARA DISTRIBUCIÓN SECUENCIAL
  // ============================================================================

  /**
   * Guardar estado de secuencia secuencial
   */
  async saveSequentialSession(sessionState) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.sequential_distribution_state (
          session_id, campaign_id, total_leads_limit, current_offset,
          total_distributed, remaining_leads, current_sequence, total_sequences,
          distribution_config, execution_history, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (session_id) DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP,
          status = EXCLUDED.status,
          current_offset = EXCLUDED.current_offset,
          total_distributed = EXCLUDED.total_distributed,
          remaining_leads = EXCLUDED.remaining_leads,
          current_sequence = EXCLUDED.current_sequence,
          distribution_config = EXCLUDED.distribution_config,
          execution_history = EXCLUDED.execution_history
      `;

      await client.query(query, [
        sessionState.session_id,
        sessionState.campaign_id,
        sessionState.total_leads_limit,
        sessionState.current_offset,
        sessionState.total_distributed,
        sessionState.remaining_leads,
        sessionState.current_sequence,
        sessionState.total_sequences,
        JSON.stringify(sessionState.distribution_config),
        JSON.stringify(sessionState.execution_history),
        sessionState.status,
      ]);

      client.release();
      console.log(
        `✅ Estado de secuencia guardado: ${sessionState.session_id}`
      );
    } catch (error) {
      console.error("❌ Error guardando estado de secuencia:", error);
      throw error;
    }
  }

  /**
   * Obtener sesión secuencial por campaign ID
   */
  async getSequentialSession(campaignId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.sequential_distribution_state
        WHERE campaign_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const result = await client.query(query, [campaignId]);
      client.release();

      if (result.rows.length > 0) {
        const session = result.rows[0];
        return {
          ...session,
          distribution_config: this.safeParse(session.distribution_config, {}),
          execution_history: this.safeParse(session.execution_history, []),
        };
      }

      return null;
    } catch (error) {
      console.error("❌ Error obteniendo sesión secuencial:", error);
      throw error;
    }
  }

  /**
   * Obtener sesión secuencial por session ID
   */
  async getSequentialSessionBySessionId(sessionId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.sequential_distribution_state
        WHERE session_id = $1
      `;

      const result = await client.query(query, [sessionId]);
      client.release();

      if (result.rows.length > 0) {
        const session = result.rows[0];
        return {
          ...session,
          distribution_config: this.safeParse(session.distribution_config, {}),
          execution_history: this.safeParse(session.execution_history, []),
        };
      }

      return null;
    } catch (error) {
      console.error("❌ Error obteniendo sesión por ID:", error);
      throw error;
    }
  }

  /**
   * Actualizar estado de sesión secuencial
   */
  async updateSequentialSessionStatus(sessionId, status) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_distribution_state
        SET status = $2, updated_at = CURRENT_TIMESTAMP
        ${status === "completed" ? ", completed_at = CURRENT_TIMESTAMP" : ""}
        WHERE session_id = $1
      `;

      await client.query(query, [sessionId, status]);
      client.release();

      // Estado de sesión actualizado
    } catch (error) {
      console.error("❌ Error actualizando estado de sesión:", error);
      throw error;
    }
  }

  /**
   * Actualizar progreso de sesión secuencial
   */
  async updateSequentialSessionProgress(
    sessionId,
    currentOffset,
    totalDistributed,
    remainingLeads,
    currentSequence
  ) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_distribution_state
        SET
          current_offset = $2,
          total_distributed = $3,
          remaining_leads = $4,
          current_sequence = $5,
          updated_at = CURRENT_TIMESTAMP
        WHERE session_id = $1
      `;

      await client.query(query, [
        sessionId,
        currentOffset,
        totalDistributed,
        remainingLeads,
        currentSequence,
      ]);
      client.release();

      // Progreso de sesión actualizado
    } catch (error) {
      console.error("❌ Error actualizando progreso de sesión:", error);
      throw error;
    }
  }

  /**
   * Guardar estado de URL secuencial
   */
  async saveSequentialUrlState(urlState) {
    try {
      const client = await this.pgPool.connect();

      // Validar y limpiar valores para evitar NaN
      console.log(`🔍 DEBUG - Guardando urlState con valores originales:`, {
        startPage: urlState.startPage,
        numberOfPage: urlState.numberOfPage,
        startPageType: typeof urlState.startPage,
        numberOfPageType: typeof urlState.numberOfPage
      });

      const cleanUrlState = {
        session_id: urlState.session_id,
        url_id: parseInt(urlState.url_id) || 0,
        url_template: urlState.url_template,
        priority: parseInt(urlState.priority) || 3,
        sequence_order: parseInt(urlState.sequence_order) || 1,
        allocated_leads: parseInt(urlState.allocated_leads) || 125,
        status: urlState.status || "pending",
        container_id: urlState.container_id || null,
        results_count: parseInt(urlState.results_count) || 0,
        startPage: parseInt(urlState.startPage) || 1,
        numberOfPage: parseInt(urlState.numberOfPage) || 5,
      };

      console.log(`🔍 DEBUG - Valores limpiados para DB:`, {
        startPage: cleanUrlState.startPage,
        numberOfPage: cleanUrlState.numberOfPage
      });

      // Valores limpios para la base de datos

      const query = `
        INSERT INTO phantombuster.sequential_url_states (
          session_id, url_id, url_template, priority, sequence_order,
          allocated_leads, status, container_id, results_count,
          startpage, numberofpage
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (session_id, url_id) DO UPDATE SET
          updated_at = CURRENT_TIMESTAMP,
          status = EXCLUDED.status,
          container_id = EXCLUDED.container_id,
          results_count = EXCLUDED.results_count,
          startpage = EXCLUDED.startpage,
          numberofpage = EXCLUDED.numberofpage
      `;

      await client.query(query, [
        cleanUrlState.session_id,
        cleanUrlState.url_id,
        cleanUrlState.url_template,
        cleanUrlState.priority,
        cleanUrlState.sequence_order,
        cleanUrlState.allocated_leads,
        cleanUrlState.status,
        cleanUrlState.container_id,
        cleanUrlState.results_count,
        cleanUrlState.startPage,
        cleanUrlState.numberOfPage,
      ]);

      client.release();
      console.log(
        `✅ Estado de URL guardado: ${urlState.url_id} con startPage: ${urlState.startPage}, numberOfPage: ${urlState.numberOfPage}`
      );
    } catch (error) {
      console.error("❌ Error guardando estado de URL:", error);
      throw error;
    }
  }

  /**
   * Obtener estados de URLs de una sesión
   */
  async getSequentialUrlStates(sessionId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.sequential_url_states
        WHERE session_id = $1
        ORDER BY sequence_order ASC
      `;

      const result = await client.query(query, [sessionId]);
      client.release();

      // Debug logs para ver qué valores se están retornando desde la DB
      result.rows.forEach(row => {
        console.log(`🔍 DEBUG - URL State desde DB:`, {
          url_id: row.url_id,
          startPage: row.startpage,
          numberOfPage: row.numberofpage,
          startPageType: typeof row.startpage,
          numberOfPageType: typeof row.numberofpage
        });
      });

      return result.rows;
    } catch (error) {
      console.error("❌ Error obteniendo estados de URLs:", error);
      throw error;
    }
  }

  /**
   * Obtener estado de URL específica
   */
  async getSequentialUrlState(sessionId, urlId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT * FROM phantombuster.sequential_url_states
        WHERE session_id = $1 AND url_id = $2
      `;

      const result = await client.query(query, [sessionId, urlId]);
      client.release();

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error("❌ Error obteniendo estado de URL:", error);
      throw error;
    }
  }

  /**
   * Actualizar estado de URL secuencial
   */
  async updateSequentialUrlStateStatus(sessionId, urlId, status) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_url_states
        SET status = $3, updated_at = CURRENT_TIMESTAMP
        ${status === "completed" ? ", execution_time = CURRENT_TIMESTAMP" : ""}
        WHERE session_id = $1 AND url_id = $2
      `;

      await client.query(query, [sessionId, urlId, status]);
      client.release();

      console.log(`✅ Estado de URL actualizado: ${urlId} -> ${status}`);
    } catch (error) {
      console.error("❌ Error actualizando estado de URL:", error);
      throw error;
    }
  }

  /**
   * Actualizar estado de URL secuencial por container ID
   */
  async updateSequentialUrlStateStatusByContainer(containerId, status) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_url_states
        SET status = $2, updated_at = CURRENT_TIMESTAMP
        ${status === "completed" ? ", execution_time = CURRENT_TIMESTAMP" : ""}
        WHERE container_id = $1
      `;

      const result = await client.query(query, [containerId, status]);
      client.release();

      if (result.rowCount > 0) {
        console.log(
          `✅ Estado de container actualizado: ${containerId} -> ${status}`
        );
        return true;
      } else {
        console.log(`⚠️ No se encontró container con ID: ${containerId}`);
        return false;
      }
    } catch (error) {
      console.error("❌ Error actualizando estado de container:", error);
      throw error;
    }
  }

  /**
   * Obtener todos los containers en estado "running"
   */
  async getRunningContainers() {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT container_id, session_id, url_id, status, created_at, updated_at
        FROM phantombuster.sequential_url_states
        WHERE status = 'running' AND container_id IS NOT NULL
        ORDER BY created_at ASC
      `;

      const result = await client.query(query);
      client.release();

      return result.rows;
    } catch (error) {
      console.error("❌ Error obteniendo containers en ejecución:", error);
      throw error;
    }
  }

  /**
   * Obtener containers completados hoy
   */
  async getCompletedContainersToday() {
    try {
      const client = await this.pgPool.connect();

      const query = `
        SELECT container_id, session_id, url_id, status, execution_time
        FROM phantombuster.sequential_url_states
        WHERE status = 'completed'
        AND DATE(execution_time) = CURRENT_DATE
        ORDER BY execution_time DESC
      `;

      const result = await client.query(query);
      client.release();

      return result.rows;
    } catch (error) {
      console.error("❌ Error obteniendo containers completados:", error);
      throw error;
    }
  }

  /**
   * Registrar completación de container
   */
  async logContainerCompletion(logData) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        INSERT INTO phantombuster.container_completion_logs
        (container_id, session_id, url_id, results_count, completed_at, status)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;

      await client.query(query, [
        logData.container_id,
        logData.session_id,
        logData.url_id,
        logData.results_count,
        logData.completed_at,
        logData.status,
      ]);

      client.release();
      console.log(
        `📝 Completación de container ${logData.container_id} registrada`
      );
    } catch (error) {
      console.error("❌ Error registrando completación de container:", error);
      throw error;
    }
  }

  /**
   * Actualizar container ID de URL secuencial
   */
  async updateSequentialUrlStateContainer(sessionId, urlId, containerId) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_url_states
        SET container_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE session_id = $1 AND url_id = $2
      `;

      await client.query(query, [sessionId, urlId, containerId]);
      client.release();

      console.log(
        `✅ Container ID de URL actualizado: ${urlId} -> ${containerId}`
      );
    } catch (error) {
      console.error("❌ Error actualizando container ID de URL:", error);
      throw error;
    }
  }

  /**
   * Actualizar resultados de URL secuencial
   */
  async updateSequentialUrlStateResults(
    sessionId,
    urlId,
    resultsCount,
    status
  ) {
    try {
      const client = await this.pgPool.connect();

      const query = `
        UPDATE phantombuster.sequential_url_states
        SET
          results_count = $3,
          status = $4,
          updated_at = CURRENT_TIMESTAMP,
          execution_time = CURRENT_TIMESTAMP
        WHERE session_id = $1 AND url_id = $2
      `;

      await client.query(query, [sessionId, urlId, resultsCount, status]);
      client.release();

      console.log(
        `✅ Resultados de URL actualizados: ${urlId} -> ${resultsCount} leads`
      );
    } catch (error) {
      console.error("❌ Error actualizando resultados de URL:", error);
      throw error;
    }
  }

  /**
   * Agregar entrada al historial de ejecución
   */
  async addSequentialExecutionHistory(sessionId, historyEntry) {
    try {
      const client = await this.pgPool.connect();

      const currentQuery = `
        SELECT execution_history FROM phantombuster.sequential_distribution_state
        WHERE session_id = $1
      `;

      const currentResult = await client.query(currentQuery, [sessionId]);

      if (currentResult.rows.length > 0) {
        let currentHistory = this.safeParse(
          currentResult.rows[0].execution_history,
          []
        );

        if (!Array.isArray(currentHistory)) {
          currentHistory = [];
        }

        currentHistory.push(historyEntry);

        const updateQuery = `
          UPDATE phantombuster.sequential_distribution_state
          SET execution_history = $2, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = $1
        `;

        await client.query(updateQuery, [
          sessionId,
          JSON.stringify(currentHistory),
        ]);
        console.log(`✅ Historial de ejecución actualizado: ${sessionId}`);
      }

      client.release();
    } catch (error) {
      console.error("❌ Error agregando entrada al historial:", error);
      throw error;
    }
  }
}

module.exports = DatabaseService;
