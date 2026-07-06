with open(r'C:\Users\张轩\map-agent\templates\index.html', encoding='utf-8') as f:
    content = f.read()

s = content.index('<script>') + len('<script>')
e = content.rindex('</script>')
js = content[s:e]

depth = 0
in_str = False
str_char = ''
i = 0
n = len(js)
line = 1
last_change = []

while i < n:
    c = js[i]
    if c == '\n':
        line += 1
        i += 1
        continue
    if in_str:
        if c == '\\' and i+1 < n:
            i += 2
            continue
        if c == str_char:
            in_str = False
    else:
        if c in ('"', "'", '`'):
            in_str = True
            str_char = c
        elif c == '{':
            depth += 1
            last_change.append((line, depth, '{'))
        elif c == '}':
            depth -= 1
            last_change.append((line, depth, '}'))
    i += 1

print(f'Final depth: {depth}')
print('Last 15 brace changes:')
for lc in last_change[-15:]:
    print(f'  line {lc[0]}: {lc[2]} -> depth {lc[1]}')

# Find unclosed opens
depth2 = 0
stack = []
i = 0
in_str = False
str_char = ''
line = 1
while i < n:
    c = js[i]
    if c == '\n':
        line += 1
        i += 1
        continue
    if in_str:
        if c == '\\' and i+1 < n:
            i += 2
            continue
        if c == str_char:
            in_str = False
    else:
        if c in ('"', "'", '`'):
            in_str = True
            str_char = c
        elif c == '{':
            stack.append(line)
        elif c == '}':
            if stack:
                stack.pop()
    i += 1

print(f'\nUnclosed open braces at lines: {stack}')
