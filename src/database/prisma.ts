import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { config } from '../config/index';

// pg parses `sslmode` out of the connection string and lets it override an
// explicit `ssl` option, so it must be stripped for `rejectUnauthorized: false` to apply.
const connectionUrl = new URL(config.databaseUrl);
connectionUrl.searchParams.delete('sslmode');

const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(connectionUrl.hostname);

const pool = new pg.Pool({
  connectionString: connectionUrl.toString(),
  ssl: isLocalHost ? false : { rejectUnauthorized: false },
});

const adapter = new PrismaPg(pool);

const basePrisma = new PrismaClient({ adapter });

// Query Timing Middleware Extension (logs any query exceeding 200ms as [SLOW QUERY])
export const prisma: PrismaClient = basePrisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        const result = await query(args);
        const duration = performance.now() - start;
        if (duration > 200) {
          console.warn(`⚠️ [SLOW QUERY] ${model}.${operation} took ${duration.toFixed(1)}ms`);
        }
        return result;
      },
    },
  },
}) as unknown as PrismaClient;

// BigInt JSON serialization fix
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};
