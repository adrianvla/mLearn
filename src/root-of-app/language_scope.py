"""Admitted package selection shared by runtime consumers and worker handoffs."""
from contextlib import contextmanager
from contextvars import ContextVar, copy_context
import functools
import inspect

_scope = ContextVar('mlearn_language_selection', default=None)
UNSPECIFIED = object()


class LanguageScopeUnavailableError(RuntimeError):
    pass


def selected_variant(language):
    value = _scope.get()
    return value[1] if value and value[0] == language else UNSPECIFIED


def has_language_scope(language):
    return selected_variant(language) is not UNSPECIFIED


@contextmanager
def language_variant_override(language, variant):
    token = _scope.set((language, variant))
    try:
        yield
    finally:
        _scope.reset(token)


def run_in_executor_scoped(loop, executor, operation, *args):
    return loop.run_in_executor(executor, copy_context().run, operation, *args)


def scoped_language_request(operation):
    """Capture HTTP selection and immutable generation before asynchronous work starts."""
    signature = inspect.signature(operation, eval_str=True)
    def scope(args, kwargs):
        import config
        bound = signature.bind_partial(*args, **kwargs).arguments
        req = bound.get('req')
        explicit_language = bound.get('language') if req is None else getattr(req, 'language', None)
        language = explicit_language if isinstance(explicit_language, str) and explicit_language else config.LANGUAGE
        variant = bound.get('variant') if req is None else getattr(req, 'variant', None)
        if not isinstance(variant, (str, type(None))): variant = None
        if not explicit_language and (req is None or 'variant' not in getattr(req, 'model_fields_set', set())):
            variant = config.ACTIVE_VARIANT if language == config.LANGUAGE else None
        return language, variant
    @functools.wraps(operation)
    async def admitted(*args, **kwargs):
        import config
        from fastapi import HTTPException
        from language_generation import admit_language_generation, release_language_generation
        language, variant = scope(args, kwargs)
        generation = admit_language_generation(config.LANGUAGE_DATA_PATH) if config.LANGUAGE_DATA_PATH else None
        try:
            with language_variant_override(language, variant):
                return await operation(*args, **kwargs)
        except LanguageScopeUnavailableError as error:
            raise HTTPException(status_code=503, detail={'code': 'language_variant_unavailable', 'message': str(error)}) from error
        finally:
            if generation is not None: release_language_generation(generation)
    admitted.__signature__ = signature
    return admitted
