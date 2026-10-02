-- ============================================================================
-- Rol de aplicación para que el aislamiento por fila (RLS) **exista**.
--
-- El problema que este archivo resuelve, medido: la app conectaba como `postgres`,
-- superusuario y **dueño de todas las tablas**. Con RLS habilitado y políticas puestas, el
-- dueño sigue salteando RLS (`relforcerowsecurity = false`), así que las políticas de
-- `0029_beaos_rls_policies.sql` no cambian **ninguna** consulta. Un rol sin `BYPASSRLS` y que
-- no sea dueño es la mitad que falta.
--
-- ATENCIÓN — esto **no activa nada**. El rol se crea con `NOLOGIN`: existe, tiene los permisos,
-- y **nadie se puede conectar con él**. Activar el aislamiento es un cambio de `DATABASE_URL`
-- deliberado y aparte, con su rollback, documentado en `RLS-ROL-Y-ACTIVACION.md`. La razón
-- de que sea un paso manual es la regla dura de esta tarea: con el cableado de la app
-- incompleto, un `SELECT` sin la variable de sesión **no falla, devuelve cero filas**, y el
-- producto se vería vacío sin un solo error en el log.
--
-- Idempotente a propósito: se puede volver a aplicar sobre una base que ya lo tiene, y no pisa
-- un rol que ya exista (por ejemplo uno al que un operador ya le puso contraseña).
-- ============================================================================

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beaos_app') THEN
		CREATE ROLE beaos_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
	END IF;
END
$$;
--> statement-breakpoint

-- Los cuatro permisos que la app realmente usa. `SELECT/INSERT/UPDATE/DELETE` y nada de
-- `TRUNCATE`, `REFERENCES` ni `TRIGGER`: el rol no administra el esquema, lo consume.
GRANT USAGE ON SCHEMA public TO beaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beaos_app;
--> statement-breakpoint
-- Sin `USAGE` sobre la secuencia, un `nextval` falla. Hoy todos los ids son `uuid`/`text`, así que
-- esto cubre a quien agregue una columna serial más adelante.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO beaos_app;
--> statement-breakpoint

-- Las tablas que creen las migraciones **siguientes** también tienen que quedar alcanzadas. Sin
-- esto, cada migración nueva sería una tabla invisible para el rol de la app.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beaos_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO beaos_app;
--> statement-breakpoint

-- pg-boss vive en su propio esquema y **no** es dato de una marca: es la cola de trabajos. El
-- esquema lo crea quien se conecta, así que si un despliegue ya lo tiene, hay que alcanzarlo; si
-- todavía no existe, no hay nada que otorgar y pg-boss tendrá que crearlo (lo que además necesita
-- `CREATE ON DATABASE`, ver la documentación). Se hace condicional para que la migración no
-- dependa del orden en que se haya arrancado la app.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss') THEN
		EXECUTE 'GRANT USAGE ON SCHEMA pgboss TO beaos_app';
		EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO beaos_app';
		EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO beaos_app';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO beaos_app';
		EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss GRANT USAGE, SELECT ON SEQUENCES TO beaos_app';
	END IF;
END
$$;
