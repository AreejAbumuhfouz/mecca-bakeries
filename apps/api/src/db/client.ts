import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzle(client, { schema });
  return {
    db,
    ping: async () => {
      await db.execute(sql`select 1`);
      return true;
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export type Db = ReturnType<typeof createDb>['db'];
