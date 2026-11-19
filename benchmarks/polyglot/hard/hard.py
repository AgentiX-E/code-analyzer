"""The constructs a Python review meets: decorators, async, nested classes and constants written as assignments."""

import sys
from typing import Optional

LIMIT = 10
_cache: dict[str, int] = {}


def decorator(fn):
    return fn


async def fetch(url: str) -> Optional[bytes]:
    return None


@decorator
def decorated(value: int) -> int:
    return value


@decorator
async def decorated_async(value: int) -> int:
    return value


class Repo:
    LIMIT = 5

    def __init__(self, name: str) -> None:
        self.name = name

    class Inner:
        pass

    async def load(self) -> None:
        await fetch(self.name)

    @property
    def label(self) -> str:
        return self.name


class Empty:
    pass


def top_level() -> None:
    pass


if sys.version_info >= (3, 11):
    def guarded() -> None:
        pass


DEFAULT_TIMEOUT = MAX_RETRIES = 3

try:
    from _fastjson import dumps
    FAST_PATH = True
except ImportError:
    FAST_PATH = False
