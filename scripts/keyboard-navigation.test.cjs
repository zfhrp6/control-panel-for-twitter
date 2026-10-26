const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const scriptPath = path.join(__dirname, '..', 'script.js')
const source = fs.readFileSync(scriptPath, 'utf8')
const regionStart = source.indexOf('//#region Keyboard navigation')
const regionEnd = source.indexOf('//#endregion Keyboard navigation', regionStart)
assert.notEqual(regionStart, -1, 'script.js must define the keyboard-navigation implementation region')
assert.notEqual(regionEnd, -1, 'script.js must close the keyboard-navigation implementation region')
const implementation = source.slice(regionStart, regionEnd)

class FakeElement {
  constructor(tagName = 'div', {testid = null, role = null, hiddenClass = null, editable = false} = {}) {
    this.tagName = tagName.toUpperCase()
    this.testid = testid
    this.role = role
    this.hiddenClass = hiddenClass
    this.isContentEditable = editable
    this.isConnected = true
    this.children = []
    this.parentElement = null
  }
  append(child) {
    child.parentElement = this
    this.children.push(child)
    return child
  }
  getAttribute(name) {
    if (name === 'data-testid') return this.testid
    if (name === 'role') return this.role
    return null
  }
  closest(selector) {
    for (let element = this; element; element = element.parentElement) {
      if (selector.includes('[data-testid="tweet"]') && element.testid === 'tweet') return element
      if (selector.includes('[data-testid="cellInnerDiv"]') && element.testid === 'cellInnerDiv') return element
      if (selector.includes('.HiddenTweet') && element.hiddenClass === 'HiddenTweet') return element
      if (selector.includes('.HiddenAd') && element.hiddenClass === 'HiddenAd') return element
      if (selector.includes('input') && element.tagName === 'INPUT') return element
      if (selector.includes('textarea') && element.tagName === 'TEXTAREA') return element
      if (selector.includes('select') && element.tagName === 'SELECT') return element
      if (selector.includes('[contenteditable="true"]') && element.isContentEditable) return element
      if (selector.includes('[role="textbox"]') && element.role === 'textbox') return element
      if (selector.includes('[role="dialog"]') && element.role === 'dialog') return element
      if (selector.includes('[aria-modal="true"]') && element.ariaModal) return element
    }
    return null
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (selector === '[data-testid="tweet"]' && child.testid === 'tweet') return child
      const nested = child.querySelector(selector)
      if (nested) return nested
    }
    return null
  }
  focus() {
    if (!this.closest('.HiddenTweet, .HiddenAd')) FakeElement.document.activeElement = this
  }
  dispatchEvent(event) {
    event.target = this
    for (const listener of [...(FakeElement.document.listeners.get(`${event.type}:true`) || [])]) listener(event)
    if (event.type === 'keypress') FakeElement.nativeXKeypress(event)
    return true
  }
}

class FakeKeyboardEvent {
  constructor(type, init) {
    this.type = type
    Object.assign(this, init)
    this.isTrusted = false
    this.defaultPrevented = false
  }
}

