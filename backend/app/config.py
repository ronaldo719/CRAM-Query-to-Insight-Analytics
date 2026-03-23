"""
Centralized Configuration & Client Factory

This module is the single source of truth for all configuration values.
Every other module imports `settings` and `get_openai_client()` from here
rather than reading environment variables directly. This gives us one place
to swap between local .env files and Azure Key Vault for production.

The OpenAI client factory (`get_openai_client`) returns either an AzureOpenAI
or direct OpenAI client depending on the USE_AZURE_OPENAI flag. The rest of
the codebase doesn't know or care which one it's using — the chat.completions
API is identical for both.
"""

import os
from dataclasses import dataclass, field
from functools import lru_cache
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Settings:
    """
    All configuration values for the application.

    In local development, these come from the .env file.
    In production (Azure App Service), they come from App Settings
    which can reference Key Vault secrets via the @Microsoft.KeyVault() syntax.
    """

    # ── Azure SQL Database ────────────────────────────────────
    # The admin connection is used by setup scripts only.
    # The readonly connection is used by the NL-to-SQL agent for query execution.
    sql_connection_string: str = os.getenv("AZURE_SQL_CONNECTION_STRING", "")
    sql_readonly_connection_string: str = os.getenv("AZURE_SQL_READONLY_CONNECTION_STRING", "")

    # ── Azure OpenAI ─────────────────────────────────
    use_azure_openai: bool = os.getenv("USE_AZURE_OPENAI", "true").lower() == "true"
    azure_openai_endpoint: str = os.getenv("AZURE_OPENAI_ENDPOINT", "")
    azure_openai_key: str = os.getenv("AZURE_OPENAI_KEY", "")
    azure_openai_deployment: str = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
    azure_openai_api_version: str = os.getenv("AZURE_OPENAI_API_VERSION", "2024-12-01-preview")

    # ── Direct OpenAI Fallback (Path B) ───────────────────────
    # openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    # openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    # ── Azure Content Safety ──────────────────────────────────
    content_safety_endpoint: str = os.getenv("CONTENT_SAFETY_ENDPOINT", "")
    content_safety_key: str = os.getenv("CONTENT_SAFETY_KEY", "")

    # ── Application Insights ──────────────────────────────────
    appinsights_connection_string: str = os.getenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "")

    # ── Key Vault (production secret source) ──────────────────
    key_vault_name: str = os.getenv("KEY_VAULT_NAME", "")

    # ── Frontend URL (for CORS in production) ─────────────────
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

    @property
    def model_name(self) -> str:
        """Return the model/deployment name for chat completions.
        Azure OpenAI uses deployment names; direct OpenAI uses model names.
        In practice both are 'gpt-4o-mini' for this project."""
        if self.use_azure_openai:
            return self.azure_openai_deployment
        return self.openai_model


# Singleton — created once, imported everywhere
settings = Settings()


@lru_cache(maxsize=1)
def get_openai_client():
    """
    Factory that returns the appropriate OpenAI client.

    Uses @lru_cache so the client is created once and reused for all
    subsequent calls. This avoids creating a new HTTP connection on
    every request.

    The returned client exposes the same chat.completions.create() API
    regardless of which path (Azure or direct) is active, so the rest
    of the codebase is provider-agnostic.
    """
    if settings.use_azure_openai:
        from openai import AzureOpenAI

        return AzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_key,
            api_version=settings.azure_openai_api_version,
        )
    else:
        from openai import OpenAI

        return OpenAI(api_key=settings.openai_api_key)
