import sys, ast

with open('main.py', encoding='utf-8') as f:
    src = f.read()
try:
    ast.parse(src)
    print('main.py syntax: OK')
except SyntaxError as e:
    print('SYNTAX ERROR:', e)
    sys.exit(1)

import main
for r in main.app.routes:
    if hasattr(r, 'path'):
        print(r.path)
