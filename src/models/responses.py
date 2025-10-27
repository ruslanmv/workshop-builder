# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

from typing import Any, Generic, Optional, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiError(BaseModel):
    """
    Standard error payload for API responses.
    """
    code: str = Field(default="error")
    message: str
    details: Optional[Any] = None


class OkResponse(Generic[T], BaseModel):
    """
    Successful response envelope: { ok: true, result, warnings? }
    """
    ok: bool = True
    result: T
    warnings: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    """
    Error response envelope: { ok: false, error }
    """
    ok: bool = False
    error: ApiError
