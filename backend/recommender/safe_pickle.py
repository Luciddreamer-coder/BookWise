"""Restricted loading for the trusted model artifacts shipped with the app."""

import builtins
import os
import pickle


_ALLOWED_GLOBALS = {
    ("builtins", name)
    for name in ("bool", "bytes", "dict", "float", "frozenset", "int", "list", "set", "str", "tuple")
} | {
    ("collections", "OrderedDict"),
    ("copyreg", "_reconstructor"),
    ("numpy", "dtype"),
    ("numpy", "ndarray"),
    ("numpy", "float64"),
    ("numpy", "int64"),
    ("numpy._core.multiarray", "_reconstruct"),
    ("numpy._core.multiarray", "scalar"),
    ("numpy.core.multiarray", "_reconstruct"),
    ("numpy.core.multiarray", "scalar"),
    ("scipy.sparse._csr", "csr_matrix"),
    ("sklearn.feature_extraction.text", "TfidfVectorizer"),
    ("sklearn.feature_extraction.text", "TfidfTransformer"),
}


class RestrictedUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) not in _ALLOWED_GLOBALS:
            raise pickle.UnpicklingError(f"Disallowed model artifact global: {module}.{name}")
        return getattr(builtins, name) if module == "builtins" else super().find_class(module, name)


def load_artifact(path, artifacts_dir):
    """Load a shipped artifact only when it is a regular file in artifacts_dir."""
    root = os.path.realpath(artifacts_dir)
    resolved = os.path.realpath(path)
    if os.path.commonpath((root, resolved)) != root or not os.path.isfile(resolved):
        raise ValueError("Model artifact path is outside the configured artifacts directory")
    with open(resolved, "rb") as handle:
        return RestrictedUnpickler(handle).load()
