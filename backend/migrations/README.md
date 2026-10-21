# Database migration path

BookWise uses SQLAlchemy metadata for the initial schema so the same models
work with the default SQLite database and PostgreSQL (`DATABASE_URL`). Run:

```bash
python -m backend.migrate
```

The command is idempotent and creates missing tables before seeding the local
book catalog. For production schema evolution, add an Alembic revision under
this directory and run it before deploying the new application image. Existing
user data is never created automatically; users must register through the API.
