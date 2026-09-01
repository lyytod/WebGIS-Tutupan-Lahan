import sys
import os
# Menambahkan folder 'backend' ke dalam path Python 
# agar module 'main' (main.py) bisa di-import dengan benar oleh Passenger
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
from main import app
from a2wsgi import ASGIMiddleware
# cPanel/Phusion Passenger secara default mencari variabel bernama 'application'
# yang berupa WSGI callable. Di sini kita menggunakan a2wsgi untuk
# membungkus aplikasi FastAPI (ASGI) menjadi aplikasi WSGI.
application = ASGIMiddleware(app)
