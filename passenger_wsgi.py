import sys
import os

from a2wsgi import ASGIMiddleware

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from backend.main import app as fastapi_app

application = ASGIMiddleware(fastapi_app)
