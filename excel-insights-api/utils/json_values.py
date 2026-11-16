import math
from numbers import Real


def finite_json_values(value):
    """Replace non-finite numbers with None without altering JSON structure."""
    if isinstance(value, dict):
        return {key: finite_json_values(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json_values(item) for item in value]
    if isinstance(value, Real) and not isinstance(value, int):
        return value if math.isfinite(value) else None
    return value
