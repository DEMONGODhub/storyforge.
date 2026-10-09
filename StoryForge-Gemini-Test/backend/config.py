"""Configuration for Story Forge AI Backend."""
import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "Story Forge Backend"
    APP_VERSION: str = "1.0.0"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # Gemini Configuration
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    
    # Model Names (following modern Google GenAI standards)
    MODEL_FLASH: str = "gemini-3.8-flash"
    MODEL_TRANSCRIBE: str = "gemini-3.5-transcribe"
    MODEL_EMBEDDING: str = "gemini-embedding-2-preview"
    
    # Database
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", str(Path(__file__).parent / "story_forge.db"))
    
    # Safety & Limits
    MAX_AUDIO_SIZE_BYTES: int = 25 * 1024 * 1024  # 25 MB
    AI_TIMEOUT_SECONDS: float = 30.0

settings = Settings()
