import { readFile, writeFile } from 'node:fs/promises'

const indicatorPath = 'gnome/indicator.js'
let indicator = await readFile(indicatorPath, 'utf8')

function replaceOnce(before, after, label) {
  const count = indicator.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected one match, found ${count}`)
  indicator = indicator.replace(before, after)
}

replaceOnce("super._init(0.0, 'CodeBurn');", "super._init(0.0, 'Metrora');", 'accessible name')

replaceOnce(
  `this._panelIcon = new St.Label({\n      text: '🔥',\n      y_align: Clutter.ActorAlign.CENTER,\n      style_class: 'codeburn-flame',\n    });`,
  `this._panelIcon = new St.Icon({\n      gicon: Gio.icon_new_for_string(\`${'${this._extension.path}'}/icons/metrora-symbolic.svg\`),\n      icon_size: 16,\n      y_align: Clutter.ActorAlign.CENTER,\n      style_class: 'system-status-icon codeburn-flame',\n    });`,
  'panel icon',
)

replaceOnce(
  `title.add_child(new St.Label({ text: 'Code', style_class: 'codeburn-brand-primary' }));\n    title.add_child(new St.Label({ text: 'Burn', style_class: 'codeburn-brand-accent' }));\n    header.add_child(title);\n    header.add_child(new St.Label({ text: 'AI Coding Cost Tracker', style_class: 'codeburn-brand-subhead' }));`,
  `title.add_child(new St.Label({ text: 'Metrora', style_class: 'codeburn-brand-primary' }));\n    header.add_child(title);\n    header.add_child(new St.Label({ text: 'Local AI usage intelligence', style_class: 'codeburn-brand-subhead' }));`,
  'brand header',
)

await writeFile(indicatorPath, indicator)

const stylesheetPath = 'gnome/stylesheet.css'
let css = await readFile(stylesheetPath, 'utf8')
css = css
  .replaceAll('#ff8c42', '#2563eb')
  .replaceAll('#ffa94d', '#60a5fa')
  .replaceAll('#c9521d', '#1d4ed8')
  .replaceAll('#ffd700', '#60a5fa')
  .replaceAll('rgba(255, 140, 66,', 'rgba(37, 99, 235,')
  .replaceAll('rgba(200, 80, 30,', 'rgba(37, 99, 235,')
await writeFile(stylesheetPath, css)

console.log('Applied Metrora GNOME brand migration')