function createHarness(hiddenCount, includeVisibleEnd = true) {
  const listeners = new Map()
  const frames = new Map()
  const globalObservers = new Map()
  let frameId = 0
  let nativeCursor = 0
  let nativeEventCount = 0
  const timeline = new FakeElement('div')
  const tweets = []

  const itemCount = hiddenCount + (includeVisibleEnd ? 2 : 1)
  for (let index = 0; index < itemCount; index++) {
    const row = new FakeElement('div', {testid: 'cellInnerDiv'})
    const isHidden = index > 0 && index <= hiddenCount
    const wrapper = new FakeElement('div', {hiddenClass: isHidden ? 'HiddenTweet' : null})
    const tweet = new FakeElement('article', {testid: 'tweet'})
    wrapper.append(tweet)
    row.append(wrapper)
    timeline.append(row)
    tweets.push(tweet)
  }

  const body = new FakeElement('body')
  const document = {
    activeElement: tweets[0],
    listeners,
    addEventListener(type, listener, capture) {
      const key = `${type}:${Boolean(capture)}`
      listeners.set(key, [...(listeners.get(key) || []), listener])
    },
    removeEventListener(type, listener, capture) {
      const key = `${type}:${Boolean(capture)}`
      listeners.set(key, (listeners.get(key) || []).filter(item => item !== listener))
    },
  }
  const window = {
    scrollX: 0.25,
    scrollY: 100.5,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y },
  }
  const location = {pathname: '/home'}
  const context = {
    config: {enabled: true},
    desktop: true,
    currentPagePath: '/home',
    lastUrlPath: '/home',
    globalObservers,
    document,
    window,
    location,
    Element: FakeElement,
    HTMLElement: FakeElement,
    KeyboardEvent: FakeKeyboardEvent,
    Selectors: {TWEET: '[data-testid="tweet"]'},
    getCurrentRoute() {
      return {urlPath: location.pathname, pagePath: context.currentPagePath, isModal: context.isModal}
    },
    requestAnimationFrame(callback) {
      const id = ++frameId
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrame(id) { frames.delete(id) },
    Boolean, Array, Math,
    isModal: false,
  }
  vm.createContext(context)
  vm.runInContext(implementation, context)

  function nativeXKeypress(event) {
    if (event.which !== 106 && event.which !== 107) return
    nativeEventCount++
    nativeCursor += event.which === 106 ? 1 : -1
    window.scrollY += event.which === 106 ? 53 : -53
    tweets[nativeCursor]?.focus()
  }
  FakeElement.document = document
  FakeElement.nativeXKeypress = nativeXKeypress
  function physicalKeypress(key) {
    const code = key === 'j' ? 106 : 107
    const event = {
      type: 'keypress', key, code: key === 'j' ? 'KeyJ' : 'KeyK',
      keyCode: code, which: code, charCode: code, location: 0,
      repeat: false, isTrusted: true, defaultPrevented: false,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    }
    body.dispatchEvent(event)
    return event
  }
  function flushFrames() {
    while (frames.size) {
      const [id, callback] = frames.entries().next().value
      frames.delete(id)
      callback()
    }
  }
  function configure() { vm.runInContext('configureKeyboardNavigation()', context) }

  return {
    body, configure, context, document, flushFrames, frames, globalObservers,
    location, nativeEventCount: () => nativeEventCount, physicalKeypress, timeline, tweets, window,
    setNativeCursor(index) { nativeCursor = index },
  }
}

test('J/K keypresses skip consecutive hidden tweets through X navigation', () => {
  const harness = createHarness(2)
  harness.configure()
  const event = harness.physicalKeypress('j')
  assert.equal(event.defaultPrevented, false)
  assert.equal(harness.document.activeElement, harness.tweets[0])
  assert.equal(harness.nativeEventCount(), 1)
  harness.flushFrames()
  assert.equal(harness.document.activeElement, harness.tweets[3])
  assert.equal(harness.nativeEventCount(), 3)
  assert.equal(harness.window.scrollX, 0.25)
  assert.equal(harness.window.scrollY, 153.5)
})

test('K moves backward across hidden tweets with lowercase character codes', () => {
  const harness = createHarness(2)
  harness.document.activeElement = harness.tweets[3]
  harness.setNativeCursor(3)
  harness.configure()
  harness.physicalKeypress('k')
  harness.flushFrames()
  assert.equal(harness.document.activeElement, harness.tweets[0])
  assert.equal(harness.nativeEventCount(), 3)
})

test('skip bound follows the hidden run instead of an arbitrary retry cap', () => {
  const harness = createHarness(25)
  harness.configure()
  harness.physicalKeypress('j')
  harness.flushFrames()
  assert.equal(harness.document.activeElement, harness.tweets[26])
  assert.equal(harness.nativeEventCount(), 26)
})

