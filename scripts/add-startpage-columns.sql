-- Agregar columnas startPage y numberOfPage a la tabla sequential_url_states
-- Estas columnas almacenarán los valores pre-calculados desde N8N

-- Agregar columna startPage
ALTER TABLE phantombuster.sequential_url_states
ADD COLUMN startPage INTEGER;

-- Agregar columna numberOfPage
ALTER TABLE phantombuster.sequential_url_states
ADD COLUMN numberOfPage INTEGER;

-- Agregar comentarios para documentar las columnas
COMMENT ON COLUMN phantombuster.sequential_url_states.startPage IS 'Página de inicio calculada para el rango específico (desde N8N)';
COMMENT ON COLUMN phantombuster.sequential_url_states.numberOfPage IS 'Número de páginas a procesar para el rango específico (desde N8N)';

-- Verificar que las columnas se agregaron correctamente
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'phantombuster'
  AND table_name = 'sequential_url_states'
  AND column_name IN ('startPage', 'numberOfPage');

-- Mostrar la estructura actualizada de la tabla
\d phantombuster.sequential_url_states;
