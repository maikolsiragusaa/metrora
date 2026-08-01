from pathlib import Path

patterns = [
    ('codeburn model-alias', 'metrora model-alias'),
    ('codeburn model-savings', 'metrora model-savings'),
    ('npx codeburn@latest', 'npx metrora@latest'),
]
for root in (Path('src'), Path('tests')):
    for suffix in ('*.ts', '*.tsx'):
        for path in root.rglob(suffix):
            original = path.read_text(encoding='utf-8')
            updated = original
            for old, new in patterns:
                updated = updated.replace(old, new)
            if updated != original:
                path.write_text(updated, encoding='utf-8')

boundary = Path('scripts/check-brand-boundary.mjs')
text = boundary.read_text(encoding='utf-8')
old = "    if (/codeburn:\\s/i.test(line)) runtimeBrandViolations.push(`${path}:${index + 1}:${line.trim()}`)\n"
new = "    if (/codeburn:\\s/i.test(line) || /codeburn model-(?:alias|savings)/i.test(line) || /npx codeburn@latest/i.test(line)) {\n      runtimeBrandViolations.push(`${path}:${index + 1}:${line.trim()}`)\n    }\n"
if old not in text:
    raise SystemExit('runtime branding guard insertion point not found')
text = text.replace(old, new)
boundary.write_text(text, encoding='utf-8')
