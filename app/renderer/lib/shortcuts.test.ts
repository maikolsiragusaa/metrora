import { describe, expect, it } from 'vitest'

import {
  detectDesktopPlatform,
  isPrimaryShortcut,
  shortcutLabel,
  shortcutModifierLabel,
} from './shortcuts'

describe('desktop shortcut helpers', () => {
  it('detects the supported desktop platforms', () => {
    expect(detectDesktopPlatform({ platform: 'MacIntel', userAgent: '' })).toBe('macos')
    expect(detectDesktopPlatform({ platform: 'Win32', userAgent: '' })).toBe('windows')
    expect(detectDesktopPlatform({ platform: 'Linux x86_64', userAgent: '' })).toBe('linux')
    expect(detectDesktopPlatform({ platform: '', userAgent: 'unknown' })).toBe('other')
  })

  it('uses Command labels only on macOS', () => {
    expect(shortcutModifierLabel('macos')).toBe('⌘')
    expect(shortcutLabel('1', 'macos')).toBe('⌘1')
    expect(shortcutModifierLabel('windows')).toBe('Ctrl+')
    expect(shortcutLabel('R', 'windows')).toBe('Ctrl+R')
    expect(shortcutLabel(',', 'linux')).toBe('Ctrl+,')
  })

  it('accepts only the primary platform modifier', () => {
    const command = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    const control = { metaKey: false, ctrlKey: true, altKey: false, shiftKey: false }
    expect(isPrimaryShortcut(command, 'macos')).toBe(true)
    expect(isPrimaryShortcut(control, 'macos')).toBe(false)
    expect(isPrimaryShortcut(control, 'windows')).toBe(true)
    expect(isPrimaryShortcut(command, 'windows')).toBe(false)
    expect(isPrimaryShortcut({ ...control, shiftKey: true }, 'windows')).toBe(false)
  })
})
