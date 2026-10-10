"""JavaScript-compatible string helpers, so Python reproduces the TypeScript engine exactly.

Python's ``str.strip()``/``re`` ``\\s`` and JavaScript's ``trim()``/``\\s`` disagree on a few
characters (U+FEFF is JS whitespace but not Python whitespace; U+001C-U+001F and U+0085 are
Python whitespace but not JS whitespace). Zod's ``.min()/.max()`` count UTF-16 code units, not
code points. These helpers use the JavaScript definitions.
"""

from __future__ import annotations

import re

# ECMAScript WhiteSpace + LineTerminator (what /\s/ and String.prototype.trim use):
# TAB, LF, VT, FF, CR, SPACE, NBSP, U+FEFF, U+2028, U+2029 and the Zs category.
JS_WHITESPACE = frozenset(
    "\t\n\x0b\x0c\r \xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_JS_WHITESPACE_CHARS = "".join(sorted(JS_WHITESPACE))
JS_WHITESPACE_RUN = re.compile("[" + re.escape(_JS_WHITESPACE_CHARS) + "]+")


def js_trim(text: str) -> str:
    """``String.prototype.trim()``."""
    return text.strip(_JS_WHITESPACE_CHARS)


def utf16_length(text: str) -> int:
    """JavaScript ``string.length`` (UTF-16 code units), as used by Zod ``.min()``/``.max()``."""
    return len(text.encode("utf-16-le")) // 2
