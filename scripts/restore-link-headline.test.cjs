const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8')
const functionStart = source.indexOf('function restoreLinkHeadline($tweet) {')
const functionEnd = source.indexOf('\n}\n\n/**', functionStart)
assert.notEqual(functionStart, -1, 'script.js must define restoreLinkHeadline')
assert.notEqual(functionEnd, -1, 'restoreLinkHeadline must be followed by a documented function')
const implementation = source.slice(functionStart, functionEnd + 2)

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this.attributes = new Map()
    this.classes = new Set()
    this.classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
    }
    this.style = {}
    this._textContent = ''
  }

  appendChild(child) {
    child.parentElement?.children.splice(child.parentElement.children.indexOf(child), 1)
    child.parentElement = this
    this.children.push(child)
    return child
  }

  insertAdjacentHTML(position, html) {
    assert.equal(position, 'beforeend')
    this.insertedHtml = [...(this.insertedHtml || []), html]
    const inserted = new FakeElement('div', this.ownerDocument)
    inserted.textContent = html
    this.appendChild(inserted)
  }

  get firstElementChild() { return this.children[0] || null }
  get lastElementChild() { return this.children.at(-1) || null }

  set textContent(text) {
    this.children = []
    this._textContent = String(text)
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('')
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
}

function createHarness({ariaLabel, overlayText = null} = {}) {
  const document = {createElement: tagName => new FakeElement(tagName, document)}
  const link = new FakeElement('a', document)
  link.setAttribute('aria-label', ariaLabel)
  const media = new FakeElement('div', document)
  link.appendChild(media)
  if (overlayText != null) {
    const overlay = new FakeElement('div', document)
    overlay.textContent = overlayText
    link.appendChild(overlay)
  }
  const tweet = {querySelector: () => link}
  const context = {
    fontFamilyRule: null,
    document,
  }
  vm.createContext(context)
  vm.runInContext(`${implementation}; this.restoreLinkHeadline = restoreLinkHeadline`, context)
  return {link, media, tweet, restore: context.restoreLinkHeadline}
}

test('renders link-card title and site as literal text and preserves distinct existing card text', () => {
  const title = '<img src=x onerror=alert(1)>'
  const harness = createHarness({ariaLabel: `example.test ${title}`, overlayText: 'A real card description'})
  const originalOverlay = harness.link.lastElementChild

  harness.restore(harness.tweet)

  assert.deepEqual(harness.link.insertedHtml || [], [])
  const panel = harness.link.lastElementChild
  const [titleElement, descriptionElement, siteElement] = panel.children
  assert.equal(panel.parentElement, harness.link)
  assert.equal(originalOverlay.parentElement, harness.link)
  assert.equal(originalOverlay.textContent, 'A real card description')
  assert.equal(titleElement.textContent, title)
  assert.equal(titleElement.children.length, 0)
  assert.equal(descriptionElement.textContent, 'A real card description')
  assert.equal(descriptionElement.parentElement, panel)
  assert.equal(siteElement.textContent, 'example.test')
  assert.equal(harness.link.dataset.headlineRestored, 'true')
  assert.equal(originalOverlay.classList.contains('cpft_overlay_headline'), true)
  harness.restore(harness.tweet)
  assert.equal(originalOverlay.parentElement, harness.link)
  assert.equal(harness.link.children.length, 3)
})

test('does not duplicate an existing overlay when it already contains the restored title', () => {
  const harness = createHarness({ariaLabel: 'example.test Example title', overlayText: 'Example title'})

  harness.restore(harness.tweet)

  const panel = harness.link.lastElementChild
  assert.deepEqual(panel.children.map(child => child.textContent), ['Example title', 'example.test'])
  assert.equal(harness.link.children[1].classList.contains('cpft_overlay_headline'), true)
})

test('restoring the same card repeatedly does not duplicate its text panel', () => {
  const harness = createHarness({ariaLabel: 'example.test Example title'})

  harness.restore(harness.tweet)
  harness.restore(harness.tweet)

  assert.equal(harness.link.children.length, 2)
  assert.equal(harness.link.lastElementChild.children.length, 2)
})
