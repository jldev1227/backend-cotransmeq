SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'formularios_asistencia' 
ORDER BY ordinal_position;
