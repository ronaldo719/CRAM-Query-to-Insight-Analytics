"""
Content Safety Service — Azure AI Content Safety integration.

Screens user input and LLM output for harmful content across four
categories: hate, violence, sexual, self-harm. Each category gets
a severity score from 0 (safe) to 6 (severe).

This sits at two points in the pipeline:
  1. BEFORE the LLM sees the input (prevent prompt injection / harmful queries)
  2. AFTER the LLM generates output (catch harmful content in explanations)

If Content Safety is not configured (no endpoint/key), the service
degrades gracefully — it logs a warning and allows the request through.
This prevents the system from breaking during local development if
Content Safety isn't set up yet.
"""

from dataclasses import dataclass
from typing import Optional
from app.config import settings


@dataclass
class SafetyResult:
    is_safe: bool
    blocked_categories: list[str]
    scores: dict[str, int]  # {"hate": 0, "violence": 0, ...}
    message: str = ""


class ContentSafetyService:

    def __init__(self):
        self.endpoint = settings.content_safety_endpoint
        self.key = settings.content_safety_key
        # 0=safe, 2=low, 4=medium, 6=high. Configured via CONTENT_SAFETY_THRESHOLD in .env.
        self.severity_threshold = settings.content_safety_threshold
        self._client = None

    def _get_client(self):
        """Lazy-initialize the Content Safety client."""
        if self._client is None and self.endpoint and self.key:
            try:
                from azure.ai.contentsafety import ContentSafetyClient
                from azure.core.credentials import AzureKeyCredential
                self._client = ContentSafetyClient(
                    endpoint=self.endpoint,
                    credential=AzureKeyCredential(self.key),
                )
            except ImportError:
                print("⚠ azure-ai-contentsafety not installed — Content Safety disabled")
            except Exception as e:
                print(f"⚠ Content Safety init failed: {e}")
        return self._client

    def screen_text(self, text: str) -> SafetyResult:
        """
        Screen a text string for harmful content.
        Returns a SafetyResult with safety status and per-category scores.
        """
        client = self._get_client()

        if not client:
            # Graceful degradation — allow through with a warning
            return SafetyResult(
                is_safe=True,
                blocked_categories=[],
                scores={"hate": 0, "violence": 0, "sexual": 0, "self_harm": 0},
                message="Content Safety not configured — screening skipped",
            )

        try:
            from azure.ai.contentsafety.models import AnalyzeTextOptions

            response = client.analyze_text(
                AnalyzeTextOptions(text=text[:10000])  # API limit: 10K chars
            )

            scores = {}
            blocked = []

            for result in response.categories_analysis:
                category = result.category.lower().replace("_", "_")
                severity = result.severity
                scores[category] = severity

                if severity >= self.severity_threshold:
                    blocked.append(f"{category} (severity: {severity})")

            is_safe = len(blocked) == 0

            return SafetyResult(
                is_safe=is_safe,
                blocked_categories=blocked,
                scores=scores,
                message="" if is_safe else f"Blocked: {', '.join(blocked)}",
            )

        except Exception as e:
            # API error — allow through but log the failure
            return SafetyResult(
                is_safe=True,
                blocked_categories=[],
                scores={"hate": 0, "violence": 0, "sexual": 0, "self_harm": 0},
                message=f"Content Safety API error: {str(e)[:100]}",
            )

    def screen_input(self, question: str) -> SafetyResult:
        """Screen user's natural language question."""
        return self.screen_text(question)

    def screen_output(self, answer: str) -> SafetyResult:
        """Screen the LLM's generated answer."""
        return self.screen_text(answer)
