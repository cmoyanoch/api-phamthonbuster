-- Crear tabla para logs de completación de containers
CREATE TABLE IF NOT EXISTS phantombuster.container_completion_logs (
  id SERIAL PRIMARY KEY,
  container_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  url_id INTEGER NOT NULL,
  results_count INTEGER DEFAULT 0,
  completed_at TIMESTAMP NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'auto_detected',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_container_completion_logs_container_id
ON phantombuster.container_completion_logs(container_id);

CREATE INDEX IF NOT EXISTS idx_container_completion_logs_session_id
ON phantombuster.container_completion_logs(session_id);

CREATE INDEX IF NOT EXISTS idx_container_completion_logs_completed_at
ON phantombuster.container_completion_logs(completed_at);

-- Comentarios
COMMENT ON TABLE phantombuster.container_completion_logs IS 'Logs de completación automática de containers de Phantombuster';
COMMENT ON COLUMN phantombuster.container_completion_logs.container_id IS 'ID del container de Phantombuster';
COMMENT ON COLUMN phantombuster.container_completion_logs.session_id IS 'ID de la sesión de distribución secuencial';
COMMENT ON COLUMN phantombuster.container_completion_logs.url_id IS 'ID de la URL procesada';
COMMENT ON COLUMN phantombuster.container_completion_logs.results_count IS 'Número de resultados obtenidos';
COMMENT ON COLUMN phantombuster.container_completion_logs.completed_at IS 'Fecha y hora de completación';
COMMENT ON COLUMN phantombuster.container_completion_logs.status IS 'Estado de la detección (auto_detected, manual, etc.)';
