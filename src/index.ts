import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

const createNoteSchema = z.object({
  title: z.string({
    required_error: "Title is required",
  }),
  content: z.string({
    required_error: "Content is required",
  }),
  category: z.string().optional(),
  published: z.boolean().optional(),
});

const updateNoteSchema = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  category: z.string().optional(),
  published: z.boolean().optional(),
});

const filterQuerySchema = z.object({
  limit: z.number().default(10),
  page: z.number().default(1),
});

interface Note {
  id: string;
  title: string;
  content: string;
  category?: string;
  published?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreateNoteRequest {
  input: z.infer<typeof createNoteSchema>;
}

interface UpdateNoteRequest {
  input: {
    params: {
      noteId: string;
    };
    body: z.infer<typeof updateNoteSchema>;
  };
}

interface GetNoteRequest {
  input: {
    noteId: string;
  };
}

interface GetNotesRequest {
  input: z.infer<typeof filterQuerySchema>;
}

interface DeleteNoteRequest {
  input: {
    noteId: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export class NotesDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.initializeDB();
  }

  private initializeDB() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        category TEXT,
        published BOOLEAN DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
  }

  private async parseInput<T>(request: Request): Promise<T> {
    const method = request.method;
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      let rawData: any;
      
      if (method === "GET") {
        const inputParam = url.searchParams.get("input");
        if (!inputParam) {
          return { input: {} } as T;
        }
        rawData = JSON.parse(inputParam);
      } else if (method === "POST") {
        const contentType = request.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          rawData = await request.json();
        } else {
          throw new Error(`Unsupported content type: ${contentType}`);
        }
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }
      
      if (isBatch && rawData && typeof rawData === 'object' && rawData["0"] !== undefined) {
        return { input: rawData["0"] } as T;
      }
      
      if (rawData && rawData.input !== undefined) {
        return rawData as T;
      }
      
