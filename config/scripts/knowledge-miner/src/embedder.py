"""
embedder.py — Text embedding with sentence-transformers / TF-IDF / Jaccard fallback.

Callers:
  src/graph.py      — Embedder() for theme clustering (_cluster_themes)
  src/hook_context.py — Embedder().find_similar() for pre-session context ranking

Cache: data/embeddings.pkl
  Format: {corpus_md5_hex: np.ndarray}  shape (n_texts, embedding_dim)
"""

import hashlib
import pickle
from pathlib import Path
from typing import List, Tuple

import numpy as np


class Embedder:
    """
    Unified embedding with three fallback backends:
      1. sentence-transformers all-MiniLM-L6-v2
      2. TF-IDF + cosine similarity (sklearn)
      3. Jaccard keyword overlap (no deps)
    """

    def __init__(self, cache_path: str = None):
        self._cache_path = Path(cache_path) if cache_path else None
        self._backend_name = "jaccard"
        self._model = None
        self._vectorizer = None
        self._mem_cache: dict = {}
        self._init_backend()

    def _init_backend(self):
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer("all-MiniLM-L6-v2")
            self._backend_name = "sentence-transformers"
            return
        except ImportError:
            pass

        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            self._vectorizer = TfidfVectorizer(max_features=5000, sublinear_tf=True)
            self._backend_name = "tfidf"
            return
        except ImportError:
            pass

        self._backend_name = "jaccard"

    def backend(self) -> str:
        return self._backend_name

    def encode(self, texts: List[str]) -> np.ndarray:
        """Encode texts into a 2D numpy array."""
        if not texts:
            return np.zeros((0, 1))
        if self._backend_name == "sentence-transformers":
            return self._model.encode(texts, show_progress_bar=False)
        if self._backend_name == "tfidf":
            try:
                return self._vectorizer.fit_transform(texts).toarray()
            except Exception:
                pass
        return np.eye(len(texts))

    def similarity(self, a: str, b: str) -> float:
        """Cosine or Jaccard similarity between two strings. Returns 0.0–1.0."""
        if not a.strip() or not b.strip():
            return 0.0
        if self._backend_name == "sentence-transformers":
            vecs = self._model.encode([a, b], show_progress_bar=False)
            return float(self._cosine(vecs[0], vecs[1]))
        if self._backend_name == "tfidf":
            try:
                arr = self._vectorizer.fit_transform([a, b]).toarray()
                return float(self._cosine(arr[0], arr[1]))
            except Exception:
                pass
        return self._jaccard(a, b)

    def find_similar(
        self, query: str, corpus: List[str], top_k: int = 5
    ) -> List[Tuple[int, float]]:
        """
        Find top_k most similar corpus entries to query.
        Returns list of (index, score) sorted by descending score.
        """
        if not corpus:
            return []

        corpus_hash = hashlib.md5("|".join(corpus).encode()).hexdigest()

        if self._backend_name == "sentence-transformers":
            cached = self._load_cache(corpus_hash)
            if cached is None:
                cached = self._model.encode(corpus, show_progress_bar=False)
                self._save_cache(corpus_hash, cached)
            q_vec = self._model.encode([query], show_progress_bar=False)[0]
            scores = [float(self._cosine(q_vec, cv)) for cv in cached]
        elif self._backend_name == "tfidf":
            try:
                all_texts = [query] + corpus
                arr = self._vectorizer.fit_transform(all_texts).toarray()
                scores = [float(self._cosine(arr[0], arr[i + 1])) for i in range(len(corpus))]
            except Exception:
                scores = [self._jaccard(query, c) for c in corpus]
        else:
            scores = [self._jaccard(query, c) for c in corpus]

        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        return ranked[:top_k]

    @staticmethod
    def _cosine(a: np.ndarray, b: np.ndarray) -> float:
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        if na == 0 or nb == 0:
            return 0.0
        return float(np.dot(a, b) / (na * nb))

    @staticmethod
    def _jaccard(a: str, b: str) -> float:
        sa, sb = set(a.lower().split()), set(b.lower().split())
        if not sa and not sb:
            return 0.0
        return len(sa & sb) / len(sa | sb) if (sa | sb) else 0.0

    def _load_cache(self, key: str):
        if self._cache_path is None:
            return self._mem_cache.get(key)
        try:
            if self._cache_path.exists():
                with open(self._cache_path, "rb") as f:
                    return pickle.load(f).get(key)
        except Exception:
            pass
        return None

    def _save_cache(self, key: str, vectors: np.ndarray):
        if self._cache_path is None:
            self._mem_cache[key] = vectors
            return
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
            store = {}
            if self._cache_path.exists():
                with open(self._cache_path, "rb") as f:
                    store = pickle.load(f)
            store[key] = vectors
            with open(self._cache_path, "wb") as f:
                pickle.dump(store, f)
        except Exception:
            pass
