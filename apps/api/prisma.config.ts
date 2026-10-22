import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Migrations run as the table owner; the API itself connects as intime_app (see docs/adr/0001).
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
});