test('a hidden run ending at the timeline boundary restores scroll without throwing', () => {
  const harness = createHarness(2, false)
  harness.configure()
  harness.physicalKeypress('j')
  harness.flushFrames()
  assert.equal(harness.document.activeElement, harness.tweets[0])
  assert.equal(harness.nativeEventCount(), 3)
  assert.equal(harness.window.scrollY, 100.5)
})

test('native focus movement to a visible tweet is left alone', () => {
  const harness = createHarness(0)
  harness.configure()
  harness.physicalKeypress('j')
  harness.flushFrames()
  assert.equal(harness.document.activeElement, harness.tweets[1])
  assert.equal(harness.nativeEventCount(), 1)
  assert.equal(harness.window.scrollY, 153.5)
})

test('pending retries stop across page changes and DOM replacement', () => {
  const harness = createHarness(2)
  harness.configure()
  harness.physicalKeypress('j')
  harness.location.pathname = '/profile/user'
  harness.flushFrames()
  assert.equal(harness.nativeEventCount(), 1)
  assert.equal(harness.document.activeElement, harness.tweets[0])
  assert.equal(harness.window.scrollY, 153.5)

  const changedDom = createHarness(2)
  changedDom.configure()
  changedDom.physicalKeypress('j')
  const replacement = new FakeElement('div', {testid: 'cellInnerDiv'})
  changedDom.timeline.children[1] = replacement
  changedDom.flushFrames()
  assert.equal(changedDom.nativeEventCount(), 1)
  assert.equal(changedDom.window.scrollY, 153.5)
})

test('enablement and responsive mode own one listener and cancel pending frames', () => {
  const harness = createHarness(2)
  harness.configure()
  harness.configure()
  assert.equal((harness.document.listeners.get('keypress:true') || []).length, 1)
  harness.physicalKeypress('j')
  assert.equal(harness.frames.size, 1)

  harness.context.config.enabled = false
  harness.globalObservers.get('keyboard navigation').disconnect()
  assert.equal(harness.frames.size, 0)
  assert.equal((harness.document.listeners.get('keypress:true') || []).length, 0)
  harness.flushFrames()
  assert.equal(harness.nativeEventCount(), 1)

  harness.context.config.enabled = true
  harness.context.desktop = false
  harness.configure()
  assert.equal((harness.document.listeners.get('keypress:true') || []).length, 0)
})

test('modified and untrusted keypresses do not schedule retries', () => {
  const harness = createHarness(2)
  harness.configure()
  harness.body.dispatchEvent({type: 'keypress', key: 'j', which: 106, isTrusted: false})
  harness.body.dispatchEvent({type: 'keypress', key: 'j', which: 106, isTrusted: true, shiftKey: true})
  assert.equal(harness.frames.size, 0)
})

test('focus in an input prevents retry scheduling', () => {
  const harness = createHarness(2)
  const input = new FakeElement('input')
  harness.body.append(input)
  harness.document.activeElement = input
  harness.configure()
  harness.physicalKeypress('j')
  assert.equal(harness.frames.size, 0)
})

test('an open modal prevents retry scheduling while the tweet remains focused', () => {
  const harness = createHarness(2)
  harness.context.isModal = true
  harness.configure()
  harness.physicalKeypress('j')
  assert.equal(harness.frames.size, 0)
})

test('a focus change before the animation frame is left untouched', () => {
  const harness = createHarness(2)
  harness.configure()
  harness.physicalKeypress('j')
  harness.document.activeElement = harness.tweets[2]
  harness.flushFrames()
  assert.equal(harness.nativeEventCount(), 1)
  assert.equal(harness.document.activeElement, harness.tweets[2])
  assert.equal(harness.window.scrollY, 153.5)
})

test('a later physical keypress cancels the stale pending retry', () => {
  const harness = createHarness(2)
  harness.configure()
  harness.physicalKeypress('j')
  harness.physicalKeypress('j')
  assert.equal(harness.frames.size, 1)
  harness.flushFrames()
  assert.equal(harness.nativeEventCount(), 3)
  assert.equal(harness.document.activeElement, harness.tweets[3])
  assert.equal(harness.window.scrollY, 206.5)
})
