# Enterprise Store App - Master Backend API

Enterprise-grade REST API backend built with Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Zod validation, and JWT Authentication.

---

## Tech Stack & Architecture

- **Runtime & Language**: Node.js (v20+) & TypeScript (v5+)
- **Web Framework**: Express.js
- **ORM & Database**: Prisma ORM (v7+) & PostgreSQL (AWS RDS / Docker)
- **Validation**: Zod (Schema-based request body, query, and parameter validation)
- **Security & Utilities**: Helmet, CORS, Compression, Cookie-Parser, Morgan logging, JWT Auth
- **Containerization & CI/CD**: Docker, Docker Compose, GitHub Actions

---

## Directory Structure

```
master-backend/
├── .github/workflows/
│   └── ci-cd.yml          # GitHub Actions CI/CD Pipeline
├── prisma/
│   └── schema.prisma      # Prisma Database Models & Schema
├── src/
│   ├── app/
│   │   └── app.ts         # Express Application setup & middleware
│   ├── config/
│   │   └── index.ts       # Strongly-typed environment configuration
│   ├── database/
│   │   └── prisma.ts      # Singleton Prisma Client instance
│   ├── middleware/
│   │   ├── auth.middleware.ts     # JWT Authentication & role guards
│   │   ├── error.middleware.ts    # Global error handler
│   │   └── validate.middleware.ts # Zod schema validator
│   ├── modules/
│   │   └── store/                 # Store & Indents Domain Module
│   │       ├── controllers/       # HTTP Request Handlers
│   │       ├── repositories/      # Database queries via Prisma
│   │       ├── routes/            # Express REST routes
│   │       ├── services/          # Milestone & stage business logic
│   │       ├── types/             # TypeScript DTOs & interfaces
│   │       └── validators/        # Zod validation schemas
│   ├── routes/
│   │   └── index.ts               # Main API Router (/api/health, /api/store)
│   ├── utils/
│   │   ├── ApiError.ts            # Custom operational error class
│   │   └── asyncHandler.ts        # Async controller error wrapper
│   └── server.ts                  # Server entry point
├── .dockerignore
├── .env
├── Dockerfile                      # Multi-stage production Docker image
├── docker-compose.yml              # Local container stack (PostgreSQL + Backend)
├── package.json
├── prisma.config.ts                # Prisma 7 configuration file
├── README.md
└── tsconfig.json
```

---

## Quick Start Guide

### Option 1: Local Development with Node.js & Local PostgreSQL

1. **Install Dependencies**:
   ```bash
   cd master-backend
   npm install
   ```

2. **Configure Environment Variables**:
   Create or edit `.env` in `master-backend/`:
   ```env
   PORT=5000
   NODE_ENV=development
   DATABASE_URL="postgresql://postgres:password@localhost:5432/master_db?schema=public"
   JWT_SECRET=super_secret_jwt_key_store_app_2026
   REFRESH_SECRET=super_secret_refresh_key_store_app_2026
   CORS_ORIGIN=http://localhost:5173
   ```

3. **Generate Prisma Client**:
   ```bash
   npm run prisma:generate
   ```

4. **Start Development Server (with hot reloading)**:
   ```bash
   npm run dev
   ```
   The API will be available at `http://localhost:5000/api`.

---

### Option 2: Running with Docker Compose (Recommended for Containerized Setup)

Docker Compose provisions both the PostgreSQL database and the `master-backend` server automatically in isolated containers.

1. **Start the Stack**:
   ```bash
   cd master-backend
   docker compose up --build -d
   ```

2. **Check Container Status**:
   ```bash
   docker compose ps
   ```

3. **View Logs**:
   ```bash
   docker compose logs -f backend
   ```

4. **Stop the Stack**:
   ```bash
   docker compose down -v
   ```

---

## Database Commands & Management

| Task | Command |
| :--- | :--- |
| **Generate Prisma Client** | `npm run prisma:generate` |
| **Pull Database Schema** | `npm run prisma:pull` |
| **Run Migrations** | `npm run prisma:migrate` |
| **Open Prisma Studio (Web UI)** | `npm run prisma:studio` |

---

## CI/CD Pipeline Workflow

The GitHub Actions pipeline (`.github/workflows/ci-cd.yml`) automates testing, type-checking, building, and publishing Docker images.

### Pipeline Stages

1. **Test & Build**:
   - Triggers on `push` or `pull_request` to `main`/`master` branch.
   - Installs dependencies, generates Prisma Client, runs TypeScript check (`npx tsc --noEmit`), and compiles the code (`npm run build`).

2. **Docker Build & Push**:
   - Builds multi-stage production Docker image using `Dockerfile`.
   - Pushes built image to GitHub Container Registry (`ghcr.io`).

3. **Deploy Stage**:
   - Triggers automated deployment to production infrastructure.

---

## REST API Endpoints (Store / Indent Module)

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Server health check status |
| `GET` | `/api/store/indents` | Fetch all indents (optional `permittedFirms` query filter) |
| `PATCH` | `/api/store/indents/:id/approval` | HOD Department Indent Approval (Stage 1: `actual1`, `planned2`) |
| `PATCH` | `/api/store/indents/:id/specifications` | Update Indent specifications |
| `PATCH` | `/api/store/indents/:id/history` | Update historical fields |
| `PATCH` | `/api/store/indents/number/:indentNumber/vendor-selection` | Vendor rate & bidding submission (Stage 2: `actual2`, `planned3`) |
| `PATCH` | `/api/store/indents/number/:indentNumber/hod-approval` | Technical evaluation & ranking (Stage 3: `actual3`, `planned4`) |
| `PATCH` | `/api/store/indents/number/:indentNumber/po-creation` | Management rate approval & PO linkage (Stage 4: `actual4`, `planned5`) |
| `PATCH` | `/api/store/indents/number/:indentNumber/payment-terms` | Payment terms update (Stage 5) |
| `PATCH` | `/api/store/indents/number/:indentNumber/store-out-approval` | Store Out approval |

---

## Build & Production Deployment

To manually build the project for production:

```bash
# Generate Prisma Client & Compile TypeScript
npm run prisma:generate
npm run build

# Start Production Server
npm start
```
