import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { MetroraIndicator } from './indicator.js';

export default class MetroraExtension extends Extension {
  _indicator = null;

  enable() {
    this._indicator = new MetroraIndicator(this);
    Main.panel.addToStatusArea('metrora-indicator', this._indicator);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
