#!/usr/bin/env python3
"""Compatibility entry point; the standalone server lives in selfhosted/."""
import runpy
import sys

if __name__ == "__main__":
    runpy.run_module("selfhosted.rockshowbot", run_name="__main__")
else:
    from selfhosted import rockshowbot as implementation
    sys.modules[__name__] = implementation
