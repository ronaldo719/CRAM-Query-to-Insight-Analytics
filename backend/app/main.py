"""
Query-to-Insight Analytics Engine — FastAPI Backend

This is the application entry point. It configures CORS (so the React frontend
can call the API from a different port), registers all route handlers, and
provides a health check endpoint that Azure App Service uses to verify the
application is running.

Run locally with:
    uvicorn app.main:app --reload --port 8000

Then visit:
    http://localhost:8000/docs   — interactive Swagger UI
    http://localhost:8000/health — health check
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import auth, query, audit

app = FastAPI(
    title="Query-to-Insight Analytics Engine",
    description="An agentic analytics engineer that converts natural language to validated SQL",
    version="1.0.0",
)

# ---------------------------------------------------------------------------
# CORS Middleware
# ---------------------------------------------------------------------------
# The React frontend runs on localhost:5173 (Vite dev server) while this
# backend runs on localhost:8000. Without CORS, the browser blocks every
# API call from the frontend because they're on different origins.
# In production, FRONTEND_URL points to your Azure Static Web App URL.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",                       # Vite dev server
        "http://localhost:3000",                       # Alternative React port
        settings.frontend_url,                         # Production Static Web App
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Register routers
# ---------------------------------------------------------------------------
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(query.router, prefix="/api/query", tags=["query"])
app.include_router(audit.router, prefix="/api/audit", tags=["audit"])


# ---------------------------------------------------------------------------
# Health check — Azure App Service pings this to verify the app is alive.
# Also useful for quick "is my backend running?" checks during development.
# ---------------------------------------------------------------------------
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "query-to-insight-backend",
        "version": "1.0.0",
    }


@app.get("/")
async def root():
    return {
        "message": "Query-to-Insight Analytics Engine API",
        "docs": "/docs",
        "health": "/health",
    }
