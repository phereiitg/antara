"""External provider clients (Gemini for vision/reasoning, Gnani for speech-to-text).

Each client takes its settings explicitly and accepts an injectable transport/SDK client,
so it can be tested offline without credentials.
"""
