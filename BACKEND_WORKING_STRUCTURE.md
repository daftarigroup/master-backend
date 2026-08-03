# Backend Working Structure & Architecture

## Overview
The `master-backend` is an **Express.js + Prisma ORM (PostgreSQL)** backend service serving REST API endpoints for the Store & Master Management application. 

It features:
- Dynamic Generic Controller mapping for entity CRUD operations (`/api/store/entity/:table`)
- Automatic type casting (BigInt, DateTime, String, Boolean) via Prisma DMMF introspection
- Eager relation loading (`TABLE_INCLUDES`) for nested relational fields (e.g., `item` → `group_head`, `uom`; `firm` → `company`)
- Express middleware for JWT authentication, CORS, compression, security headers (Helmet), and central error handling.

---

## Directory Structure

```
master-backend/
├── prisma/
│   ├── schema.prisma              # Prisma schema definition (Models, Enums, DB maps)
│   └── migrations/                # Migration history files
├── src/
│   ├── app/
│   │   └── app.ts                 # Express application configuration & global middleware
│   ├── config/
│   │   └── index.ts               # Environment variables and configuration options
│   ├── database/
│   │   └── prisma.ts              # Prisma Client instance & BigInt JSON serialization patch
│   ├── middleware/
│   │   ├── auth.middleware.ts     # JWT authentication & session token verification
│   │   └── error.middleware.ts    # Global error handler & ApiError mapping
│   ├── modules/
│   │   └── store/
│   │       ├── controllers/
│   │       │   └── generic.controller.ts # Generic CRUD controller handling dynamic table queries
│   │       ├── repositories/
│   │       ├── routes/
│   │       │   └── entity.routes.ts # Dynamic entity router (/api/store/entity/:table)
│   │       ├── services/
│   │       ├── types/
│   │       └── validators/
│   ├── routes/
│   │   └── index.ts               # Central API Router mounting modules (/api/store, etc.)
│   ├── utils/
│   │   ├── ApiError.ts            # Custom error class for API response status codes
│   │   └── asyncHandler.ts        # Async wrapper for route handlers
│   └── server.ts                  # Application entry point (starts HTTP server on port 5001)
├── package.json                   # Node dependencies & script definitions
└── tsconfig.json                  # TypeScript compiler settings
```

---

## Core Components & Data Flow

### 1. HTTP Server Setup (`src/server.ts` & `src/app/app.ts`)
- Configures CORS, Helmet, Cookie Parser, Express JSON parser, and Morgan logger.
- Mounts all routes under the `/api` prefix guarded by `authenticateJWT`.
- Mounts global error middleware (`errorHandler`).

### 2. Database Connection (`src/database/prisma.ts`)
- Uses `@prisma/adapter-pg` with `pg.Pool` for PostgreSQL connection pooling.
- Overrides `BigInt.prototype.toJSON` to return string representations so Large IDs don't crash JSON serialization.

### 3. Dynamic Generic Entity Controller (`src/modules/store/controllers/generic.controller.ts`)
Handles standard REST API calls for all entities (`/api/store/entity/:table`):
- **Model Key Resolution (`getModelKey`)**: Converts `snake_case` table names (e.g. `default_po_terms`) to Prisma `camelCase` model keys (e.g. `defaultPoTerms`).
- **Field Normalization (`normalizeBody`)**: Uses `Prisma.dmmf.datamodel.models` to dynamically inspect model schemas:
  - Casts string numeric values to `BigInt` for foreign key columns (`_id`).
  - Casts numbers/booleans to `String` for text fields (such as `quantity` or `min_stock_qty` defined as `String? @db.Text`).
  - Formats date strings (`YYYY-MM-DD`) into valid ISO-8601 DateTime strings.
- **Relational Inclusions (`TABLE_INCLUDES`)**: Automatically injects Prisma relation inclusions (e.g., `item` includes `group_head` & `uom`; `firm` includes `company`) to emulate relational joins expected by the frontend.

### 4. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| **GET** | `/api/store/entity/:table` | List all records (supports `limit`, `order`, filter flags) |
| **GET** | `/api/store/entity/:table/:id` | Fetch single record by primary key |
| **POST** | `/api/store/entity/:table` | Create new record(s) with type normalization |
| **PATCH** | `/api/store/entity/:table/:id` | Update single record by ID |
| **PATCH** | `/api/store/entity/:table` | Bulk update with filters |
| **DELETE** | `/api/store/entity/:table/:id` | Delete record by ID |
