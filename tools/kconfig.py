"""Finds the Kartotek content folder for the Python tools.

Order: the KARTOTEK_CONTENT environment variable, then "contentDir" in kartotek.config.json at the
repository root (git-ignored), then the synthetic samples shipped in the repository (samples/).
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def content_dir():
    """Absolute path of the configured content folder, or None when only the samples are in use."""
    env = os.environ.get('KARTOTEK_CONTENT')
    if env:
        return os.path.abspath(os.path.expandvars(env))
    cfg = os.path.join(ROOT, 'kartotek.config.json')
    if os.path.isfile(cfg):
        with open(cfg, encoding='utf-8-sig') as f:
            d = json.load(f).get('contentDir')
        if d:
            return os.path.abspath(os.path.expandvars(d))
    return None


def content_root():
    """The folder that holds studies/, lessons/, mocks/, mindmaps/: the content folder, else samples/."""
    return content_dir() or os.path.join(ROOT, 'samples')


def sources_dir():
    """Where page extracts are written and read: <content>/sources, else <repo>/sources (git-ignored)."""
    d = content_dir()
    return os.path.join(d, 'sources') if d else os.path.join(ROOT, 'sources')
