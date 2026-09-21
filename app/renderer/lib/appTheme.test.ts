// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_METRORA_THEME,
  initializeMetroraTheme,
  persistMetroraTheme,
  readMetroraTheme,
  resolveMetroraTheme,
} from './appTheme'

describe('Metrora product theme', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('defaults to Dark and never follows the OS theme', () => {
    expect(DEFAULT_METRORA_THEME).toBe('dark')
    expect(resolveMetroraTheme(null)).toBe('dark')
    expect(resolveMetroraTheme(undefined)).toBe('dark')
    expect(resolveMetroraTheme('')).toBe('dark')
    expect(resolveMetroraTheme('banana')).toBe('dark')
  })

  it('keeps explicit Dark and Light selections', () => {
    expect(resolveMetroraTheme('dark')).toBe('dark')
    expect(resolveMetroraTheme('light')).toBe('light')
  })

  it('migrates the legacy system value to Dark', () => {
    expect(resolveMetroraTheme('system')).toBe('dark')
  })

  it('reads a fresh installation as Dark', () => {
    expect(readMetroraTheme()).toBe('dark')
  })

  it('initializes a fresh installation to explicit Dark', () => {
    expect(initializeMetroraTheme()).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('metrora.theme')).toBe('dark')
  })

  it('migrates a legacy system preference to persisted Dark on startup', () => {
    window.localStorage.setItem('metrora.theme', 'system')
    expect(initializeMetroraTheme()).toBe('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('metrora.theme')).toBe('dark')
  })

  it('preserves a persisted Light selection on startup', () => {
    window.localStorage.setItem('metrora.theme', 'light')
    expect(initializeMetroraTheme()).toBe('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('metrora.theme')).toBe('light')
  })

  it('persists Light selections to the root', () => {
    persistMetroraTheme('light')
    expect(document.documentElement).toHaveAttribute('data-theme', 'light')
    expect(window.localStorage.getItem('metrora.theme')).toBe('light')
  })

  it('persists Dark selections to the root', () => {
    window.localStorage.setItem('metrora.theme', 'light')
    persistMetroraTheme('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('metrora.theme')).toBe('dark')
  })
})
