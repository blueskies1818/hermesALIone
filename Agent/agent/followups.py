"""Theta: suggest short follow-up questions after an assistant reply.

Uses the auxiliary LLM (the same cheap path as session titles), so it never
blocks or slows down the reply itself.
"""

import json
import logging
import re
from typing import List

from agent.auxiliary_client import call_llm

logger = logging.getLogger(__name__)

MAX_SUGGESTIONS = 3
MAX_SUGGESTION_CHARS = 90

_PROMPT = (
    "You suggest follow-ups for a chat. Given the user's last message and the assistant's "
    "reply, write up to 3 short follow-up messages the USER would plausibly send next "
    "(each under 12 words, phrased as the user, no numbering). If the reply is a simple "
    "acknowledgement or nothing useful follows, return an empty list. "
    'Return ONLY a JSON array of strings, e.g. ["Show me an example", "What about X?"].'
)


def parse_suggestions(text: str) -> List[str]:
    """Pull a clean list of suggestions out of a model response."""
    text = (text or "").strip()
    items: list = []
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, list):
                items = [p for p in parsed if isinstance(p, str)]
        except ValueError:
            items = []
    if not items and not match:
        items = [re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", line) for line in text.splitlines()]
    out: List[str] = []
    for item in items:
        item = " ".join(item.split()).strip("\"'")
        if item and len(item) <= MAX_SUGGESTION_CHARS and item not in out:
            out.append(item)
    return out[:MAX_SUGGESTIONS]


def generate_followups(user_message: str, assistant_response: str, timeout: float = 20.0) -> List[str]:
    """Return up to three follow-up suggestions, or [] on any failure."""
    if not (assistant_response or "").strip():
        return []
    messages = [
        {"role": "system", "content": _PROMPT},
        {
            "role": "user",
            "content": f"User: {(user_message or '')[:800]}\n\nAssistant: {assistant_response[-2000:]}",
        },
    ]
    try:
        response = call_llm(
            task="follow_up_suggestions",
            messages=messages,
            max_tokens=400,
            temperature=0.5,
            timeout=timeout,
        )
        return parse_suggestions(response.choices[0].message.content or "")
    except Exception as exc:
        logger.debug("Follow-up suggestions failed: %s", exc)
        return []
