# Migrating from Express/Prisma to Cloudflare Workers

### Original Tech Stack
- **Runtime:** Node.js  
- **API Framework:** Express  
- **Database ORM:** Prisma  
- **Database:** SQLite  
- **API Protocol:** tRPC  

### New Tech Stack
- **Runtime:** Cloudflare Workers  
- **State Management:** Durable Objects  
- **Database:** D1 (SQLite)  
- **API Protocol:** tRPC-compatible endpoints  

### Files Changed/Added

| Status  | File                      | Purpose                                      |
|---------|---------------------------|----------------------------------------------|
| **Added**   | `src/index.ts`             | Main worker file with durable object implementation |
| **Added**   | `wrangler.jsonc`           | Cloudflare workers configuration              |
| **Added**   | `worker-configuration.d.ts` | TypeScript type definitions for Worker         |
| **Removed** | `src/app.ts`               | Express server setup                           |
| **Removed** | `src/note.controller.ts`    | tRPC controller logic                          |
| **Removed** | `src/note.schema.ts`        | Zod schema definitions                         |

## Lines of Code Comparison

| Component         | Original (Express/Prisma) | New (Cloudflare Workers) | Change  |
|------------------|-------------------------|-------------------------|---------|
| **Server Setup**  | 45 lines (`app.ts`)     | 20 lines (default export) | **-25 lines**  |
| **Controllers**   | 130 lines (`note.controller.ts`) | 295 lines (durableobject methods) | **+165 lines** |
| **Schema Definitions** | 35 lines (`note.schema.ts`) | 25 lines (schema definitions) | **-10 lines**  |
| **Database Setup** | 15 lines (`schema.prisma`) | 12 lines (`initializeDB`) | **-3 lines**  |
| **Types/Interfaces** | 10 lines | 38 lines | **+28 lines**  |
| **Configuration** | 25 lines (multiple files) | 18 lines (`wrangler.jsonc`) | **-7 lines**  |
| **Total**        | 260 lines                | 408 lines                | **+148 lines** |