      return { input: rawData } as T;
    } catch (error) {
      return { input: {} } as T;
    }
  }

  private async titleExists(title: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(`
      SELECT COUNT(*) as count FROM notes WHERE title = ?
    `, title);
    
    const count = result.one().count as number;
    return count > 0;
  }

  private formatTRPCResponse(result: any, isBatch: boolean): Response {
    let finalResponse;
    
    if (isBatch) {
      finalResponse = [
        {
          result: {
            data: result
          }
        }
      ];
    } else {
      finalResponse = {
        result: {
          data: result
        }
      };
    }
    
    const headers = {
      "Content-Type": "application/json",
      ...corsHeaders
    };
    
    return new Response(JSON.stringify(finalResponse), { headers });
  }

  private formatTRPCErrorResponse(code: string, message: string, status: number, isBatch: boolean = false): Response {
    const errorObject = {
      message,
      code
    };
    
    let finalResponse;
    
    if (isBatch) {
      finalResponse = [
        {
          error: errorObject
        }
      ];
    } else {
      finalResponse = {
        error: errorObject
      };
    }
    
    const headers = {
      "Content-Type": "application/json",
      ...corsHeaders
    };
    
    return new Response(JSON.stringify(finalResponse), { status, headers });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...corsHeaders,
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const isBatch = url.searchParams.has("batch");

    try {
      if (path === "/api/trpc/createNote") {
        return await this.createNote(request);
      } else if (path === "/api/trpc/updateNote") {
        return await this.updateNote(request);
      } else if (path === "/api/trpc/deleteNote") {
        return await this.deleteNote(request);
      } else if (path === "/api/trpc/getNote") {
        return await this.getNote(request);
      } else if (path === "/api/trpc/getNotes") {
        return await this.getNotes(request);
      } else if (path === "/api/trpc/getHello") {
        return this.formatTRPCResponse({ message: "Welcome to Full-Stack tRPC CRUD App" }, isBatch);
      }

      return new Response("Not found", { 
        status: 404,
        headers: corsHeaders
      });
    } catch (error: any) {
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "Internal server error",
        500,
        isBatch
      );
    }
  }

  async createNote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      if (request.method !== "POST") {
        return this.formatTRPCErrorResponse(
          "METHOD_NOT_SUPPORTED",
          "Method not allowed",
          405,
          isBatch
        );
      }
      
      const data = await this.parseInput<CreateNoteRequest>(request);
      
      if (!data.input || typeof data.input !== 'object') {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Invalid request format",
          400,
          isBatch
        );
      }
      
      const input = createNoteSchema.parse(data.input);
      
      if (await this.titleExists(input.title)) {
        return this.formatTRPCErrorResponse(
          "CONFLICT",
          "Note with that title already exists",
          409,
          isBatch
        );
      }
      
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      
      try {
        this.ctx.storage.sql.exec(`
          INSERT INTO notes (id, title, content, category, published, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, id, input.title, input.content, input.category || null, 
           input.published ? 1 : 0, now, now);
      } catch (dbError: any) {
        if (dbError.message && dbError.message.includes("UNIQUE constraint failed")) {
          return this.formatTRPCErrorResponse(
            "CONFLICT",
            "Note with that title already exists",
            409,
            isBatch
          );
        }
        throw dbError;
      }
      
      const result = this.ctx.storage.sql.exec(`
        SELECT * FROM notes WHERE id = ?
      `, id);
      
      const note = this.mapSqliteRow(result.one());
      
      return this.formatTRPCResponse({
        status: "success",
        data: {
          note
        }
      }, isBatch);
      
    } catch (error: any) {
      if (error.name === "ZodError") {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Validation error",
          400,
          isBatch
        );
      }
      
      if (error.message && error.message.includes("UNIQUE constraint failed")) {
        return this.formatTRPCErrorResponse(
          "CONFLICT",
          "Note with that title already exists",
          409,
          isBatch
        );
      }
      
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "An unexpected error occurred",
        500,
        isBatch
      );
    }
  }

  async updateNote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      if (request.method !== "POST") {
        return this.formatTRPCErrorResponse(
          "METHOD_NOT_SUPPORTED",
          "Method not allowed",
          405,
          isBatch
        );
      }
      
      const data = await this.parseInput<UpdateNoteRequest>(request);
      
      if (!data.input || !data.input.params || !data.input.params.noteId) {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Invalid request format: missing noteId",
          400,
          isBatch
        );
      }
      
      const noteId = data.input.params.noteId;
      const updateData = data.input.body || {};
      
      updateNoteSchema.parse(updateData);
      
      const checkResult = this.ctx.storage.sql.exec(`
        SELECT * FROM notes WHERE id = ?
      `, noteId);
      
      if (checkResult.toArray().length === 0) {
        return this.formatTRPCErrorResponse(
          "NOT_FOUND",
          "Note with that ID not found",
          404,
          isBatch
        );
      }
      
      if (updateData.title !== undefined) {
        const currentNoteResult = this.ctx.storage.sql.exec(`
          SELECT title FROM notes WHERE id = ?
        `, noteId);
        
        const currentTitle = String(currentNoteResult.one().title);
        
        if (updateData.title !== currentTitle && await this.titleExists(updateData.title)) {
          return this.formatTRPCErrorResponse(
            "CONFLICT",
            "Note with that title already exists",
            409,
            isBatch
          );
        }
      }
      
      let updateFields = [];
      let params = [];
      
      if (updateData.title !== undefined) {
        updateFields.push("title = ?");
        params.push(updateData.title);
      }
      
      if (updateData.content !== undefined) {
        updateFields.push("content = ?");
        params.push(updateData.content);
      }
      
      if (updateData.category !== undefined) {
        updateFields.push("category = ?");
        params.push(updateData.category);
      }
      
      if (updateData.published !== undefined) {
        updateFields.push("published = ?");
        params.push(updateData.published ? 1 : 0);
      }
      
      updateFields.push("updatedAt = ?");
      params.push(new Date().toISOString());
      
      params.push(noteId);
      
      this.ctx.storage.sql.exec(`
        UPDATE notes SET ${updateFields.join(", ")} WHERE id = ?
      `, ...params);
      
      const result = this.ctx.storage.sql.exec(`
        SELECT * FROM notes WHERE id = ?
      `, noteId);
      
      const note = this.mapSqliteRow(result.one());
      
      return this.formatTRPCResponse({
        status: "success",
        note
      }, isBatch);
    } catch (error: any) {
      if (error.name === "ZodError") {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Validation error",
          400,
          isBatch
        );
      }
      
      if (error.message && error.message.includes("UNIQUE constraint failed")) {
        return this.formatTRPCErrorResponse(
          "CONFLICT",
          "Note with that title already exists",
          409,
          isBatch
        );
      }
      
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "An unexpected error occurred",
        500,
        isBatch
      );
    }
  }

  async getNote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      const data = await this.parseInput<GetNoteRequest>(request);
      
      if (!data.input || !data.input.noteId) {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Invalid request format: missing noteId",
          400,
          isBatch
        );
      }
      
      const noteId = data.input.noteId;
      
      const result = this.ctx.storage.sql.exec(`
        SELECT * FROM notes WHERE id = ?
      `, noteId);
      
      const notes = result.toArray();
      
      if (notes.length === 0) {
        return this.formatTRPCErrorResponse(
          "NOT_FOUND",
          "Note with that ID not found",
          404,
          isBatch
        );
      }
      
      const note = this.mapSqliteRow(notes[0]);
      
      return this.formatTRPCResponse({
        status: "success",
        note
      }, isBatch);
    } catch (error: any) {
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "An unexpected error occurred",
        500,
        isBatch
      );
    }
  }

  async getNotes(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      const data = await this.parseInput<GetNotesRequest>(request);
      
      const page = data.input?.page || 1;
      const limit = data.input?.limit || 10;
      const offset = (page - 1) * limit;
      
      const result = this.ctx.storage.sql.exec(`
        SELECT * FROM notes ORDER BY createdAt DESC LIMIT ? OFFSET ?
      `, limit, offset);
      
      const notes = result.toArray().map(row => this.mapSqliteRow(row));
      
      return this.formatTRPCResponse({
        status: "success",
        results: notes.length,
        notes
      }, isBatch);
      
    } catch (error: any) {
      if (error.name === "ZodError") {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Validation error",
          400,
          isBatch
        );
      }
      
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "An unexpected error occurred",
        500,
        isBatch
      );
    }
  }

  async deleteNote(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const isBatch = url.searchParams.has("batch");
    
    try {
      if (request.method !== "POST") {
        return this.formatTRPCErrorResponse(
          "METHOD_NOT_SUPPORTED",
          "Method not allowed",
          405,
          isBatch
        );
      }
      
      const data = await this.parseInput<DeleteNoteRequest>(request);
      
      if (!data.input || !data.input.noteId) {
        return this.formatTRPCErrorResponse(
          "BAD_REQUEST",
          "Invalid request format: missing noteId",
          400,
          isBatch
        );
      }
      
      const noteId = data.input.noteId;
      
      const checkResult = this.ctx.storage.sql.exec(`
        SELECT * FROM notes WHERE id = ?
      `, noteId);
      
      if (checkResult.toArray().length === 0) {
        return this.formatTRPCErrorResponse(
          "NOT_FOUND",
          "Note with that ID not found",
          404,
          isBatch
        );
      }
      
      this.ctx.storage.sql.exec(`
        DELETE FROM notes WHERE id = ?
      `, noteId);
      
      return this.formatTRPCResponse({
        status: "success"
      }, isBatch);
    } catch (error: any) {
      return this.formatTRPCErrorResponse(
        "INTERNAL_SERVER_ERROR",
        error.message || "An unexpected error occurred",
        500,
        isBatch
      );
    }
  }

  private mapSqliteRow(row: any): Note {
    return {
      id: String(row.id),
      title: String(row.title),
      content: String(row.content),
      category: row.category ? String(row.category) : undefined,
      published: row.published === 1,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt)
    };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          ...corsHeaders,
          "Access-Control-Max-Age": "86400"
        }
      });
    }
    
    const url = new URL(request.url);
    const path = url.pathname;
    
    if (path === "/" || !path.startsWith("/api")) {
      return env.ASSETS.fetch(request);
    }
    
    if (path.startsWith("/api/trpc")) {
      const id = env.NOTES_DO.idFromName("default");
      const stub = env.NOTES_DO.get(id);
      return await stub.fetch(request);
    }
    
    return new Response("Not found", { 
      status: 404,
      headers: corsHeaders 
    });
  }
} satisfies ExportedHandler<Env>;