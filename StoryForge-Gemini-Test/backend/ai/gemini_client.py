"""Gemini Client and Orchestration Infrastructure.

Integrates with Google AI Gemini models:
- gemini-3.8-flash (Reasoning, Architect, Continuity, Creative, Twists)
- gemini-3.5-transcribe (Audio transcription)
- gemini-embedding-2-preview (Semantic memory retrieval)

Strictly validates API keys and responses. Never mocks responses when API fails.
"""

import json
import re
import base64
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List
from backend.config import settings


class GeminiAPIError(Exception):
    """Raised when the Gemini API returns an error or cannot be contacted."""
    def __init__(self, message: str, status_code: int = 500, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class GeminiClient:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY

    def _ensure_api_key(self) -> str:
        key = self.api_key or settings.GEMINI_API_KEY
        if not key or key.strip() == "" or key == "MY_GEMINI_API_KEY":
            raise GeminiAPIError(
                message="GEMINI_API_KEY environment variable is not configured. Please supply a valid Google Gemini API key.",
                status_code=401,
                details={"hint": "Set GEMINI_API_KEY in your environment or .env file"}
            )
        return key

    def generate_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        model: Optional[str] = None,
        json_output: bool = False,
        temperature: float = 0.7,
        audio_bytes: Optional[bytes] = None,
        audio_mime_type: Optional[str] = "audio/wav"
    ) -> str:
        """
        Calls Gemini API using either Google GenAI SDK or direct REST API.
        Never mocks response when API key is missing.
        """
        key = self._ensure_api_key()
        target_model = model or settings.MODEL_FLASH

        # Try google-genai SDK if available
        try:
            from google import genai
            from google.genai import types

            client = genai.Client(
                api_key=key,
                http_options={'headers': {'User-Agent': 'aistudio-build'}}
            )

            contents: List[Any] = []
            if audio_bytes:
                contents.append(
                    types.Part.from_bytes(
                        data=audio_bytes,
                        mime_type=audio_mime_type or "audio/wav"
                    )
                )
            contents.append(prompt)

            config_args: Dict[str, Any] = {
                "temperature": temperature
            }
            if system_instruction:
                config_args["system_instruction"] = system_instruction
            if json_output:
                config_args["response_mime_type"] = "application/json"

            config = types.GenerateContentConfig(**config_args)
            try:
                response = client.models.generate_content(
                    model=target_model,
                    contents=contents,
                    config=config
                )
            except Exception as model_err:
                # If primary model has 503 high demand or 429 rate limit, fallback to gemini-3.1-flash-lite
                err_str = str(model_err)
                if ("503" in err_str or "429" in err_str or "UNAVAILABLE" in err_str) and target_model != "gemini-3.1-flash-lite":
                    response = client.models.generate_content(
                        model="gemini-3.1-flash-lite",
                        contents=contents,
                        config=config
                    )
                else:
                    raise model_err

            if not response or not response.text:
                raise GeminiAPIError("Empty response returned from Gemini API", status_code=502)
            return response.text

        except ImportError:
            # Fallback to direct HTTP call to official Gemini endpoint
            return self._generate_content_rest(
                prompt=prompt,
                system_instruction=system_instruction,
                model=target_model,
                json_output=json_output,
                temperature=temperature,
                audio_bytes=audio_bytes,
                audio_mime_type=audio_mime_type,
                api_key=key
            )
        except Exception as e:
            if isinstance(e, GeminiAPIError):
                raise e
            raise GeminiAPIError(f"Gemini API invocation failed: {str(e)}", status_code=502)

    def _generate_content_rest(
        self,
        prompt: str,
        system_instruction: Optional[str],
        model: str,
        json_output: bool,
        temperature: float,
        audio_bytes: Optional[bytes],
        audio_mime_type: Optional[str],
        api_key: str
    ) -> str:
        """Direct REST invocation for environments where google-genai package is building or standalone."""
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        parts: List[Dict[str, Any]] = []
        if audio_bytes:
            parts.append({
                "inline_data": {
                    "mime_type": audio_mime_type or "audio/wav",
                    "data": base64.b64encode(audio_bytes).decode("utf-8")
                }
            })
        parts.append({"text": prompt})

        payload: Dict[str, Any] = {
            "contents": [
                {
                    "parts": parts
                }
            ],
            "generationConfig": {
                "temperature": temperature,
            }
        }

        if system_instruction:
            payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }

        if json_output:
            payload["generationConfig"]["responseMimeType"] = "application/json"

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "aistudio-build"
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=settings.AI_TIMEOUT_SECONDS) as resp:
                result_json = json.loads(resp.read().decode("utf-8"))
                
                candidates = result_json.get("candidates", [])
                if not candidates:
                    raise GeminiAPIError("No candidate response returned by Gemini", status_code=502)
                
                content = candidates[0].get("content", {})
                parts = content.get("parts", [])
                if not parts:
                    raise GeminiAPIError("Response from Gemini contained no content parts", status_code=502)
                
                return parts[0].get("text", "")
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else str(e)
            raise GeminiAPIError(
                f"Gemini API HTTP Error {e.code}: {error_body}",
                status_code=e.code,
                details={"raw_error": error_body}
            )
        except urllib.error.URLError as e:
            raise GeminiAPIError(f"Network error contacting Gemini API: {str(e.reason)}", status_code=504)
        except Exception as e:
            raise GeminiAPIError(f"Unexpected error calling Gemini REST API: {str(e)}", status_code=500)

    def generate_json(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        model: Optional[str] = None
    ) -> Dict[str, Any]:
        """Ensures strict JSON generation and attempts automatic JSON repair if markdown markers are returned."""
        raw_text = self.generate_content(
            prompt=prompt,
            system_instruction=system_instruction,
            model=model,
            json_output=True
        )

        cleaned = raw_text.strip()
        # Remove potential markdown code fences ```json ... ```
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)
            cleaned = cleaned.strip()

        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as e:
            # Fallback regex search for JSON object or array
            match = re.search(r"(\{.*\}|\[.*\])", cleaned, re.DOTALL)
            if match:
                try:
                    return json.loads(match.group(1))
                except Exception:
                    pass
            raise GeminiAPIError(
                f"Failed to parse model output as valid JSON: {str(e)}",
                status_code=502,
                details={"raw_output": raw_text}
            )

    def generate_embedding(self, text: str) -> List[float]:
        """Generates semantic embedding vector using gemini-embedding-2-preview."""
        key = self._ensure_api_key()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.MODEL_EMBEDDING}:embedContent?key={key}"
        
        payload = {
            "model": f"models/{settings.MODEL_EMBEDDING}",
            "content": {
                "parts": [{"text": text}]
            }
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "aistudio-build"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                res = json.loads(resp.read().decode("utf-8"))
                embedding = res.get("embedding", {}).get("values", [])
                return embedding
        except Exception as e:
            raise GeminiAPIError(f"Embedding generation failed: {str(e)}", status_code=502)


ai_client = GeminiClient()
