import { Hono } from "hono";
import { authRouter } from "./auth";
import { commentRouter } from "./comments";
import { searchRouter } from "./search";
import { analyticsRouter } from "./analytics";
import { kanbanRouter } from "./kanban";
import { notesRouter } from "./notes";
import { eventsRouter } from "./events";
import { auth } from "./middleware/auth";
import { createCorsMiddleware } from "./middleware/cors";
import { rateLimit } from "./middleware/rate-limit";

/**
 * Base API router — mount sub-routers here as they are built.
 *
 * Auth middleware is applied to all routes except those under `/auth/`.
 */
export const api = new Hono().basePath("/api");

// Global CORS configuration (dev allows localhost:5173, prod is no-op)
api.use("*", createCorsMiddleware());

// Rate limiting for auth endpoints (10 POST/min per IP)
authRouter.use("*", rateLimit());

// Public auth routes (login, refresh, logout — no bearer token needed)
api.route("/auth", authRouter);

// Protected routes below this point require a valid bearer token
api.use("*", auth);

api.route("/kanban", kanbanRouter);
api.route("/search", searchRouter);
api.route("/analytics", analyticsRouter);
api.route("/notes", notesRouter);
api.route("/events", eventsRouter);

// Comment routes (note-scoped + direct comment operations)
api.route("/", commentRouter);
