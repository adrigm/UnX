'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const schema = require('../shared/settings-schema.json');

// Exercise the actual renderer in a small DOM fixture; no Electron or Steam
// session is opened, and the asynchronous application bootstrap stays pending.
function rendererFixture(platform) {
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = new Map(); this.listeners = new Map(); this.className = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    get classList() { return { toggle: (name, present) => {
      const names = new Set(this.className.split(' ').filter(Boolean));
      if (present) names.add(name); else names.delete(name);
      this.className = [...names].join(' ');
    } }; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      return this.children.flatMap(node => typeof node === 'object' ? [
        ...(selector === '[data-setting]' && node.attributes.has('data-setting') || selector.startsWith('.') && node.className.split(' ').includes(selector.slice(1)) ? [node] : []),
        ...node.querySelectorAll(selector)
      ] : []);
    }
  }
  const nodes = new Map();
  const document = {
    createElement: tag => new Node(tag),
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); },
    addEventListener: () => {},
    querySelectorAll: () => document.getElementById('content').querySelectorAll('[data-setting]')
  };
  const context = vm.createContext({ document, window: { addEventListener: () => {}, unx: {
    bootstrap: () => new Promise(() => {}), setWorkspaceState: () => Promise.resolve()
  } } });
  const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
  vm.runInContext(source, context);
  const renderer = vm.runInContext('({ state, defaults, defaultValue, renderSetting, refreshFooter })', context);
  renderer.state.schema = schema;
  renderer.state.platform = platform;
  renderer.state.values = renderer.defaults();
  renderer.state.saved = { ...renderer.state.values };
  return { ...renderer, document };
}

test('the Proton cache control stays false and unavailable through busy transitions and default resets', () => {
  const renderer = rendererFixture('linux');
  const setting = schema.settings.find(item => item.id === 'textures.cache');
  const injection = schema.settings.find(item => item.id === 'textures.inject');
  assert.equal(renderer.defaultValue(setting), false);
  const card = renderer.renderSetting(setting);
  const control = card.querySelector('[data-setting]');
  const injectionControl = renderer.renderSetting(injection).querySelector('[data-setting]');
  renderer.document.getElementById('content').append(card, injectionControl);
  assert.equal(control.checked, false);
  assert.equal(control.disabled, true);
  assert.match(card.querySelector('.setting-help').textContent, /Unavailable under Proton/);
  for (const busy of [true, false]) {
    renderer.state.busy = busy;
    renderer.refreshFooter();
    assert.equal(control.disabled, true);
    assert.equal(injectionControl.disabled, busy);
  }
  control.checked = true;
  control.listeners.get('change')();
  assert.equal(renderer.state.values['textures.cache'], false, 'Even a synthetic change cannot offer to save an unsupported setting.');
});

test('Windows cache control keeps its enabled default and supports user changes', () => {
  const renderer = rendererFixture('win32');
  const setting = schema.settings.find(item => item.id === 'textures.cache');
  const card = renderer.renderSetting(setting);
  const control = card.querySelector('[data-setting]');
  renderer.document.getElementById('content').append(card);
  assert.equal(renderer.defaultValue(setting), true);
  assert.equal(control.checked, true);
  renderer.refreshFooter();
  assert.equal(control.disabled, false);
  assert.doesNotMatch(card.querySelector('.setting-help').textContent, /Unavailable under Proton/);
  control.checked = false;
  control.listeners.get('change')();
  assert.equal(renderer.state.values['textures.cache'], false);
});
