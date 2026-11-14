"""One FastAPI service for Gmail authentication, all three skills, and teacher review."""
import logging
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .auth import EmailAuth, auth_router, gmail_sender
from .evidence_api import open_store
from .reviews import install_reviews
from .practice import install_practice
from .scoring import load_forms

LOG = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / 'frontend' / 'dist'


def create_app(auth=None, *, review_path=None, evidence_path=None):
    # Environment loaded by gmail_sender before teacher configuration is accessed.
    if auth is None:
        sender = gmail_sender()
        auth = EmailAuth(os.getenv('LITERA_AUTH_DB') or ROOT / '.litera-data' / 'accounts.sqlite3', sender)
    app = FastAPI(title='Litera Integrated Reading Assessment', version='1.0')
    app.include_router(auth_router(auth))
    forms = load_forms()
    store = open_store(evidence_path or os.getenv('LITERA_EVIDENCE_DB') or ROOT / '.litera-data' / 'evidence.sqlite3',
                       os.getenv('LITERA_EVIDENCE_CONFIG'))
    app.state.reviews = install_reviews(app, auth, forms, store, review_path)
    app.state.evidence = store
    app.state.practice = install_practice(app, auth)

    @app.get('/api/health')
    def health():
        return {'status': 'ok'}

    if (FRONTEND / 'assets').is_dir():
        app.mount('/assets', StaticFiles(directory=FRONTEND / 'assets'), name='assets')

    @app.get('/')
    @app.get('/teacher')
    def index():
        html = FRONTEND / 'index.html'
        if not html.is_file():
            raise HTTPException(503, 'Build the frontend using npm run build, or run npm run dev.')
        return FileResponse(html)
    return app


app = create_app()

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=int(os.getenv('PORT', '8765')))
