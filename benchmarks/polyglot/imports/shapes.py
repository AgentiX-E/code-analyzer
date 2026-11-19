"""A module whose docstring mentions `import os` without importing it."""

import os
import sys, json as js

from . import sibling
from ..pkg.mod import (
    first,
    second as other,
)
from typing import *


def read(path):
    return os.path.join(path, "x")
