"""Base classes and JavaScript-compatible scalar types for the ANTARA contracts.

The TypeScript engine (``src/contracts.ts``, Zod) is the reference. Two families of models:

* ``AntaraModel``: case-level records. Python attributes are snake_case; the wire format
  (aliases) is camelCase, exactly as the TypeScript engine writes ``case.json``. Validation
  accepts both spellings. Use ``model_dump(by_alias=True)`` for TypeScript-compatible JSON.
* ``LlmModel``: structures produced by a model (findings, verification, visual checks). Their
  wire keys are already snake_case in TypeScript, so no aliases.

Pydantic's lax mode would coerce ``"1"``/``True`` to ints and ``"false"`` to bools; Zod rejects
those, and a coerced LLM boolean could silently change a decision. The ``Js*`` types below
reject them so Python accepts exactly what the TypeScript engine accepts.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StrictBool
from pydantic.alias_generators import to_camel


def _reject_non_numbers(value: Any) -> Any:
    # z.number() rejects booleans and numeric strings.
    if isinstance(value, (bool, str, bytes)):
        raise ValueError("expected a JSON number")
    return value


# z.number().int() (Zod 4): integral numbers within the JS safe-integer range only
# (1 and 1.0 are the same JS number; 1.5 and 2**53 are rejected).
MAX_SAFE_INTEGER = 2**53 - 1
JsInt = Annotated[int, BeforeValidator(_reject_non_numbers), Field(ge=-MAX_SAFE_INTEGER, le=MAX_SAFE_INTEGER)]
PositiveJsInt = Annotated[int, BeforeValidator(_reject_non_numbers), Field(gt=0, le=MAX_SAFE_INTEGER)]
# z.number(): finite numbers only.
JsNumber = Annotated[float, BeforeValidator(_reject_non_numbers), Field(allow_inf_nan=False)]
NonNegativeJsNumber = Annotated[float, BeforeValidator(_reject_non_numbers), Field(ge=0, allow_inf_nan=False)]
JsBool = StrictBool


class AntaraModel(BaseModel):
    """Case-level record: snake_case in Python, camelCase on the wire (TypeScript format)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        validate_assignment=True,  # a typo'd status assigned by engine code fails loudly
    )


class LlmModel(BaseModel):
    """Model-produced structure whose wire keys are snake_case in TypeScript too."""

    model_config = ConfigDict(validate_assignment=True)
