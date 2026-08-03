import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '../config/index';

// pg parses `sslmode` out of the connection string and lets it override an
// explicit `ssl` option, so it must be stripped for `rejectUnauthorized: false` to apply.
const connectionUrl = new URL(config.databaseUrl);
connectionUrl.searchParams.delete('sslmode');

const pool = new pg.Pool({
  connectionString: connectionUrl.toString(),
  ssl: { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

// BigInt JSON serialization fix
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
