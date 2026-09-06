/**
 * Dependency-free smoke test for lib/client.js.
 *
 * The client bundle is a classic script that registers itself through
 * `window.__ModuleLoader__.load({ id, factory })` (it is not an ESM module).
 * This test loads it that way against a minimal DOM/visualViewport shim and
 * asserts the observable side effects: registration id, plugin exports,
 * platform flags, stylesheet injection, viewport meta, visual-viewport CSS
 * variables, and teardown restoration.
 *
 * Run with: node scripts/smoke.mjs
 */

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ---- minimal DOM shim -------------------------------------------------------

function makeElement(tag) {
  return {
    tagName: tag.toUpperCase(),
    dataset: {},
    style: { values: {}, setProperty(k, v) { this.values[k] = String(v) }, removeProperty(k) { delete this.values[k] } },
    attributes: {},
    textContent: '',
    removed: false,
    parent: null,
    setAttribute(k, v) { this.attributes[k] = String(v) },
    getAttribute(k) { return this.attributes[k] ?? null },
    remove() { this.removed = true; if (this.parent) this.parent.removeChild?.(this) },
  }
}

const listeners = new Map() // type -> array of callbacks, across window + visualViewport

function makeEventTarget() {
  return {
    addEventListener(type, cb) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push(cb)
    },
    removeEventListener(type, cb) {
      const arr = listeners.get(type) ?? []
      const i = arr.indexOf(cb)
      if (i >= 0) arr.splice(i, 1)
    },
  }
}

function fire(type) {
  for (const cb of [...(listeners.get(type) ?? [])]) cb()
}

const documentElement = makeElement('html')

const head = { children: [], appendChild(el) { el.parent = head; this.children.push(el) }, removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1) } }

const documentShim = {
  documentElement,
  head,
  querySelector(sel) {
    if (sel === 'meta[name="viewport"]') {
      return head.children.find(el => el.tagName === 'META' && el.attributes.name === 'viewport') ?? null
    }
    return null
  },
  createElement(tag) { return makeElement(tag) },
}

const innerWidth = 390
let innerHeight = 844
const visualViewport = { ...makeEventTarget(), width: innerWidth, height: innerHeight, offsetTop: 0 }

const windowShim = {
  ...makeEventTarget(),
  innerWidth,
  get innerHeight() { return innerHeight },
  matchMedia() { return { matches: false } },
  visualViewport,
}

let registration = null

function setGlobalNavigator(os) {
  let ua, touch
  if (os === 'ios') { ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'; touch = 5 }
  else if (os === 'android') { ua = 'Mozilla/5.0 (Linux; Android 14)'; touch = 5 }
  else if (os === 'harmony') { ua = 'Mozilla/5.0 (Linux; Android 12; HarmonyOS 4.0) AppleWebKit/537.36 (KHTML, like Gecko) ArkWeb/4.0'; touch = 5 }
  else { ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'; touch = 0 }
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, maxTouchPoints: touch }, configurable: true, writable: true })
}

function installGlobals() {
  globalThis.document = documentShim
  globalThis.window = windowShim
  globalThis.window.__ModuleLoader__ = { load(reg) { registration = reg } }
  globalThis.requestAnimationFrame = (cb) => { cb(); return 1 }
  globalThis.cancelAnimationFrame = () => {}
}

function makeCtx(disposers) {
  return { effect(fn) { const off = fn(); if (typeof off === 'function') disposers.push(off) } }
}

// ---- load the bundle as a classic script ------------------------------------

installGlobals()
const code = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
;(0, eval)(code)

assert.ok(registration, 'bundle called __ModuleLoader__.load')
assert.strictEqual(registration.id, 'dsh-mobile-adaptation', 'registration id is the package name')

// The factory returns the plugin exports; require is unused but must be callable.
const plugin = registration.factory((spec) => { throw new Error(`unexpected require(${spec})`) })
assert.strictEqual(typeof plugin.apply, 'function', 'exports.apply is a function')
assert.ok(Array.isArray(plugin.inject), 'exports.inject is an array')

// ---- run the plugin ----------------------------------------------------------

// 1. iOS: flags + meta + stylesheet + vv variables
setGlobalNavigator('ios')
const disposers = []
plugin.apply(makeCtx(disposers))

assert.strictEqual(documentElement.dataset.dshOs, 'ios', 'dshOs should be ios')
assert.ok('dshMobile' in documentElement.dataset, 'dshMobile should be set on iOS')

const style = head.children.find(el => el.tagName === 'STYLE')
assert.ok(style, 'a <style> tag is injected')
assert.match(style.textContent, /data-dsh-mobile/, 'stylesheet is keyed to html[data-dsh-mobile]')

const meta = head.children.find(el => el.tagName === 'META' && el.attributes.name === 'viewport')
assert.ok(meta, 'a viewport <meta> is created when none exists')
assert.match(meta.attributes.content, /interactive-widget=resizes-content/, 'meta carries interactive-widget')
assert.match(meta.attributes.content, /viewport-fit=cover/, 'meta carries viewport-fit')

assert.strictEqual(documentElement.style.values['--dsh-vv-height'], `${innerHeight}px`, 'initial vv height published')
assert.strictEqual(documentElement.style.values['--dsh-vv-inset'], '0px', 'no keyboard → zero inset')

// 2. simulate the keyboard opening (overlay mode, iOS): visual viewport shrinks
visualViewport.height = innerHeight - 300
fire('resize')
assert.strictEqual(documentElement.style.values['--dsh-vv-height'], `${innerHeight - 300}px`, 'vv height tracks the keyboard')
assert.strictEqual(documentElement.style.values['--dsh-vv-inset'], '300px', 'keyboard inset published')

// 3. teardown restores everything
for (const d of disposers) d()
assert.strictEqual(documentElement.dataset.dshOs, undefined, 'dshOs removed on teardown')
assert.strictEqual(documentElement.dataset.dshMobile, undefined, 'dshMobile removed on teardown')
assert.ok(style.removed, 'stylesheet removed on teardown')
assert.ok(meta.removed, 'created viewport meta removed on teardown')
assert.strictEqual(documentElement.style.values['--dsh-vv-height'], undefined, 'vv variable removed on teardown')

// 4. OS tagging across the three target systems (fresh context each time)
for (const os of ['harmony', 'android', 'ios']) {
  setGlobalNavigator(os)
  const d2 = []
  plugin.apply(makeCtx(d2))
  assert.strictEqual(documentElement.dataset.dshOs, os, `dshOs should be ${os}`)
  assert.ok('dshMobile' in documentElement.dataset, `mobile flag set for ${os}`)
  d2.forEach(fn => fn())
}

// Non-mobile desktop keeps the adaptation off.
setGlobalNavigator('other')
const d3 = []
plugin.apply(makeCtx(d3))
assert.strictEqual(documentElement.dataset.dshOs, 'other', 'dshOs is other on desktop')
assert.strictEqual(documentElement.dataset.dshMobile, undefined, 'no mobile flag on desktop')
d3.forEach(fn => fn())

console.log('smoke test: all assertions passed ✓')
