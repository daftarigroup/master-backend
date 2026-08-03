FROM node:22-alpine

WORKDIR /app

# Copy package metadata & prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client & compile TypeScript
RUN npx prisma generate
RUN npm run build

# Prune devDependencies to keep production image size minimal
RUN npm prune --production

# Expose server port
EXPOSE 5000

# Start production server
CMD ["node", "dist/server.js"]
