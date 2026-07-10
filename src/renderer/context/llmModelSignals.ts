/**
 * LLM Model Signals
 * Shared signal tracking whether the built-in LLM model is downloaded.
 * Seeded and refreshed by BuiltinModelStatusListener in WindowWrapper so the
 * home screen and other gates can read it synchronously without per-render
 * async calls. Extracted to a module to avoid circular deps.
 */

import { createSignal } from 'solid-js';

const [builtinModelReady, setBuiltinModelReady] = createSignal(false);

export { builtinModelReady, setBuiltinModelReady };
