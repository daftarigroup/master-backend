# ================================
# Build Stage
# ================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and prisma directory
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client & Build TypeScript code
RUN npx prisma generate
RUN npm run build

# ================================
# Production Stage
# ================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy generated Prisma Client & build artifacts from builder stage
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist

# Expose server port
EXPOSE 5000

# Start server
CMD ["node", "dist/server.js"]
