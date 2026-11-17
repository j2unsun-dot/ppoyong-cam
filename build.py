# src/ 파일들을 하나의 index.html로 합침 (호스팅 캐시 때문에 파일이 섞이지 않도록)
from pathlib import Path
root = Path(__file__).parent
s = (root / 'src/index.html').read_text()
s = s.replace('<!--STYLE-->', '<style>\n' + (root / 'src/style.css').read_text() + '</style>')
s = s.replace('<!--FILTERS-->', '<script>\n' + (root / 'src/filters.js').read_text() + '</script>')
s = s.replace('<!--APP-->', '<script>\n' + (root / 'src/app.js').read_text() + '</script>')
assert '<!--' not in s.split('<style>')[0][-200:]
(root / 'index.html').write_text(s)
print('built index.html', len(s), 'bytes')
