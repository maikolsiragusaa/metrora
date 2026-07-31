import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { CodeBurnIndicator } from './indicator.js';

export default class CodeBurnExtension extends Extension {
  _indicator = null;

  enable() {
    this._indicator = new CodeBurnIndicator(this);
    Main.panel.addToStatusArea('codeburn-indicator', this._indicator);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
  }
}
