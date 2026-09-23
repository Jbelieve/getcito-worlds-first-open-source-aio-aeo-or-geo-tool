import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: ['./src/db/schema.ts', './src/db/schema-auth.ts', '../aos-aps/src/db/schema.ts'],
  out: './src/db/migrations',
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
