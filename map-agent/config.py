import os
from dotenv import load_dotenv

load_dotenv()

AMAP_KEY: str           = os.getenv("AMAP_KEY", "")
AMAP_SECURITY_CODE: str = os.getenv("AMAP_SECURITY_CODE", "")
QWEN_API_KEY: str       = os.getenv("QWEN_API_KEY", "")
QWEN_MODEL: str         = os.getenv("QWEN_MODEL", "qwen-vl-max")
QWEN_BASE_URL: str      = os.getenv("QWEN_BASE_URL", "https://openrouter.ai/api/v1")
SERVER_PORT: int        = int(os.getenv("SERVER_PORT", "8000"))
MAX_STEPS: int          = int(os.getenv("MAX_STEPS", "20"))
TRAVERSE_WORKERS: int   = int(os.getenv("TRAVERSE_WORKERS", "5"))
AIE_ACCESS_KEY_ID: str     = os.getenv("AIE_ACCESS_KEY_ID", "")
AIE_ACCESS_KEY_SECRET: str = os.getenv("AIE_ACCESS_KEY_SECRET", "")
AIE_TOKEN: str             = os.getenv("AIE_TOKEN", "")
