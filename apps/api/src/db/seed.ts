import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { users } from './schema/index.js';

/**
 * Creates the first super admin so someone can log in and create the other users.
 * Usage: SEED_ADMIN_EMAIL=you@gmail.com SEED_ADMIN_NAME="Areej" pnpm --filter @mecca/api db:seed
 */
const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.SEED_ADMIN_NAME?.trim() || 'مدير النظام';
const url = process.env.DATABASE_URL;
if (!email || !url) throw new Error('Set DATABASE_URL and SEED_ADMIN_EMAIL');

const { db, close } = createDb(url);
const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
if (existing) {
  console.log(`✓ ${email} already exists (role: ${existing.role})`);
} else {
  await db.insert(users).values({ email, name, role: 'super_admin' });
  console.log(`✓ Super admin created: ${email}`);
}
await close();
